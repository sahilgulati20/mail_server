// Merged server combining functionality from server.js and mail_sender.js
// Routes included:
// - POST /generate-email    -> AI-powered HTML email generation (Gemini)
// - POST /send-mails        -> CSV upload and basic bulk send with personalization
// - POST /send-csv          -> CSV + optional logo/banner (URL or uploaded inline) bulk send
// - POST /send-otp          -> Send OTP to email
// - POST /verify-otp        -> Verify OTP
// - GET   /                 -> Health check

import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch"; 
import dotenv from "dotenv";
import multer from "multer";
import csvParser from "csv-parser";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ---------------- FIREBASE SETUP ----------------
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

let db = null;
try {
  // Use a conditional check to see if we have enough config to attempt init
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    const firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
  } else {
    console.warn("Firebase config incomplete. Logging to Firestore disabled.");
  }
} catch (err) {
  console.warn("Firebase init failed or already initialized:", err.message || err);
}

// ---------------- NODEMAILER SETUP (FLEXIBLE) ----------------
// Utility function to create a robust transporter configuration
const createTransporter = (service, user, pass, host, port) => {
  const isSendGrid = service && service.toLowerCase() === "sendgrid";
  const isGmail = service && service.toLowerCase().includes("gmail");
  const hasExplicitHost = !!host && !!port;

  // Gmail via OAuth2 (preferred). If OAuth2 env vars exist, use them.
  if (!hasExplicitHost && isGmail) {
    const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
    if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN) {
      return nodemailer.createTransport({
        service: "gmail",
        auth: {
          type: "OAuth2",
          user,
          clientId: GMAIL_CLIENT_ID,
          clientSecret: GMAIL_CLIENT_SECRET,
          refreshToken: GMAIL_REFRESH_TOKEN,
        },
        connectionTimeout: 10000,
        pool: true,
      });
    }
    // Fallback to SMTP (App Password) if OAuth2 not configured
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
      connectionTimeout: 10000,
      pool: true,
    });
  }

  // SendGrid/Transactional: prefer an alternate port to avoid provider firewalls
  if (isSendGrid && !hasExplicitHost) {
    return nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 2525,
      secure: false,
      auth: { user, pass },
      connectionTimeout: 10000,
      pool: true,
    });
  }

  // Custom Host/Port provided explicitly
  if (hasExplicitHost) {
    const secure = parseInt(port, 10) === 465;
    return nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure,
      auth: { user, pass },
      connectionTimeout: 10000,
      pool: true,
    });
  }

  // Service fallback (other providers)
  return nodemailer.createTransport({
    service: service,
    auth: { user, pass },
    connectionTimeout: 10000,
    pool: true,
  });
};

const BULK_EMAIL_SERVICE = process.env.BULK_EMAIL_SERVICE || process.env.EMAIL_SERVICE;
const BULK_EMAIL_USER = process.env.BULK_EMAIL_USER || process.env.EMAIL_USER;
const BULK_EMAIL_PASS = process.env.BULK_EMAIL_PASS || process.env.EMAIL_PASS;
const BULK_EMAIL_HOST = process.env.BULK_EMAIL_HOST || process.env.EMAIL_HOST;
const BULK_EMAIL_PORT = process.env.BULK_EMAIL_PORT || process.env.EMAIL_PORT;

const OTP_EMAIL_SERVICE = process.env.OTP_EMAIL_SERVICE || process.env.EMAIL_SERVICE;
const OTP_EMAIL_USER = process.env.OTP_EMAIL_USER || process.env.EMAIL_USER;
const OTP_EMAIL_PASS = process.env.OTP_EMAIL_PASS || process.env.EMAIL_PASS;
const OTP_EMAIL_HOST = process.env.OTP_EMAIL_HOST || process.env.EMAIL_HOST;
const OTP_EMAIL_PORT = process.env.OTP_EMAIL_PORT || process.env.EMAIL_PORT;

if (!BULK_EMAIL_USER || !BULK_EMAIL_PASS) {
  console.warn("Bulk sender credentials not fully set.");
}
if (!OTP_EMAIL_USER || !OTP_EMAIL_PASS) {
  console.warn("OTP sender credentials not fully set.");
}

const bulkTransporter = createTransporter(BULK_EMAIL_SERVICE, BULK_EMAIL_USER, BULK_EMAIL_PASS, BULK_EMAIL_HOST, BULK_EMAIL_PORT);
const otpTransporter = createTransporter(OTP_EMAIL_SERVICE, OTP_EMAIL_USER, OTP_EMAIL_PASS, OTP_EMAIL_HOST, OTP_EMAIL_PORT);

