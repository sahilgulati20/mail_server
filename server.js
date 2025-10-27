import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch"; // Using node-fetch for compatibility
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// --- YOUR DEFAULT EMAIL TEMPLATE ---
// This is the "default design" you provided.
// The AI will use this as the starting point for every email.
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
    </s'p>
  </div>
</body>
</html>
`;

// --- Utility Functions ---

/**
 * A utility function to implement exponential backoff for API retries.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches data from the Gemini API with exponential backoff.
 * @param {string} url - The API endpoint URL.
 * @param {object} payload - The request payload.
 *@param {number} maxRetries - Maximum number of retries.
 * @returns {Promise<object>} - The JSON response from the API.
 */
async function fetchWithBackoff(url, payload, maxRetries = 5) {
  let attempt = 0;
  let backoffTime = 1000; // Start with 1 second

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        return await response.json();
      }

      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        console.warn(`Attempt ${attempt + 1}: Received status ${response.status}. Retrying in ${backoffTime}ms...`);
        await delay(backoffTime);
        backoffTime *= 2; 
        attempt++;
      } else {
        console.error(`Attempt ${attempt + 1}: Received status ${response.status}. Aborting retry.`);
        const errorData = await response.json().catch(() => ({ error: { message: "Failed to parse error response" } }));
        throw new Error(JSON.stringify(errorData));
      }
    } catch (error) {
      if (attempt >= maxRetries - 1) {
        console.error("Max retries reached. Throwing error.");
        throw error;
      }
      console.warn(`Attempt ${attempt + 1}: Network error or fetch failed. Retrying in ${backoffTime}ms...`);
      await delay(backoffTime);
      backoffTime *= 2;
      attempt++;
    }
  }

  throw new Error("Failed to fetch from Gemini API after max retries.");
}

// --- API Endpoint ---

app.post("/generate-email", async (req, res) => {
  // Now accepts optional 'designPrompt' and 'placementInstructions'
  const { content, hasLogo, hasBanner, designPrompt, placementInstructions } = req.body;

  // Validate input
  if (!content) {
    return res.status(400).json({ error: "Missing 'content' in the request body." });
  }

  console.log("📩 Received email modification request...");

  // This is the new, more powerful prompt.
  // It tells the AI to EDIT the template instead of creating a new one.
  const prompt = `
You are an expert HTML email designer. Your task is to modify an existing HTML email template based on user instructions.

**Here is the base HTML template you MUST start with:**
\`\`\`html
${DEFAULT_EMAIL_TEMPLATE}
\`\`\`

**User Instructions (Process these in order):**

1.  **New Email Content:**
    * Replace the *existing* email body (the part inside \`<div data-section="email-body">\`) with the following new content.
    * You MUST format this new content using the CSS classes available in the template (like \`main-text\`, \`accent-text\`, \`accent-text-large\`, \`contact-info\`) to make it look professional.
    * **New Content to Insert:** "${content}"

2.  **Design & Theme (designPrompt: "${designPrompt || 'No instructions provided.'}"):**
    * The user provided these design instructions: "${designPrompt || 'No instructions provided.'}"
    * **CRITICAL:** If the instructions are "No instructions provided" or empty, you MUST **use the default design** (the purple theme, fonts, etc.) exactly as it is in the template.
    * If the user *did* provide instructions (e.g., "make it blue," "a dark, modern theme"), you MUST **modify the CSS** in the \`<style>\` block and any inline styles to match their request.

3.  **Logo (hasLogo: ${hasLogo}):**
    * If \`hasLogo\` is \`false\`, you MUST **remove** the entire logo div (\`<div data-section="logo">\`) from the HTML.
    * If \`hasLogo\` is \`true\`, you MUST **keep** it.

4.  **Banner (hasBanner: ${hasBanner}):**
    * If \`hasBanner\` is \`true\`, you MUST **add** a responsive banner image section.
    * Use this placeholder for the banner: \`<div style="text-align: center; margin-bottom: 20px;" data-section="banner"><img src="https://placehold.co/600x250/EFEFEF/AAAAAA?text=Banner+Image" alt="Banner" style="width:100%;max-width:600px;height:auto;display:block;margin:0 auto;border-radius:8px;"></div>\`
    * If \`hasBanner\` is \`false\`, do not add this section.

5.  **Placement (placementInstructions: "${placementInstructions || 'No instructions provided.'}"):**
    * The user provided these placement instructions: "${placementInstructions || 'No instructions provided.'}"
    * If instructions are provided (e.g., "put the logo on the left," "banner at the very top"), you MUST **modify the HTML structure** to move the logo (if present) and the banner (if added) to the requested locations.
    * If no instructions are provided, use the default layout: logo at the top-center, and the banner (if added) right below the logo.

**Output Rules:**
Your response MUST start *exactly* with \`<!DOCTYPE html>\` and contain ONLY the single, complete, modified HTML file. Do not include any explanations, markdown \`\`\`html tags, or any text before or after the HTML code.
`;

  // Construct the payload for the Gemini API
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    // Add safety settings to reduce blocking
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ],
  };

  try {
    // Send request to Gemini API
    const result = await fetchWithBackoff(GEMINI_URL, payload);

    // Extract the generated text
    const modelOutput =
      result.candidates?.[0]?.content?.parts?.[0]?.text ||
      "<!DOCTYPE html><html><body><p>Error: No content generated by the model.</p></body></html>";

    // Clean up the response
    let cleanHtml = modelOutput.trim();
    if (cleanHtml.startsWith("```html")) {
      cleanHtml = cleanHtml.substring(7);
    }
    if (cleanHtml.startsWith("```")) {
      cleanHtml = cleanHtml.substring(3);
    }
    if (cleanHtml.endsWith("```")) {
      cleanHtml = cleanHtml.substring(0, cleanHtml.length - 3);
    }
    
    if (!cleanHtml.startsWith("<!DOCTYPE html>")) {
        console.warn("Model output did not start with <!DOCTYPE html>. This might indicate an error.");
        // We don't prepend it here, as the model might be sending an error message.
    }

    console.log("✅ Successfully modified email template.");
    res.json({ html: cleanHtml });

  } catch (error) {
    console.error("🚨 Gemini API Error:", error.message || error);
    // Try to parse the error for more details
    let errorDetails = error.message;
    try {
        const parsedError = JSON.parse(error.message);
        if (parsedError.error && parsedError.error.message) {
            errorDetails = parsedError.error.message;
        }
    } catch (e) {
        // Not a JSON error message, use the original string
    }
    
    res.status(500).json({
      error: "Failed to generate email",
      details: errorDetails,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));

