// messages/index.js
const { CosmosClient } = require("@azure/cosmos");
const api = require('../dist/services/api');
module.exports = async function (context, req) {
  try {
    // Optional: handle CORS preflight if you want to run without platform CORS
    if (req.method === "OPTIONS") {
      return {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": req.headers?.origin || "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      };
    }

    const conn = process.env.COSMOS_CONN; // KV Reference -> COSMOS-CONN1
    if (!conn) {
      context.log.error("COSMOS_CONN env var missing");
      return { status: 500, body: { ok: false, error: "COSMOS_CONN is not configured" } };
    }

    // Parse and validate input
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const userId = body.userId || "anonymous";
    const message = body.message;
    const metadata = body.metadata || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return { status: 400, body: { ok: false, error: "message is required" } };
    }

    // Cosmos client + container
    const client = new CosmosClient(conn);
    const database = client.database("appdb");
    const container = database.container("auditLogs");
    
    const doc = {
      userId,
      message: message.trim(),
      metadata,
      createdAt: new Date().toISOString(),
      type: "uam-message"
    };

    const { resource } = await container.items.create(doc);

    // If you rely on platform CORS, you can omit headers below. Keeping minimal:
    return {
      status: 200,
      body: { ok: true, id: resource.id }
    };
  } catch (err) {
    context.log.error("Error in /api/messages:", err?.stack || err?.message || String(err));
    return { status: 500, body: { ok: false, error: err?.message || "Internal error" } };
  }
};