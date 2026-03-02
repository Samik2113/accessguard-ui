const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    return { status: 204, headers: cors(req) };
  }

  const checks = {
    cosmosConnConfigured: false,
    cosmosAccountReachable: false,
    databaseReadable: false,
    auditLogsContainerReadable: false,
  };

  try {
    const conn = process.env.COSMOS_CONN;
    checks.cosmosConnConfigured = !!conn;

    if (!conn) {
      return unhealthy("COSMOS_CONN not set", checks, req);
    }

    const client = new CosmosClient(conn);
    await client.getDatabaseAccount();
    checks.cosmosAccountReachable = true;

    const db = client.database("appdb");
    await db.read();
    checks.databaseReadable = true;

    const container = db.container("auditLogs");
    await container.read();
    checks.auditLogsContainerReadable = true;

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        status: "healthy",
        service: "accessguard-api",
        timestamp: new Date().toISOString(),
        checks,
      },
    };
  } catch (error) {
    context.log.error("health check failed:", error?.stack || error);
    return unhealthy(error?.message || "Health check failed", checks, req);
  }
};

function unhealthy(message, checks, req) {
  return {
    status: 500,
    headers: cors(req),
    body: {
      ok: false,
      status: "unhealthy",
      service: "accessguard-api",
      timestamp: new Date().toISOString(),
      error: message,
      checks,
    },
  };
}

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
