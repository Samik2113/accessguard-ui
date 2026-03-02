function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

async function sendEmail(context, message) {
  const enabled = parseBool(process.env.NOTIFY_EMAIL_ENABLED, false);
  const webhookUrl = String(process.env.NOTIFY_EMAIL_WEBHOOK_URL || "").trim();
  const from = "Samiksha.Agarwal1@in.ey.com";

  if (!enabled) {
    return { ok: false, skipped: true, reason: "NOTIFY_EMAIL_ENABLED=false" };
  }

  if (!webhookUrl) {
    return { ok: false, skipped: true, reason: "NOTIFY_EMAIL_WEBHOOK_URL not configured" };
  }

  const to = Array.isArray(message?.to)
    ? message.to.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean)
    : [String(message?.to || "").trim().toLowerCase()].filter(Boolean);

  if (to.length === 0) {
    return { ok: false, skipped: true, reason: "No recipient email" };
  }

  const payload = {
    from,
    to,
    subject: String(message?.subject || "AccessGuard Notification"),
    text: String(message?.text || ""),
    html: message?.html ? String(message.html) : undefined,
    metadata: message?.metadata || {}
  };

  const headers = {
    "Content-Type": "application/json"
  };

  const apiKey = String(process.env.NOTIFY_EMAIL_API_KEY || "").trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      context?.log?.error?.("[email] send failed", {
        status: response.status,
        statusText: response.statusText,
        body: body?.slice?.(0, 1000) || body
      });
      return { ok: false, status: response.status, error: body || response.statusText };
    }

    return { ok: true };
  } catch (error) {
    context?.log?.error?.("[email] send exception", error?.stack || error);
    return { ok: false, error: error?.message || String(error) };
  }
}

module.exports = {
  sendEmail,
  parseBool
};
