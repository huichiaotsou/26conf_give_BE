const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const {
  GOOGLE_SENDER_EMAIL,
  GOOGLE_APP_PASSWORD,
  GIVING_EMAIL_BANNER_PATH,
  GIVING_REPORT_URL,
} = process.env;

const REQUIRED_ENV_VARS = ["GOOGLE_SENDER_EMAIL", "GOOGLE_APP_PASSWORD"];

const DEFAULT_SUBJECT =
  "感謝你的慷慨參與 — 因著你的奉獻，我們一起贏得城市的 1%";
const DEFAULT_GIVING_REPORT_URL = "https://thehope.co/25report";

const TEMPLATE_PATH = path.join(
  __dirname,
  "..",
  "emails",
  "givingSuccess.html"
);

let cachedTemplate;
let cachedTransporter;
const bannerCid = "giving-banner";

function areEmailEnvsReady() {
  return REQUIRED_ENV_VARS.every((key) => !!process.env[key]);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || "");
}

function resolveBannerAttachment() {
  if (!GIVING_EMAIL_BANNER_PATH) return null;

  if (isHttpUrl(GIVING_EMAIL_BANNER_PATH)) {
    return {
      filename: path.basename(new URL(GIVING_EMAIL_BANNER_PATH).pathname) || "banner",
      path: GIVING_EMAIL_BANNER_PATH,
      cid: bannerCid,
    };
  }

  const bannerAbsolutePath = path.resolve(GIVING_EMAIL_BANNER_PATH);
  if (!fs.existsSync(bannerAbsolutePath)) {
    console.warn(
      `[emailService] Banner image missing at ${bannerAbsolutePath}. Skipping attachment.`
    );
    return null;
  }

  return {
    filename: path.basename(bannerAbsolutePath),
    path: bannerAbsolutePath,
    cid: bannerCid,
  };
}

function loadTemplate() {
  if (cachedTemplate) return cachedTemplate;

  try {
    const fileContents = fs.readFileSync(TEMPLATE_PATH, "utf-8");
    const subjectMatch = fileContents.match(/<!--\s*subject:(.*?)-->/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : DEFAULT_SUBJECT;
    const html = subjectMatch
      ? fileContents.replace(subjectMatch[0], "").trimStart()
      : fileContents;

    cachedTemplate = { html, subject };
    return cachedTemplate;
  } catch (error) {
    console.warn(
      `[emailService] Failed to read template at ${TEMPLATE_PATH}. Using fallback copy.`,
      error.message
    );
    cachedTemplate = {
      html: "<p>感謝你在特會中的慷慨給予</p>",
      subject: DEFAULT_SUBJECT,
    };
    return cachedTemplate;
  }
}

function applyTemplate(html, context = {}) {
  if (!html) return "";

  return html.replace(/{{\s*([^}\s]+)\s*}}/g, (_, token) => {
    const value = context[token];
    return value === undefined || value === null ? "" : String(value);
  });
}

function insertBanner(html) {
  const bannerAttachment = resolveBannerAttachment();
  if (!bannerAttachment) return { html, attachments: [] };

  const bannerMarkup = `<div style="text-align:center; margin-bottom: 16px;">
    <img src="cid:${bannerAttachment.cid}" alt="The Hope" style="max-width: 100%;" />
  </div>`;

  if (html.includes("{{banner}}")) {
    return {
      html: html.replace(/{{\s*banner\s*}}/g, bannerMarkup),
      attachments: [bannerAttachment],
    };
  }

  return {
    html,
    attachments: [],
  };
}

function getTransporter() {
  if (!areEmailEnvsReady()) {
    throw new Error(
      "Missing Google Workspace env vars. Configure GOOGLE_SENDER_EMAIL and GOOGLE_APP_PASSWORD."
    );
  }

  if (cachedTransporter) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GOOGLE_SENDER_EMAIL,
      pass: GOOGLE_APP_PASSWORD,
    },
  });

  return cachedTransporter;
}

async function sendGivingSuccessEmail({
  recipient,
  subject,
  htmlBody,
  templateContext = {},
} = {}) {
  if (!recipient) {
    console.warn("[emailService] Missing recipient email. Skipping send.");
    return;
  }

  if (!areEmailEnvsReady()) {
    console.warn("[emailService] Email env vars not ready. Skipping send.");
    return;
  }

  const template = htmlBody
    ? { html: htmlBody, subject: DEFAULT_SUBJECT }
    : loadTemplate();

  const hydratedHtml = applyTemplate(template.html, {
    annualReportUrl: GIVING_REPORT_URL || DEFAULT_GIVING_REPORT_URL,
    ...templateContext,
  });
  const { html, attachments } = insertBanner(hydratedHtml);

  const mailOptions = {
    from: `The Hope <${GOOGLE_SENDER_EMAIL}>`,
    to: recipient,
    subject: subject || template.subject || DEFAULT_SUBJECT,
    html,
    attachments,
  };

  try {
    const transporter = getTransporter();
    await transporter.sendMail(mailOptions);
    console.log(`[emailService] Donation email sent to ${recipient}`);
  } catch (error) {
    console.error("[emailService] Failed to send donation email", error);
  }
}

module.exports = {
  sendGivingSuccessEmail,
  areGoogleEnvsReady: areEmailEnvsReady,
};