console.log(`📧 Bulk sender: ${BULK_EMAIL_USER || "<unset>"} via ${BULK_EMAIL_SERVICE || BULK_EMAIL_HOST + ':' + BULK_EMAIL_PORT || "default"}`);
console.log(`🔐 OTP sender:  ${OTP_EMAIL_USER || "<unset>"} via ${OTP_EMAIL_SERVICE || OTP_EMAIL_HOST + ':' + OTP_EMAIL_PORT || "default"}`);

// ---------------- MULTER ----------------
const upload = multer({ dest: "uploads/" });

// ---------------- OTP STORE ----------------
const otpStore = {};

// ---------------- DEFAULT EMAIL TEMPLATE ----------------
const DEFAULT_EMAIL_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <style>
    /* Import Poppins font */
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');

    /* 1. LIGHT MODE STYLES (DEFAULT) */
    body {
      font-family: 'Poppins', Arial, sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f4f7f6;
    }
    .body-wrapper {
      font-family: 'Poppins', Arial, sans-serif; 
      margin: 0; 
      padding: 20px 0; 
      background-color: #f4f7f6;
    }
    .container {
      width: 90%; 
      max-width: 600px; 
      margin: 40px auto; 
      background-color: #ffffff;
      color: #333333;
      padding: 30px; 
      border-radius: 15px; 
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.1);
      border: 1px solid #e0e0e0;
    }
    .logo {
      width: 150px; 
      height: 150px; 
      border-radius: 50%; 
      object-fit: cover; 
      border: 4px solid #8B008B; /* Darker purple border */
      box-shadow: 0 0 20px rgba(139, 0, 139, 0.4);
    }
    .accent-text {
      font-size: 20px; 
      line-height: 1.7; 
      color: #8B008B;
      font-weight: 700; /* Bolder */
      margin-bottom: 20px;
    }
    .accent-text-large {
      font-size: 24px; 
      line-height: 1.7; 
      color: #8B008B;
      font-weight: 700; /* Bolder */
      margin: 25px 0;
      text-align: center;
    }
    .accent-text-small {
      color: #8B008B;
      font-weight: 700; /* Bolder */
    }
    .main-text {
      font-size: 16px; 
      line-height: 1.7; 
      color: #333333;
    }
    .contact-info {
      font-size: 16px;
      line-height: 1.8;
      color: #333333;
      background-color: #f9f9f9;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #eee;
    }
    .divider {
      border: 0; 
      border-top: 1px solid #dddddd;
      margin: 30px 0;
    }
    .footer {
      width: 90%; 
      max-width: 600px; 
      margin: 0 auto; 
      padding: 20px 0; 
      text-align: center; 
      color: #555555;
      font-family: 'Poppins', Arial, sans-serif;
    }
    .footer p {
      font-size: 12px;
    }

    /* 2. DARK MODE STYLES */
    @media (prefers-color-scheme: dark) {
      .body-wrapper {
        background-color: #1a1a1a !important;
        background-image: linear-gradient(135deg, #2c3e50 0%, #1a1a1a 100%) !important;
      }
      .container {
        background-color: rgba(30, 30, 30, 0.85) !important;
        color: #f0f0f0 !important;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
      }
      .logo {
        border: 4px solid #9b59b6 !important;
        box-shadow: 0 0 20px rgba(155, 89, 182, 0.5) !important;
      }
      .accent-text, .accent-text-large, .accent-text-small {
        color: #9b59b6 !important;
      }
      .main-text {
        color: #f0f0f0 !important;
      }
      .contact-info {
        color: #f0f0f0 !important;
        background-color: #2c2c2c !important;
        border: 1px solid #444 !important;
      }
      .divider {
        border-top: 1px solid #555 !important;
      }
      .footer {
        color: #aaa !important;
      }
    }
  </style>
</head>
<body class="body-wrapper">
  <!-- Main container -->
  <div class="container">
    
    <!-- 1. Logo Container -->
    <div style="text-align: center; margin-bottom: 20px;" data-section="logo">
      <img src="https://www.intelliamiet.in/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fintellia_logo.89493b3a.png&w=640&q=75" alt="Intellia Logo" class="logo">
    </div>
    
    <!-- THIS IS THE SECTION TO BE REPLACED -->
    <div data-section="email-body">
        <!-- 
          This section is intentionally left blank. 
          The AI will dynamically insert the user's content here, 
          using classes like 'main-text' and 'accent-text' 
          to match the default design.
        -->
    </div>
    <!-- END OF SECTION TO BE REPLACED -->

    <!-- 4. Divider -->
    <hr class="divider">

    <p class="main-text" style="margin-top: 25px;">
      Best regards,<br>
      <span class="accent-text-small">Team Intellia</span>
    </p>
    
  </div>

  <!-- 5. Footer -->
  <div class="footer">
    <p>
      © 2025 Team Intellia. All rights reserved.<br>
      Departmental Society of CSE (AI) & CSE (AIML)
    </p>
  </div>
</body>
</html>
`;

// --- Utility Functions ---
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithBackoff(url, payload, maxRetries = 5) {
  let attempt = 0;
  let backoffTime = 1000;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) return await response.json();

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        console.warn(`Attempt ${attempt + 1}: ${response.status}, retrying...`);
        await delay(backoffTime);
        backoffTime *= 2;
        attempt++;
      } else {
        const errorData = await response.json().catch(() => ({ error: { message: "Unknown error" } }));
        throw new Error(JSON.stringify(errorData));
      }
    } catch (error) {
      if (attempt >= maxRetries - 1) throw error;
      console.warn(`Attempt ${attempt + 1} failed, retrying...`);
      await delay(backoffTime);
      backoffTime *= 2;
      attempt++;
    }
  }
  throw new Error("Failed after max retries");
}

// =======================================================
// 🤖 AI email generation endpoint
// =======================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-preview-09-2025";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

app.post("/generate-email", async (req, res) => {
  const { content, hasLogo, hasBanner, designPrompt, placementInstructions } = req.body;

  if (!content) return res.status(400).json({ error: "Missing 'content' in the request body." });

  console.log("📩 Received email modification request...");

  const prompt = `
You are an expert HTML email designer. Your task is to modify an existing HTML email template based on user instructions.

**Here is the base HTML template you MUST start with:**
\n${DEFAULT_EMAIL_TEMPLATE}\n
**User Instructions (Process these in order):**

1.  **New Email Content:**
    * Replace the *existing* email body (the part inside \`<div data-section="email-body">\`) with the following new content.
    * You MUST format this new content using the CSS classes available in the template (like \`main-text\`, \`accent-text\`, \`accent-text-large\`, \`contact-info\`) to make it look professional.
    * **New Content to Insert:** "${content}"

2.  **Design & Theme (designPrompt: "${designPrompt || "No instructions provided."}"):
    * The user provided these design instructions: "${designPrompt || "No instructions provided."}"
    * **CRITICAL:** If the instructions are "No instructions provided" or empty, you MUST **use the default design** (the purple theme, fonts, etc.) exactly as it is in the template.
    * If the user *did* provide instructions (e.g., "make it blue," "a dark, modern theme"), you MUST **modify the CSS** in the \`<style>\` block and any inline styles to match their request.

3.  **Logo (hasLogo: ${hasLogo}):**
    * If \`hasLogo\` is \`false\`, you MUST **remove** the entire logo div (\`<div data-section="logo">\`) from the HTML.
    * If \`hasLogo\` is \`true\`, you MUST **keep** it.

4.  **Banner (hasBanner: ${hasBanner}):**
    * If \`hasBanner\` is \`true\`, you MUST **add** a responsive banner image section.
    * Use this placeholder for the banner: \`<div style="text-align: center; margin-bottom: 20px;" data-section="banner"><img src="https://placehold.co/600x250/EFEFEF/AAAAAA?text=Banner+Image" alt="Banner" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto;border-radius:8px;"></div>\`
    * If \`hasBanner\` is \`false\`, do not add this section.

5.  **Placement (placementInstructions: "${placementInstructions || "No instructions provided."}"):
    * The user provided these placement instructions: "${placementInstructions || "No instructions provided."}"
    * If instructions are provided (e.g., "put the logo on the left," "banner at the very top"), you MUST **modify the HTML structure** to move the logo (if present) and the banner (if added) to the requested locations.
    * If no instructions are provided, use the default layout: logo at the top-center, and the banner (if added) right below the logo.

**Output Rules:**
Your response MUST start *exactly* with \`<!DOCTYPE html>\` and contain ONLY the single, complete, modified HTML file. Do not include any explanations, markdown \`\`\`html tags, or any text before or after the HTML code.
`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  try {
    const result = await fetchWithBackoff(GEMINI_URL, payload);
    const modelOutput =
      result.candidates?.[0]?.content?.parts?.[0]?.text ||
      "<!DOCTYPE html><html><body><p>Error: No content generated by the model.</p></body></html>";

    let cleanHtml = modelOutput.trim();
    cleanHtml = cleanHtml.replace(/^```html|```$/g, "").trim();

    console.log("✅ Successfully modified email template.");
    res.json({ html: cleanHtml });
  } catch (error) {
    console.error("🚨 Gemini API Error:", error.message || error);
    let errorDetails = error.message;
    try {
      const parsedError = JSON.parse(error.message);
      if (parsedError.error?.message) errorDetails = parsedError.error.message;
    } catch {}
    res.status(500).json({ error: "Failed to generate email", details: errorDetails });
  }
});

