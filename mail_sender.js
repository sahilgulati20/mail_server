import express from "express";
import multer from "multer";
import cors from "cors";
import csvParser from "csv-parser";
import fs from "fs";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const app = express();
app.use(cors());

// 📁 Multer config — allows CSV + logo + banner uploads
const upload = multer({ dest: "uploads/" });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 🧠 Verify email credentials
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.error("❌ ERROR: EMAIL_USER and EMAIL_PASS must be set in .env");
  process.exit(1);
}

// ✉️ Configure Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// 🚀 Route: Upload CSV + optional logo/banner, then send emails
app.post(
  "/send-csv",
  upload.fields([
    { name: "csvFile", maxCount: 1 },
    { name: "logoFile", maxCount: 1 },
    { name: "bannerFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      // --- Validate input ---
      if (!req.files?.csvFile) {
        return res.status(400).json({ error: "CSV file is required." });
      }
      const subject = req.body.subject;
      const html = req.body.html;
      const logoUrlRaw = (req.body.logoUrl || "").trim();
      const bannerUrlRaw = (req.body.bannerUrl || "").trim();
      const delayMs = parseInt(req.body.delayMs || "300", 10);
      const fromName = req.body.fromName || "Team Intellia";

      if (!subject || !html) {
        fs.unlinkSync(req.files.csvFile[0].path);
        return res.status(400).json({ error: "Missing subject or HTML body." });
      }

      // --- Parse CSV ---
      const recipients = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(req.files.csvFile[0].path)
          .pipe(csvParser())
          .on("data", (row) => recipients.push(row))
          .on("end", resolve)
          .on("error", reject);
      });

      if (recipients.length === 0) {
        fs.unlinkSync(req.files.csvFile[0].path);
        return res.status(400).json({ error: "No recipients found in CSV." });
      }

  // --- Prepare image attachments (embed as inline, not external paths) ---
  const attachments = [];
      const logoCid = `logo-${Date.now()}`;
      const bannerCid = `banner-${Date.now()}`;

      // Normalize commonly shared links (e.g., Google Drive) to a direct-view URL
      const normalizeImageUrl = (url) => {
        try {
          const u = new URL(url);
          const isDrive = u.hostname.includes("drive.google.com");
          if (isDrive) {
            // Patterns:
            // - /file/d/<id>/view?usp=sharing
            // - /open?id=<id>
            // - /uc?export=download&id=<id>
            let id = null;
            const m = u.pathname.match(/\/d\/([^/]+)/);
            if (m && m[1]) id = m[1];
            if (!id) id = u.searchParams.get("id");
            if (id) {
              return `https://drive.google.com/uc?export=view&id=${id}`;
            }
          }
          return url;
        } catch {
          return url;
        }
      };

      const logoUrl = logoUrlRaw ? normalizeImageUrl(logoUrlRaw) : "";
      const bannerUrl = bannerUrlRaw ? normalizeImageUrl(bannerUrlRaw) : "";

      const pickImageMime = (filename, fallback) => {
        const ext = (path.extname(filename) || "").toLowerCase();
        if (fallback && fallback.startsWith("image/")) return fallback;
        switch (ext) {
          case ".png":
            return "image/png";
          case ".jpg":
          case ".jpeg":
            return "image/jpeg";
          case ".gif":
            return "image/gif";
          case ".webp":
            return "image/webp";
          case ".svg":
            return "image/svg+xml";
          default:
            return fallback && fallback.includes("/") ? fallback : "application/octet-stream";
        }
      };

      // Helper: ensure image is a Gmail-friendly format (png/jpg/gif). If not, try converting to PNG.
      const processInlineImage = async (file, cidDefault, label) => {
        const filename = file.originalname || label;
        const detected = pickImageMime(filename, file.mimetype);
        let content = fs.readFileSync(file.path);
        let contentType = detected;
        let outFilename = filename;

        const isSupported = /^image\/(png|jpe?g|gif)$/i.test(detected || "");
        if (!isSupported) {
          try {
            const sharp = (await import("sharp")).default;
            const pngBuffer = await sharp(content).png().toBuffer();
            content = pngBuffer;
            contentType = "image/png";
            // ensure filename has .png extension after conversion
            const base = path.basename(filename, path.extname(filename));
            outFilename = `${base}.png`;
          } catch (e) {
            // Hard fail so the caller can show a clear message rather than sending a broken image
            const msg = `Inline image \"${filename}\" has unsupported type (${detected}). Install 'sharp' or upload PNG/JPG/GIF.`;
            console.warn(msg, e.message);
            const err = new Error(msg);
            err.code = "UNSUPPORTED_IMAGE";
            throw err;
          }
        }

        return {
          filename: outFilename,
          content,
          contentType,
          cid: cidDefault,
          // let nodemailer set appropriate headers for inline CIDs
        };
      };

      if (!logoUrl && req.files.logoFile) {
        const lf = req.files.logoFile[0];
        try {
          attachments.push(await processInlineImage(lf, logoCid, "logo"));
        } catch (e) {
          // Surface a clear response so users know how to fix
          return res.status(400).json({ error: e.code === "UNSUPPORTED_IMAGE" ? e.message : "Could not prepare logo", details: e.message });
        }
      }
      if (!bannerUrl && req.files.bannerFile) {
        const bf = req.files.bannerFile[0];
        try {
          attachments.push(await processInlineImage(bf, bannerCid, "banner"));
        } catch (e) {
          return res.status(400).json({ error: e.code === "UNSUPPORTED_IMAGE" ? e.message : "Could not prepare banner", details: e.message });
        }
      }

      // --- Send emails one by one ---
      const results = { sent: 0, failed: 0, failures: [] };

      for (const r of recipients) {
        const email = r.email || r.Email;
        const name = r.name || r.Name || "";

        if (!email) continue;

        // Build personalized HTML with optional logo/banner
        const personalizedHtml = `
          <div style="font-family: Arial, sans-serif; padding: 15px; line-height: 1.5;">
            ${logoUrl ? `<img src="${logoUrl}" alt="Intellia Logo" width="120"/><br><br>` : (req.files.logoFile ? `<img src="cid:${logoCid}" alt="Intellia Logo" width="120"/><br><br>` : "")}
            ${html.replace(/\[Name\]/g, name)}
            ${bannerUrl ? `<br><br><img src="${bannerUrl}" alt="Banner" width="600"/>` : (req.files.bannerFile ? `<br><br><img src="cid:${bannerCid}" alt="Banner" width="600"/>` : "")}
          </div>
        `;

        try {
          // create a fresh attachments array per message to avoid any consumer mutating objects
          const attachmentsForSend = attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content) ? Buffer.from(a.content) : a.content,
            cid: a.cid,
            contentType: a.contentType,
          }));
          if (attachmentsForSend.length) {
            console.log(
              "Inline attachments:",
              attachmentsForSend.map((a) => ({ cid: a.cid, bytes: a.content?.length || 0, type: a.contentType, filename: a.filename }))
            );
          }
          await transporter.sendMail({
            from: `"${fromName}" <${process.env.EMAIL_USER}>`,
            to: email,
            subject,
            html: personalizedHtml,
            attachments: attachmentsForSend,
          });
          console.log(`✅ Sent to ${email}`);
          results.sent += 1;
        } catch (err) {
          console.error(`❌ Failed to send to ${email}: ${err.message}`);
          results.failed += 1;
          results.failures.push({ email, error: err.message });
        }

        if (delayMs > 0) await delay(delayMs);
      }

      // --- Cleanup uploaded files ---
      // Remove any files Multer stored (csvFile, logoFile, bannerFile)
      Object.values(req.files).forEach((fileArr) =>
        fileArr.forEach((file) => {
          try {
            // Best-effort cleanup; ignore if already removed
            fs.unlinkSync(file.path);
          } catch (e) {
            // Only ignore file-not-found; rethrow others for visibility
            if (e?.code !== "ENOENT") {
              console.warn(`Cleanup warning for ${file.path}:`, e.message);
            }
          }
        })
      );

      res.json({ success: true, summary: results });
    } catch (err) {
      console.error("❌ Error:", err);
      return res.status(500).json({ error: "Internal server error", details: err.message });
    }
  }
);

// 🧪 Test route
app.get("/", (req, res) => res.send("📬 Team Intellia Mail Server Running"));

// 🚀 Start server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
