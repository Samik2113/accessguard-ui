const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const { sendEmail } = require("../_shared/email");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  required: ["mode"],
  properties: {
    mode: { type: "string", enum: ["REMINDER", "ESCALATE"] },
    cycleId: { type: "string" },
    appId: { type: "string" },
    managerId: { type: "string" },
    dryRun: { type: "boolean" }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) {
      return bad(400, "VALIDATION_ERROR", "Invalid request payload", req, validate.errors || []);
    }

    const mode = String(body.mode || "").toUpperCase();
    const cycleId = String(body.cycleId || "").trim();
    const appId = String(body.appId || "").trim();
    const managerIdFilter = String(body.managerId || "").trim();
    const dryRun = body.dryRun === true;

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "INTERNAL_ERROR", "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const itemsC = db.container("reviewItems");
    const hrC = db.container("hrUsers");
    const cyclesC = db.container("reviewCycles");
    const logsC = db.container("auditLogs");

    let query = "SELECT c.id, c.reviewCycleId, c.appId, c.appName, c.userName, c.appUserId, c.entitlement, c.managerId, c.status, c.createdAt FROM c WHERE UPPER(c.status)=@pending";
    const parameters = [{ name: "@pending", value: "PENDING" }];

    if (cycleId) {
      query += " AND c.reviewCycleId=@cycleId";
      parameters.push({ name: "@cycleId", value: cycleId });
    }
    if (appId) {
      query += " AND c.appId=@appId";
      parameters.push({ name: "@appId", value: appId });
    }
    if (managerIdFilter) {
      query += " AND c.managerId=@managerId";
      parameters.push({ name: "@managerId", value: managerIdFilter });
    }

    const { resources: pendingItems } = await itemsC.items.query({ query, parameters }).fetchAll();
    const grouped = new Map();

    for (const item of pendingItems || []) {
      const managerId = String(item.managerId || "").trim();
      if (!managerId) continue;
      const entry = grouped.get(managerId) || {
        managerId,
        appNames: new Set(),
        cycleIds: new Set(),
        itemIds: [],
        sampleUsers: new Set(),
        oldestCreatedAt: item.createdAt || null
      };
      entry.itemIds.push(String(item.id || ""));
      entry.appNames.add(String(item.appName || item.appId || "Unknown"));
      entry.cycleIds.add(String(item.reviewCycleId || ""));
      if (item.userName) entry.sampleUsers.add(String(item.userName));
      if (!entry.oldestCreatedAt || (item.createdAt && new Date(item.createdAt).getTime() < new Date(entry.oldestCreatedAt).getTime())) {
        entry.oldestCreatedAt = item.createdAt;
      }
      grouped.set(managerId, entry);
    }

    const portalUrl = String(process.env.NOTIFY_PORTAL_URL || process.env.VITE_API_BASE_URL || "").trim();
    const results = [];

    for (const [, group] of grouped.entries()) {
      let reviewerHr = null;
      try {
        const reviewerRead = await hrC.item(group.managerId, group.managerId).read();
        reviewerHr = reviewerRead?.resource || null;
      } catch (_) {
      }

      const reviewerEmail = String(reviewerHr?.email || "").trim().toLowerCase();
      const reviewerName = String(reviewerHr?.name || group.managerId);
      const appLabel = Array.from(group.appNames).slice(0, 3).join(", ");
      const pendingCount = group.itemIds.length;
      const cycleLabel = Array.from(group.cycleIds).filter(Boolean).join(", ");

      if (mode === "REMINDER") {
        if (!reviewerEmail) {
          results.push({ managerId: group.managerId, ok: false, skipped: true, reason: "NO_REVIEWER_EMAIL", pendingCount });
          continue;
        }

        const subject = `[AccessGuard] Reminder: ${pendingCount} review item(s) pending`;
        const text = [
          `Hello ${reviewerName},`,
          "",
          `You have ${pendingCount} pending review item(s).`,
          appLabel ? `Applications: ${appLabel}` : null,
          cycleLabel ? `Campaign(s): ${cycleLabel}` : null,
          group.oldestCreatedAt ? `Oldest pending assigned: ${new Date(group.oldestCreatedAt).toLocaleString()}` : null,
          portalUrl ? `Portal: ${portalUrl}` : null,
          "",
          "Please review and submit your decisions."
        ].filter(Boolean).join("\n");

        const sendResult = dryRun
          ? { ok: true, skipped: true, reason: "DRY_RUN" }
          : await sendEmail(context, {
              to: reviewerEmail,
              subject,
              text,
              metadata: {
                type: "REVIEW_REMINDER",
                managerId: group.managerId,
                pendingCount,
                cycleIds: Array.from(group.cycleIds)
              }
            });

        results.push({ managerId: group.managerId, to: reviewerEmail, pendingCount, ...sendResult });
      } else {
        const managerOfReviewerId = String(reviewerHr?.managerId || "").trim();
        if (!managerOfReviewerId) {
          results.push({ managerId: group.managerId, ok: false, skipped: true, reason: "NO_LINE_MANAGER", pendingCount });
          continue;
        }

        let lineManagerHr = null;
        try {
          const lineManagerRead = await hrC.item(managerOfReviewerId, managerOfReviewerId).read();
          lineManagerHr = lineManagerRead?.resource || null;
        } catch (_) {
        }

        const lineManagerEmail = String(lineManagerHr?.email || "").trim().toLowerCase();
        if (!lineManagerEmail) {
          results.push({ managerId: group.managerId, ok: false, skipped: true, reason: "NO_MANAGER_EMAIL", pendingCount });
          continue;
        }

        const cycleInfo = cycleId && appId ? await readCycle(cyclesC, cycleId, appId) : null;
        const dueDate = cycleInfo?.dueDate ? new Date(cycleInfo.dueDate).toLocaleDateString() : null;

        const subject = `[AccessGuard] Escalation: reviewer has ${pendingCount} pending item(s)`;
        const text = [
          `Hello ${lineManagerHr?.name || managerOfReviewerId},`,
          "",
          `Escalation for reviewer ${reviewerName} (${group.managerId}).`,
          `Pending review items: ${pendingCount}`,
          appLabel ? `Applications: ${appLabel}` : null,
          cycleLabel ? `Campaign(s): ${cycleLabel}` : null,
          dueDate ? `Campaign due date: ${dueDate}` : null,
          group.oldestCreatedAt ? `Oldest pending assigned: ${new Date(group.oldestCreatedAt).toLocaleString()}` : null,
          portalUrl ? `Portal: ${portalUrl}` : null,
          "",
          "Please follow up to ensure review completion."
        ].filter(Boolean).join("\n");

        const sendResult = dryRun
          ? { ok: true, skipped: true, reason: "DRY_RUN" }
          : await sendEmail(context, {
              to: lineManagerEmail,
              subject,
              text,
              metadata: {
                type: "REVIEW_ESCALATION",
                reviewerId: group.managerId,
                escalatedToManagerId: managerOfReviewerId,
                pendingCount,
                cycleIds: Array.from(group.cycleIds)
              }
            });

        results.push({ managerId: group.managerId, escalatedTo: managerOfReviewerId, to: lineManagerEmail, pendingCount, ...sendResult });
      }
    }

    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    const now = new Date().toISOString();

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      type: "audit",
      timestamp: now,
      userId: actorId,
      userName: actorName,
      action: mode === "ESCALATE" ? "REVIEW_ESCALATION_TRIGGER" : "REVIEW_REMINDER_TRIGGER",
      details: `mode=${mode}; pendingGroups=${grouped.size}; sent=${results.filter((result) => result.ok && !result.skipped).length}; skipped=${results.filter((result) => result.skipped).length}`
    });

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        mode,
        pendingItemCount: (pendingItems || []).length,
        reviewerGroups: grouped.size,
        sent: results.filter((result) => result.ok && !result.skipped).length,
        skipped: results.filter((result) => result.skipped).length,
        results
      }
    };
  } catch (err) {
    context.log.error("reviews-notify error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

async function readCycle(cyclesC, cycleId, appId) {
  try {
    const { resource } = await cyclesC.item(cycleId, appId).read();
    return resource || null;
  } catch (_) {
    return null;
  }
}

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}

function bad(status, code, message, req, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}