// =======================================================
// 📤 Basic CSV bulk mail sender
// =======================================================
app.post("/send-mails", upload.single("csvFile"), async (req, res) => {
  try {
    const csvFilePath = req.file.path;
    const recipients = [];

    fs.createReadStream(csvFilePath)
      .pipe(csvParser())
      .on("data", (row) => recipients.push(row))
      .on("end", async () => {
        const { subject, html } = req.body;
        if (!subject || !html) {
          fs.unlinkSync(csvFilePath);
          return res.status(400).json({ error: "Missing subject or HTML content." });
        }

        for (const rec of recipients) {
          const name = rec.name || rec.Name || "User";
          const email = rec.email || rec.Email;
          if (!email) continue;

          const personalizedHtml = html.replace(/\[Name\]/g, name);

          try {
            await bulkTransporter.sendMail({
              from: `"Mail Buddy" <${BULK_EMAIL_USER}>`,
              to: email,
              subject,
              html: personalizedHtml,
            });

            // store record in Firestore if available
            if (db) {
              try {
                await addDoc(collection(db, "sent_mails"), {
                  email,
                  sentAt: serverTimestamp(),
                });
              } catch (e) {
                console.warn("Failed logging sent mail to Firestore:", e.message || e);
              }
            }
          } catch (sendErr) {
            console.error(`Failed to send to ${email}:`, sendErr.message || sendErr);
          }
        }

        fs.unlinkSync(csvFilePath);
        res.json({ success: true, message: `✅ Sent ${recipients.length} emails successfully.` });
      });
  } catch (error) {
    console.error("Mail send error:", error);
    res.status(500).json({ error: "Failed to send emails" });
  }
});

