const SETTINGS_ID = "APP_CUSTOMIZATION_GLOBAL";
const DEFAULT_IDLE_TIMEOUT_MINUTES = 8 * 60;
const DEFAULT_HR_FEED_SCHEMA = {
  mappings: {
    userId: "userId",
    name: "name",
    givenName: "givenName",
    surname: "surname",
    description: "description",
    email: "email",
    enabled: "enabled",
    employeeId: "employeeId",
    status: "status",
    department: "department",
    city: "city",
    managerId: "managerId",
    title: "title",
    creationDate: "creationDate",
    lastLogonDate: "lastLogonDate"
  },
  ignoreColumns: [],
  customColumns: [],
  statusRules: {
    activeValues: ["active", "enabled", "enable", "yes", "true", "1", "onroll", "current"],
    inactiveValues: ["inactive", "terminated", "disable", "disabled", "no", "false", "0", "offboarded", "separated"]
  }
};

const DEFAULT_EMAIL_TEMPLATES = {
  reviewAssignment: {
    subject: "[AccessGuard] Review items assigned ({{appName}})",
    body: [
      "Hello {{reviewerName}},",
      "",
      "You have {{pendingCount}} review item(s) assigned for campaign \"{{cycleName}}\" ({{appName}}).",
      "Due date: {{dueDate}}",
      "{{portalLine}}",
      "",
      "Please review and submit your decisions."
    ].join("\n")
  },
  reviewReminder: {
    subject: "[AccessGuard] Reminder: {{pendingCount}} review item(s) pending",
    body: [
      "Hello {{reviewerName}},",
      "",
      "You have {{pendingCount}} pending review item(s).",
      "Applications: {{appLabel}}",
      "Campaign(s): {{cycleLabel}}",
      "Oldest pending assigned: {{oldestAssigned}}",
      "{{portalLine}}",
      "",
      "Please review and submit your decisions."
    ].join("\n")
  },
  reviewEscalation: {
    subject: "[AccessGuard] Escalation: reviewer has {{pendingCount}} pending item(s)",
    body: [
      "Hello {{lineManagerName}},",
      "",
      "Escalation for reviewer {{reviewerName}} ({{reviewerId}}).",
      "Pending review items: {{pendingCount}}",
      "Applications: {{appLabel}}",
      "Campaign(s): {{cycleLabel}}",
      "Campaign due date: {{dueDate}}",
      "Oldest pending assigned: {{oldestAssigned}}",
      "{{portalLine}}",
      "",
      "Please follow up to ensure review completion."
    ].join("\n")
  },
  reviewConfirmationReminder: {
    subject: "[AccessGuard] Reminder: confirmation pending for {{cycleLabel}}",
    body: [
      "Hello {{reviewerName}},",
      "",
      "All your review decisions are captured, but your final confirmation is still pending.",
      "Campaign(s): {{cycleLabel}}",
      "Applications: {{appLabel}}",
      "{{portalLine}}",
      "",
      "Please lock and close your review submission."
    ].join("\n")
  },
  reviewConfirmationEscalation: {
    subject: "[AccessGuard] Escalation: confirmation pending for reviewer {{reviewerName}}",
    body: [
      "Hello {{lineManagerName}},",
      "",
      "Escalation for reviewer {{reviewerName}} ({{reviewerId}}) who has not locked and closed the campaign.",
      "Campaign(s): {{cycleLabel}}",
      "Applications: {{appLabel}}",
      "Campaign due date: {{dueDate}}",
      "{{portalLine}}",
      "",
      "Please follow up to ensure final confirmation is submitted."
    ].join("\n")
  },
  remediationNotify: {
    subject: "[AccessGuard] {{subjectPrefix}}: {{pendingCount}} remediation item(s) pending",
    body: [
      "Hello,",
      "",
      "{{pendingCount}} item(s) are pending remediation for campaign {{cycleId}}.",
      "Application: {{appName}}",
      "Due date: {{dueDate}}",
      "",
      "Attached CSV contains all open remediation items."
    ].join("\n")
  },
  reviewReassigned: {
    subject: "[AccessGuard] Review item reassigned to you ({{appName}})",
    body: [
      "Hello {{reviewerName}},",
      "",
      "A review item has been reassigned to you.",
      "Item ID: {{itemId}}",
      "Application: {{appName}}",
      "Entitlement: {{entitlement}}",
      "Reviewed user: {{reviewedUser}}",
      "{{portalLine}}",
      "",
      "Please review and take action."
    ].join("\n")
  },
  reviewReassignedBulk: {
    subject: "[AccessGuard] {{itemCount}} review item(s) reassigned to you",
    body: [
      "Hello {{reviewerName}},",
      "",
      "{{itemCount}} review item(s) have been reassigned to you.",
      "",
      "Items:",
      "{{itemSummary}}",
      "{{portalLine}}",
      "",
      "Please review and take action."
    ].join("\n")
  }
};

const DEFAULT_CUSTOMIZATION = {
  platformName: "AccessGuard",
  primaryColor: "#2563eb",
  environmentLabel: "Development",
  loginSubtitle: "Sign in with emailId and password.",
  supportEmail: "",
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  hrFeedSchema: DEFAULT_HR_FEED_SCHEMA,
  emailTemplates: DEFAULT_EMAIL_TEMPLATES
};

