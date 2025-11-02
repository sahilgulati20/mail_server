// mail.js
import express from "express";
import nodemailer from "nodemailer";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
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

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ---------------- OTP STORE ----------------
const otpStore = {};

// ---------------- NODEMAILER SETUP ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ---------------- SEND OTP ----------------
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

    // ✅ Store email + timestamp in Firestore
    await addDoc(collection(db, "sent_mails"), {
      email,
      sentAt: serverTimestamp(),
    });

    res.json({ success: true, message: "OTP sent" });
  } catch (err) {
    console.error("Error sending mail:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

// ---------------- VERIFY OTP ----------------
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp)
    return res.status(400).json({ success: false, message: "Missing email or otp" });

  const record = otpStore[email];
  if (!record)
    return res.json({ success: false, message: "OTP not found. Request a new code." });

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ mail.js server running on http://localhost:${PORT}`)
);