// =======================================================
// 📦 Advanced CSV sender with logo/banner inline attachments
// =======================================================
app.post(
  "/send-csv",
  upload.fields([
    { name: "csvFile", maxCount: 1 },
    { name: "logoFile", maxCount: 1 },
    { name: "bannerFile", maxCount: 1 },
    // Accept arbitrary file attachments from the frontend UI
    { name: "attachments", maxCount: 20 },
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
            // Note: 'sharp' dependency is not guaranteed to be installed/compiled on Render.
            // If this block is hit and sharp is not installed, it will fall back to the catch block.
            const sharp = (await import("sharp")).default;
            const pngBuffer = await sharp(content).png().toBuffer();
            content = pngBuffer;
            contentType = "image/png";
            const base = path.basename(filename, path.extname(filename));
            outFilename = `${base}.png`;
          } catch (e) {
            const msg = `Inline image "${filename}" has unsupported type (${detected}). Using the original file, which may not display correctly. Error details: ${e.message}`;
            console.warn(msg);
            // Fallback: If sharp fails or is missing, use the original file.
          }
        }

        return {
          filename: outFilename,
          content,
          contentType,
          cid: cidDefault,
        };
      };

      if (!logoUrl && req.files.logoFile) {
        const lf = req.files.logoFile[0];
        try {
          attachments.push(await processInlineImage(lf, logoCid, "logo"));
        } catch (e) {
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

    const results = { sent: 0, failed: 0, failures: [], details: [] };

      // Prepare user-uploaded generic attachments (non-inline)
      const genericAttachments = (req.files.attachments || []).map((file) => ({
        filename: file.originalname || "attachment",
        path: file.path,
        contentType: file.mimetype,
      }));

      for (const r of recipients) {
        const email = r.email || r.Email;
        const name = r.name || r.Name || "";
        if (!email) continue;

        // Use the provided HTML as-is (already includes logo/banner from the generator).
        // Only personalize [Name] placeholders to avoid duplicating images.
        const personalizedHtml = html.replace(/\[Name\]/g, name);

        try {
          const attachmentsInline = attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.isBuffer(a.content) ? Buffer.from(a.content) : a.content,
            cid: a.cid,
            contentType: a.contentType,
          }));
          const attachmentsForSend = [...attachmentsInline, ...genericAttachments];

          await bulkTransporter.sendMail({
            from: `"${fromName}" <${BULK_EMAIL_USER}>`,
            to: email,
            subject,
            html: personalizedHtml,
            // Do not add inline logo/banner here — the generated HTML already contains them
            attachments: attachmentsForSend.length ? attachmentsForSend : undefined,
          });
          console.log(`✅ Sent to ${email}`);
          results.sent += 1;
          results.details.push({ email, status: "sent" });
        } catch (err) {
          results.failed += 1;
          results.failures.push({ email, error: err.message });
          results.details.push({ email, status: "failed", error: err.message });
        }

        if (delayMs > 0) await delay(delayMs);
      }

      // --- Cleanup uploaded files ---
      Object.values(req.files).forEach((fileArr) =>
        fileArr.forEach((file) => {
          try {
            fs.unlinkSync(file.path);
          } catch (e) {
            if (e?.code !== "ENOENT") {
              console.warn(`Cleanup warning for ${file.path}:`, e.message);
            }
          }
        })
      );

    res.json({ success: true, summary: results });
    } catch (err) {
      console.error("Error in /send-csv:", err);
      return res.status(500).json({ error: "Internal server error", details: err.message });
    }
  }
);