function normalizeStringArray(input, fallback) {
  if (!Array.isArray(input)) return [...fallback];
  const values = input.map((value) => String(value || "").trim()).filter(Boolean);
  return values.length > 0 ? values : [...fallback];
}

function normalizeHrFeedSchema(input) {
  const mappings = {};
  Object.entries(DEFAULT_HR_FEED_SCHEMA.mappings).forEach(([key, fallback]) => {
    mappings[key] = String(input?.mappings?.[key] || fallback).trim() || fallback;
  });
  return {
    mappings,
    ignoreColumns: Array.isArray(input?.ignoreColumns) ? input.ignoreColumns.map((value) => String(value || "").trim()).filter(Boolean) : [],
    customColumns: Array.isArray(input?.customColumns) ? input.customColumns.map((value) => String(value || "").trim()).filter(Boolean) : [],
    statusRules: {
      activeValues: normalizeStringArray(input?.statusRules?.activeValues, DEFAULT_HR_FEED_SCHEMA.statusRules.activeValues),
      inactiveValues: normalizeStringArray(input?.statusRules?.inactiveValues, DEFAULT_HR_FEED_SCHEMA.statusRules.inactiveValues)
    }
  };
}

function normalizeHexColor(input, fallback) {
  const value = String(input || "").trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return value;
  return fallback;
}

function normalizeIdleTimeoutMinutes(input, fallback) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(24 * 60, Math.max(5, Math.round(parsed)));
}

function normalizeTemplate(template, fallback) {
  const subject = String(template?.subject || "").trim();
  const body = String(template?.body || "");
  return {
    subject: subject || fallback.subject,
    body: body.length > 0 ? body : fallback.body
  };
}

function normalizeEmailTemplates(input) {
  return {
    reviewAssignment: normalizeTemplate(input?.reviewAssignment, DEFAULT_EMAIL_TEMPLATES.reviewAssignment),
    reviewReminder: normalizeTemplate(input?.reviewReminder, DEFAULT_EMAIL_TEMPLATES.reviewReminder),
    reviewEscalation: normalizeTemplate(input?.reviewEscalation, DEFAULT_EMAIL_TEMPLATES.reviewEscalation),
    reviewConfirmationReminder: normalizeTemplate(input?.reviewConfirmationReminder, DEFAULT_EMAIL_TEMPLATES.reviewConfirmationReminder),
    reviewConfirmationEscalation: normalizeTemplate(input?.reviewConfirmationEscalation, DEFAULT_EMAIL_TEMPLATES.reviewConfirmationEscalation),
    remediationNotify: normalizeTemplate(input?.remediationNotify, DEFAULT_EMAIL_TEMPLATES.remediationNotify),
    reviewReassigned: normalizeTemplate(input?.reviewReassigned, DEFAULT_EMAIL_TEMPLATES.reviewReassigned),
    reviewReassignedBulk: normalizeTemplate(input?.reviewReassignedBulk, DEFAULT_EMAIL_TEMPLATES.reviewReassignedBulk)
  };
}

function normalizeCustomization(input) {
  return {
    platformName: String(input?.platformName || DEFAULT_CUSTOMIZATION.platformName),
    primaryColor: normalizeHexColor(input?.primaryColor, DEFAULT_CUSTOMIZATION.primaryColor),
    environmentLabel: String(input?.environmentLabel || DEFAULT_CUSTOMIZATION.environmentLabel),
    loginSubtitle: String(input?.loginSubtitle || DEFAULT_CUSTOMIZATION.loginSubtitle),
    supportEmail: String(input?.supportEmail || DEFAULT_CUSTOMIZATION.supportEmail),
    idleTimeoutMinutes: normalizeIdleTimeoutMinutes(input?.idleTimeoutMinutes, DEFAULT_CUSTOMIZATION.idleTimeoutMinutes),
    hrFeedSchema: normalizeHrFeedSchema(input?.hrFeedSchema),
    emailTemplates: normalizeEmailTemplates(input?.emailTemplates)
  };
}

async function readAppCustomization(logsContainer) {
  try {
    const { resource } = await logsContainer.item(SETTINGS_ID, SETTINGS_ID).read();
    if (resource?.customization) return normalizeCustomization(resource.customization);
  } catch (_) {
  }

  try {
    const { resources } = await logsContainer.items.query({
      query: "SELECT TOP 1 c.customization FROM c WHERE c.id=@id OR c.type='app-customization' ORDER BY c._ts DESC",
      parameters: [{ name: "@id", value: SETTINGS_ID }]
    }).fetchAll();
    const hit = resources?.[0]?.customization;
    if (hit) return normalizeCustomization(hit);
  } catch (_) {
  }

  return normalizeCustomization(DEFAULT_CUSTOMIZATION);
}

module.exports = {
  SETTINGS_ID,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_CUSTOMIZATION,
  DEFAULT_HR_FEED_SCHEMA,
  normalizeCustomization,
  readAppCustomization
};
