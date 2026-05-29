const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, timer) {
  try {
    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      context.log.error("COSMOS_CONN not set");
      return;
    }

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles");
    const itemsC = db.container("reviewItems");
    const logsC = db.container("auditLogs");

    const now = new Date();

    // Find active campaigns that are past due date and have auto-action configured
    const overdueQuery = {
      query: "SELECT * FROM c WHERE c.status = 'ACTIVE' AND c.dueDate < @now AND c.autoActionOnDueDate IN ('REVOKE_ALL', 'APPROVE_ALL')",
      parameters: [{ name: "@now", value: now.toISOString() }]
    };

    const { resources: overdueCycles } = await cyclesC.items.query(overdueQuery).fetchAll();

    for (const cycle of overdueCycles || []) {
      const cycleId = cycle.id;
      const autoAction = cycle.autoActionOnDueDate;

      context.log(`Processing auto-action for campaign ${cycleId}: ${autoAction}`);

      try {
        // Get all pending items for this cycle
        const itemsQuery = {
          query: "SELECT * FROM c WHERE c.reviewCycleId = @cycleId AND c.status = 'PENDING'",
          parameters: [{ name: "@cycleId", value: cycleId }]
        };

        const { resources: pendingItems } = await itemsC.items.query(itemsQuery).fetchAll();

        if (pendingItems.length === 0) {
          context.log(`No pending items for campaign ${cycleId}, skipping auto-action`);
          continue;
        }

        const newStatus = autoAction === 'APPROVE_ALL' ? 'APPROVED' : 'REVOKED';
        const actionComment = `Auto-action applied on ${now.toISOString()}: ${autoAction === 'APPROVE_ALL' ? 'Approved all pending access' : 'Revoked all pending access'} due to due date expiry.`;

        // Update all pending items
        for (const item of pendingItems) {
          await itemsC.item(item.id, item.id).patch({
            operations: [
              { op: "set", path: "/status", value: newStatus },
              { op: "set", path: "/actionedAt", value: now.toISOString() },
              { op: "set", path: "/comment", value: actionComment },
              { op: "set", path: "/updatedAt", value: now.toISOString() }
            ]
          });
        }

        // Update cycle status to COMPLETED
        await cyclesC.item(cycleId, cycleId).patch({
          operations: [
            { op: "set", path: "/status", value: "COMPLETED" },
            { op: "set", path: "/completedAt", value: now.toISOString() },
            { op: "set", path: "/updatedAt", value: now.toISOString() }
          ]
        });

        // Log the auto-action
        await logsC.items.upsert({
          id: `LOG_${Date.now()}`,
          userId: "SYSTEM",
          userName: "Auto-Action System",
          timestamp: now.toISOString(),
          action: "REVIEW_AUTO_ACTION",
          details: `cycleId=${cycleId}; autoAction=${autoAction}; itemsProcessed=${pendingItems.length}; newStatus=${newStatus}`,
          type: "audit"
        });

        context.log(`Auto-action completed for campaign ${cycleId}: ${pendingItems.length} items ${newStatus.toLowerCase()}`);

      } catch (error) {
        context.log.error(`Error processing auto-action for campaign ${cycleId}:`, error);
      }
    }

    context.log(`Auto-action check completed. Processed ${overdueCycles?.length || 0} campaigns.`);

  } catch (error) {
    context.log.error("reviews-auto-action error:", error?.stack || error);
  }
};