// =======================================================
// 🔐 OTP routes
// =======================================================
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  otpStore[email] = { otp, expiresAt };

  try {
    await otpTransporter.sendMail({
      from: `"HYPERLOOP TEAM" <${OTP_EMAIL_USER}>`,
      to: email,
      subject: "✨ Your One-Time Password (OTP) for Login",
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f7f8fa; padding: 30px; text-align: center;">
            <div style="max-width: 450px; margin: auto; background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 25px;">
            <h2 style="color: #2f54eb; margin-bottom: 10px;">🔐 Secure Login Code</h2>
            <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                Use the OTP below to complete your login process. It’s valid for the next <strong>5 minutes</strong>.
            </p>
            <div style="font-size: 32px; letter-spacing: 6px; font-weight: bold; color: #2f54eb; background: #f0f5ff; padding: 15px; border-radius: 8px;">
                ${otp}
            </div>
            <p style="margin-top: 25px; color: #666; font-size: 14px;">
                Didn’t request this code? Please ignore this email.
            </p>
            <hr style="border: none; height: 1px; background: #eee; margin: 25px 0;">
            <p style="font-size: 13px; color: #999;">
                © ${new Date().getFullYear()} HYPERLOOP. All rights reserved.
            </p>
            </div>
        </div>
      `,
    });

    if (db) {
      try {
        await addDoc(collection(db, "sent_mails"), {
          email,
          sentAt: serverTimestamp(),
        });
      } catch (e) {
        console.warn("Failed logging OTP send to Firestore:", e.message || e);
      }
    }

    res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("Error sending mail:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ success: false, message: "Missing email or otp" });

  const record = otpStore[email];
  if (!record) return res.json({ success: false, message: "OTP not found. Request a new code." });

  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.json({ success: false, message: "OTP expired. Please request a new one." });
  }

  if (record.otp !== otp) {
    return res.json({ success: false, message: "Invalid OTP. Please try again." });
  }

  delete otpStore[email];
  return res.json({ success: true, message: "OTP verified" });
});

// ---------------- CLEANUP EXPIRED OTPS ----------------
setInterval(() => {
  const now = Date.now();
  for (const e of Object.keys(otpStore)) {
    if (otpStore[e].expiresAt <= now) delete otpStore[e];
  }
}, 60 * 1000);

// 🧪 Health route
app.get("/", (req, res) => res.send("📬 Unified Mail Server Running"));

// Start server strictly on port 4000 (to match the frontend expectations)
const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Final sender running on http://localhost:${PORT}`);
});
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use. Please free it or change the frontend/backend port.`);
  } else {
    console.error("Server failed to start:", err);
  }
  process.exit(1);
});
