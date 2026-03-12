const { DEFAULT_EMAIL_TEMPLATES } = require("./customization");

function interpolate(template, values) {
  return String(template || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = values?.[key];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(text) {
  const escaped = escapeHtml(text);
  const linkified = escaped.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  return linkified.replace(/\n/g, "<br>");
}

function renderTemplatedEmail(customization, templateKey, fallback, values) {
  const customTemplate = customization?.emailTemplates?.[templateKey];
  const defaultTemplate = DEFAULT_EMAIL_TEMPLATES[templateKey] || {};

  const subjectTemplate = String(customTemplate?.subject || "").trim() || String(defaultTemplate.subject || fallback.subject || "AccessGuard Notification");
  const bodyTemplate = String(customTemplate?.body || "");
  const fallbackBody = String(fallback?.text || "");

  const subject = cleanText(interpolate(subjectTemplate, values));
  const text = cleanText(interpolate(bodyTemplate.length > 0 ? bodyTemplate : (defaultTemplate.body || fallbackBody), values));
  const html = textToHtml(text);

  return { subject, text, html };
}

module.exports = {
  renderTemplatedEmail
};
