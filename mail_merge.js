import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch"; // Using node-fetch for compatibility when needed
import dotenv from "dotenv";
import multer from "multer";
import csvParser from "csv-parser";
import fs from "fs";
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
  const firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
} catch (err) {
  console.warn("Firebase init failed or already initialized:", err.message || err);
}

// ---------------- NODEMAILER SETUP ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ---------------- OTP STORE ----------------
const otpStore = {};

// ---------------- DEFAULT EMAIL TEMPLATE (from server.js) ----------------
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

// --- GEMINI / AI email generation endpoint setup (from server.js) ---
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
// 🚀 MAIL SENDER / CSV + MULTER HANDLER (from server.js)
// =======================================================
const upload = multer({ dest: "uploads/" });

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
            await transporter.sendMail({
              from: `"Mail Buddy" <${process.env.EMAIL_USER}>`,
              to: email,
              subject,
              html: personalizedHtml,
            });
            console.log(`✅ Sent to ${email}`);

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

// ---------------- SEND OTP (from mail.js) ----------------
app.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  otpStore[email] = { otp, expiresAt };

  console.log(`🔐 OTP for ${email}: ${otp} (expires in 5 minutes)`);

  try {
    await transporter.sendMail({
      from: `"HYPERLOOP TEAM" <${process.env.EMAIL_USER}>`,
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

    // ✅ Store email + timestamp in Firestore if available
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

// ---------------- VERIFY OTP (from mail.js) ----------------
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

// Start server with EADDRINUSE handling (try next ports if needed)
const initialPort = parseInt(process.env.PORT, 10) || 3000;
const maxAttempts = 20;

async function startServer(port, attemptsLeft) {
  for (let i = 0; i < attemptsLeft; i++) {
    const tryPort = port + i;
    try {
      await new Promise((resolve, reject) => {
        const srv = app.listen(tryPort, () => {
          console.log(`🚀 Mail merge server running on http://localhost:${tryPort}`);
          resolve();
        });
        srv.on("error", (err) => reject(err));
      });
      return;
    } catch (err) {
      if (err && err.code === "EADDRINUSE") {
        console.warn(`Port ${port + i} in use, trying ${port + i + 1}...`);
        continue;
      }
      console.error("Server failed to start:", err);
      process.exit(1);
    }
  }

  console.error(`Failed to bind to a port after ${attemptsLeft} attempts starting at ${port}.`);
  process.exit(1);
}

startServer(initialPort, maxAttempts);
