// /reviews-item-action/index.js  (PATCH-based version)
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const { sendEmail } = require("../_shared/email");
const { readAppCustomization } = require("../_shared/customization");
const { renderTemplatedEmail } = require("../_shared/email-templates");
const ajv = new Ajv({ allErrors: true });
const schema = {
  type: "object",
  properties: {
    itemId: { type: "string", minLength: 1 },
    managerId: { type: "string", minLength: 1 },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["itemId", "managerId"],
        properties: {
          itemId: { type: "string", minLength: 1 },
          managerId: { type: "string", minLength: 1 },
          etag: { type: "string" }
        },
        additionalProperties: true
      }
    },
    status: { type: "string", minLength: 1 },
    reassignToManagerId: { type: "string" },
    comment: { type: "string" },
    remediationComment: { type: "string" },
    remediatedAt: { type: "string" }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, "VALIDATION_ERROR", "Invalid request payload", req, validate.errors || []);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const itemsC = db.container("reviewItems");
    const cyclesC = db.container("reviewCycles");
    const logsC = db.container("auditLogs");
    const hrC = db.container("hrUsers");

    const actorId = req.headers["x-actor-id"] || body.managerId || "SYSTEM";
    const now = new Date().toISOString();
    const maxReassignments = Math.max(Number(process.env.MAX_REASSIGNMENTS || 3), 1);

    const isBulkReassign = Array.isArray(body.items) && body.items.length > 0 && body.reassignToManagerId && String(body.reassignToManagerId).trim().length > 0;

    if (isBulkReassign) {
      const targetManagerId = String(body.reassignToManagerId).trim();
      const itemInputs = body.items;
      const customization = await readAppCustomization(logsC);
      const portalUrl = String(process.env.NOTIFY_PORTAL_URL || process.env.VITE_API_BASE_URL || "").trim();

      const results = [];
      for (const input of itemInputs) {
        try {
          const reassigned = await executeReassignment({
            itemsC,
            logsC,
            hrC,
            context,
            req,
            actorId,
            now,
            maxReassignments,
            itemId: String(input.itemId || "").trim(),
            fromManagerId: String(input.managerId || "").trim(),
            toManagerId: targetManagerId,
            comment: body.comment,
            requestIfMatch: input.etag,
            sendNotification: false,
            customization,
            portalUrl
          });
          results.push({ ok: true, itemId: reassigned.itemId, managerId: reassigned.managerId });
        } catch (error) {
          results.push({
            ok: false,
            itemId: String(input.itemId || ""),
            managerId: String(input.managerId || ""),
            error: error?.message || "Unknown error",
            code: error?.code || "INTERNAL_ERROR"
          });
        }
      }

      const successful = results.filter((result) => result.ok);
      if (successful.length > 0) {
        let targetHr = null;
        try {
          const hrRead = await hrC.item(targetManagerId, targetManagerId).read();
          targetHr = hrRead?.resource || null;
        } catch (_) {
        }

        const reviewerEmail = String(targetHr?.email || "").trim().toLowerCase();
        if (reviewerEmail) {
          const { resources: reassignedItems } = await itemsC.items.query({
            query: "SELECT c.id, c.reviewCycleId, c.appName, c.appId, c.entitlement, c.userName, c.appUserId FROM c WHERE ARRAY_CONTAINS(@ids, c.id)",
            parameters: [{ name: "@ids", value: successful.map((entry) => entry.itemId) }]
          }).fetchAll();

          const cycleNameByKey = new Map();
          const cycleKeys = Array.from(new Set((reassignedItems || []).map((item) => {
            const cycleId = String(item.reviewCycleId || "").trim();
            const appId = String(item.appId || "").trim();
            return `${cycleId}::${appId}`;
          }).filter((key) => key !== "::")));

          for (const key of cycleKeys) {
            const [cycleId, appId] = key.split("::");
            try {
              const { resource } = await cyclesC.item(cycleId, appId).read();
              cycleNameByKey.set(key, String(resource?.name || cycleId || "Unknown Campaign"));
            } catch (_) {
              cycleNameByKey.set(key, cycleId || "Unknown Campaign");
            }
          }

          const summaryLines = (reassignedItems || []).map((item) => {
            const cycleKey = `${String(item.reviewCycleId || "").trim()}::${String(item.appId || "").trim()}`;
            const cycleName = cycleNameByKey.get(cycleKey) || String(item.reviewCycleId || "Unknown Campaign");
            const appName = String(item.appName || item.appId || "Unknown");
            const entitlement = String(item.entitlement || "Unknown");
            const reviewedUser = String(item.userName || item.appUserId || "Unknown");
            return `- ${cycleName}: ${appName} | ${entitlement} | ${reviewedUser}`;
          });

          const fallbackText = [
            `Hello ${targetHr?.name || targetManagerId},`,
            "",
            `${successful.length} review item(s) have been reassigned to you.`,
            "",
            "Items:",
            ...summaryLines,
            portalUrl ? `Portal: ${portalUrl}` : null,
            "",
            "Please review and take action."
          ].filter(Boolean).join("\n");

          const emailContent = renderTemplatedEmail(
            customization,
            "reviewReassignedBulk",
            {
              subject: `[AccessGuard] ${successful.length} review item(s) reassigned to you`,
              text: fallbackText
            },
            {
              reviewerName: targetHr?.name || targetManagerId,
              pendingCount: successful.length,
              itemCount: successful.length,
              itemId: successful.map((entry) => entry.itemId).join(", "),
              appName: "Multiple Applications",
              entitlement: "Multiple",
              reviewedUser: "Multiple",
              itemSummary: summaryLines.join("\n"),
              portalUrl,
              portalLine: portalUrl ? `Portal: ${portalUrl}` : ""
            }
          );

          await sendEmail(context, {
            to: reviewerEmail,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
            metadata: {
              type: "REVIEW_REASSIGNED_BULK",
              itemIds: successful.map((entry) => entry.itemId),
              toManagerId: targetManagerId,
              itemCount: successful.length
            }
          });
        }
      }

      return ok({
        bulkReassigned: true,
        totalCount: itemInputs.length,
        successCount: successful.length,
        failedCount: results.length - successful.length,
        results
      }, req);
    }

    if (!body.itemId || !body.managerId) {
      return bad(400, "VALIDATION_ERROR", "itemId and managerId are required", req);
    }

    const requestIfMatch = req.headers?.["if-match"] || req.headers?.["If-Match"];
    if (!requestIfMatch || String(requestIfMatch).trim().length === 0) {
      return bad(428, "PRECONDITION_REQUIRED", "If-Match header is required", req);
    }

    if (body.reassignToManagerId && String(body.reassignToManagerId).trim().length > 0) {
      const targetManagerId = String(body.reassignToManagerId).trim();
      const customization = await readAppCustomization(logsC);
      const portalUrl = String(process.env.NOTIFY_PORTAL_URL || process.env.VITE_API_BASE_URL || "").trim();
      const reassigned = await executeReassignment({
        itemsC,
        logsC,
        hrC,
        context,
        req,
        actorId,
        now,
        maxReassignments,
        itemId: String(body.itemId),
        fromManagerId: String(body.managerId),
        toManagerId: targetManagerId,
        comment: body.comment,
        requestIfMatch,
        sendNotification: true,
        customization,
        portalUrl
      });
      return ok({ itemId: reassigned.itemId, managerId: reassigned.managerId, reassigned: true, reassignmentCount: reassigned.reassignmentCount, maxReassignments }, req);
    }

    const { resource: itm } = await itemsC.item(body.itemId, body.managerId).read();
    if (!itm) return bad(404, "ITEM_NOT_FOUND", "Item not found", req);

    if (String(requestIfMatch).trim() !== String(itm._etag || "").trim()) {
      return bad(412, "ETAG_MISMATCH", "Resource changed", req, {
        expectedEtag: String(requestIfMatch),
        currentEtag: String(itm._etag || "")
      });
    }

    if (!body.status || String(body.status).trim().length === 0) {
      return bad(400, "VALIDATION_ERROR", "status is required for action update", req);
    }

    const newStatus = String(body.status).toUpperCase();

    const isHighRisk = !!itm.isSoDConflict || !!itm.isOrphan;
    if (newStatus === "APPROVED" && isHighRisk && (!body.comment || String(body.comment).trim().length === 0)) {
      return bad(400, "VALIDATION_ERROR", "Justification is required to approve high-risk items.", req, {
        requiredField: "comment",
        reason: "high-risk-approval"
      });
    }

    const ops = [
      { op: "set", path: "/status", value: newStatus }
    ];

    // Keep review decision metadata separate from remediation metadata.
    if (newStatus === "REMEDIATED") {
      const remediationTs = (typeof body.remediatedAt === "string" && body.remediatedAt.trim().length > 0)
        ? body.remediatedAt
        : now;
      ops.push({ op: "set", path: "/remediatedAt", value: remediationTs });
      if (typeof body.remediationComment === "string") {
        ops.push({ op: "set", path: "/remediationComment", value: body.remediationComment });
      }
    } else {
      ops.push({ op: "set", path: "/actionedAt", value: now });
      if (typeof body.comment === "string") {
        ops.push({ op: "set", path: "/comment", value: body.comment });
      }
    }

    await itemsC
      .item(body.itemId, body.managerId)
      .patch(ops, { accessCondition: { type: "IfMatch", condition: String(requestIfMatch) } });

    // Recompute cycle counters after action so backend remains source-of-truth.
    const cycleId = itm.reviewCycleId;
    const appId = itm.appId;
    const { resource: cyc } = await cyclesC.item(cycleId, appId).read();
    if (cyc) {
      const { resources: cycleItems } = await itemsC.items.query({
        query: "SELECT c.status, c.managerId FROM c WHERE c.reviewCycleId=@cycleId",
        parameters: [{ name: "@cycleId", value: cycleId }]
      }).fetchAll();

      const pendingItemsFromItems = cycleItems.filter(i => String(i.status || "").toUpperCase() === "PENDING").length;
      const pendingRemediationFromItems = cycleItems.filter(i => String(i.status || "").toUpperCase() === "REVOKED").length;
      const pendingItems = pendingItemsFromItems;
      const pendingRemediationItems = pendingRemediationFromItems;

      const managersInCycle = Array.from(new Set(cycleItems.map(i => i.managerId).filter(Boolean)));
      const confirmedManagers = Array.isArray(cyc.confirmedManagers) ? cyc.confirmedManagers : [];
      const allManagersConfirmed = managersInCycle.length > 0 && managersInCycle.every(m => confirmedManagers.includes(m));

      let nextStatus = "ACTIVE";
      if (allManagersConfirmed && pendingItems === 0 && pendingRemediationItems > 0) {
        nextStatus = "REMEDIATION";
      } else if (allManagersConfirmed && pendingItems === 0 && pendingRemediationItems === 0) {
        nextStatus = "COMPLETED";
      }

      const cycleOps = [
        { op: "set", path: "/pendingItems", value: pendingItems },
        { op: "set", path: "/pendingRemediationItems", value: pendingRemediationItems },
        { op: "set", path: "/status", value: nextStatus }
      ];

      if (nextStatus === "COMPLETED") {
        cycleOps.push({ op: "set", path: "/completedAt", value: cyc.completedAt || now });
      }

      await cyclesC
        .item(cycleId, appId)
        .patch(
          cycleOps,
          { accessCondition: { type: "IfMatch", condition: cyc._etag } }
        );
    }

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: null,
      timestamp: now,
      action: "REVIEW_ITEM_ACTION",
      details: `itemId=${body.itemId}; status=${newStatus}`,
      type: "audit"
    });

    return ok({ itemId: body.itemId, status: newStatus }, req);
  } catch (err) {
    if (err?.status && err?.code) {
      return bad(err.status, err.code, err.message || "Request failed", req, err.details);
    }
    if (err.code === 412) {
      const itemId = req?.body?.itemId;
      const managerId = req?.body?.managerId;
      let currentEtag = null;
      try {
        if (itemId && managerId) {
          const conn = process.env.COSMOS_CONN;
          if (conn) {
            const client = new CosmosClient(conn);
            const { resource } = await client.database("appdb").container("reviewItems").item(itemId, managerId).read();
            currentEtag = resource?._etag || null;
          }
        }
      } catch (_) {
      }
      const requestIfMatch = req.headers?.["if-match"] || req.headers?.["If-Match"];
      return bad(412, "ETAG_MISMATCH", "Resource changed", req, { expectedEtag: String(requestIfMatch || ""), currentEtag });
    }
    context.log.error("reviews/items/action PATCH error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

function cors(req){ return {
  "Access-Control-Allow-Origin": req.headers?.origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, If-Match"
};}
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, code, message, req, details){
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}

module.exports.__test = {
  validateRequest: validate
};

async function executeReassignment({
  itemsC,
  logsC,
  hrC,
  context,
  req,
  actorId,
  now,
  maxReassignments,
  itemId,
  fromManagerId,
  toManagerId,
  comment,
  requestIfMatch,
  sendNotification,
  customization,
  portalUrl
}) {
  const { resource: itm } = await itemsC.item(itemId, fromManagerId).read();
  if (!itm) throw createError(404, "ITEM_NOT_FOUND", `Item not found: ${itemId}`);

  if (requestIfMatch && String(requestIfMatch).trim() !== String(itm._etag || "").trim()) {
    throw createError(412, "ETAG_MISMATCH", "Resource changed", {
      expectedEtag: String(requestIfMatch),
      currentEtag: String(itm._etag || "")
    });
  }

  if (toManagerId === String(fromManagerId).trim()) {
    throw createError(400, "VALIDATION_ERROR", "Target reviewer must be different from current reviewer.");
  }
  if (toManagerId === String(itm.appUserId || "").trim()) {
    throw createError(400, "VALIDATION_ERROR", "Reviewer cannot be the same user whose access is under review.");
  }

  const currentReassignmentCount = Number(itm.reassignmentCount || 0);
  if (currentReassignmentCount >= maxReassignments) {
    throw createError(400, "VALIDATION_ERROR", `Maximum reassignment limit reached (${maxReassignments}) for this item.`);
  }

  let targetHr = null;
  try {
    const hrRead = await hrC.item(toManagerId, toManagerId).read();
    targetHr = hrRead?.resource || null;
  } catch (_) {
  }
  if (!targetHr) {
    throw createError(400, "VALIDATION_ERROR", `Target reviewer ${toManagerId} not found in HR users.`);
  }

  const reassignedItem = {
    ...itm,
    id: itm.id,
    managerId: toManagerId,
    reassignedAt: now,
    reassignedBy: actorId,
    reassignmentCount: currentReassignmentCount + 1,
    reassignmentComment: typeof comment === "string" ? comment : (itm.reassignmentComment || null),
    updatedAt: now
  };

  await itemsC.items.upsert(reassignedItem);
  await itemsC.item(itemId, fromManagerId).delete();

  await logsC.items.upsert({
    id: `LOG_${Date.now()}`,
    userId: actorId,
    userName: null,
    timestamp: now,
    action: "REVIEW_ITEM_REASSIGN",
    details: `itemId=${itemId}; from=${fromManagerId}; to=${toManagerId}`,
    type: "audit"
  });

  if (sendNotification) {
    const reviewerEmail = String(targetHr?.email || "").trim().toLowerCase();
    if (reviewerEmail) {
      const fallbackText = [
        `Hello ${targetHr?.name || toManagerId},`,
        "",
        `A review item has been reassigned to you.`,
        `Item ID: ${itemId}`,
        `Application: ${itm.appName || itm.appId || "Unknown"}`,
        `Entitlement: ${itm.entitlement || "Unknown"}`,
        `Reviewed user: ${itm.userName || itm.appUserId || "Unknown"}`,
        portalUrl ? `Portal: ${portalUrl}` : null,
        "",
        "Please review and take action."
      ].filter(Boolean).join("\n");
      const emailContent = renderTemplatedEmail(
        customization,
        "reviewReassigned",
        {
          subject: `[AccessGuard] Review item reassigned to you (${itm.appName || itm.appId || "App"})`,
          text: fallbackText
        },
        {
          reviewerName: targetHr?.name || toManagerId,
          itemId,
          appName: itm.appName || itm.appId || "Unknown",
          entitlement: itm.entitlement || "Unknown",
          reviewedUser: itm.userName || itm.appUserId || "Unknown",
          portalUrl,
          portalLine: portalUrl ? `Portal: ${portalUrl}` : ""
        }
      );
      await sendEmail(context, {
        to: reviewerEmail,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        metadata: {
          type: "REVIEW_REASSIGNED",
          itemId,
          cycleId: itm.reviewCycleId,
          appId: itm.appId,
          fromManagerId,
          toManagerId
        }
      });
    }
  }

  return {
    itemId,
    managerId: toManagerId,
    reassignmentCount: currentReassignmentCount + 1,
    targetHr
  };
}

function createError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}
