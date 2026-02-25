// src/services/api.ts
const BASE = import.meta.env.VITE_API_BASE_URL;     // e.g., "https://func-accessguard-dev-....azurewebsites.net"
const FN_KEY = import.meta.env.VITE_AZ_FUNC_KEY ?? ""; // provided via env at build time (not committed)

// Common request builder
function buildUrl(path: string, params: Record<string, string | number | undefined> = {}, includeQueryKey = false) {
  const qp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qp.set(k, String(v));
  });
  // If you *must* support query-style key for some functions, toggle includeQueryKey=true at the call site.
  if (includeQueryKey && FN_KEY) qp.set("code", FN_KEY);
  const qs = qp.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ""}`;
}

async function getJson(path: string, params: Record<string, string | number | undefined> = {}, opts?: { keyInQuery?: boolean }) {
  const url = buildUrl(path, params, !!opts?.keyInQuery);
  const headers: Record<string, string> = {};
  if (FN_KEY && !opts?.keyInQuery) headers["x-functions-key"] = FN_KEY;   // prefer header
  const res = await fetch(url, { method: "GET", headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as any)?.ok === false) throw new Error((data as any)?.error ?? `GET ${path} failed`);
  return data;
}

async function postJson(path: string, body: any, params: Record<string, string | number | undefined> = {}, opts?: { keyInQuery?: boolean }) {
  const url = buildUrl(path, params, !!opts?.keyInQuery);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (FN_KEY && !opts?.keyInQuery) headers["x-functions-key"] = FN_KEY;   // prefer header
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as any)?.ok === false) throw new Error((data as any)?.error ?? `POST ${path} failed`);
  return data;
}

// -------------------- Reads (hydrate UI) --------------------
export const getApplications      = (top=100, ct?:string) => getJson("/api/applications-get", { top, continuationToken: ct });
export const getEntitlements      = (appId: string, search?: string, top=200, ct?:string) => getJson("/api/entitlements-get", { appId, search, top, continuationToken: ct });
export const getAccounts          = (appId: string, userId?: string, entitlement?: string, top=200, ct?:string) =>
  getJson("/api/accounts-get", { appId, userId, entitlement, top, continuationToken: ct });
export const getHrUsers           = (opts: { userId?: string; managerId?: string; search?: string; top?: number; ct?: string } = {}) =>
  getJson("/api/hr-users-get", { userId: opts.userId, managerId: opts.managerId, search: opts.search, top: opts.top ?? 50, continuationToken: opts.ct });
export const getAuditLogs         = (opts: { userId?: string; action?: string; from?: string; to?: string; top?: number; ct?: string } = {}) =>
  getJson("/api/auditlogs-get", { userId: opts.userId, action: opts.action, from: opts.from, to: opts.to, top: opts.top ?? 100, continuationToken: opts.ct });

// (Optional) SoD list for admin
export const getSodPolicies       = (search?: string, top=100, ct?:string) => getJson("/api/sod-get", { search, top, continuationToken: ct });

// -------------------- UAR flows --------------------
export const launchReview         = (payload: { appId: string; name?: string; dueDate?: string; launchIfExists?: boolean }) =>
  postJson("/api/reviews/launch", payload);

export const getManagerItems      = (managerId: string, status?: string) =>
  getJson("/api/reviewItems", { managerId, status });

export const actOnItem            = (payload: { itemId: string; managerId: string; status: string; comment?: string }) =>
  postJson("/api/reviews/items/action", payload);

export const confirmManager       = (payload: { cycleId: string; appId: string; managerId: string }) =>
  postJson("/api/reviews/confirm", payload);

export const archiveCycle         = (payload: { cycleId: string; appId: string }) =>
  postJson("/api/reviews/archive", payload);

// -------------------- Ingest (admin screens) --------------------
type ImportOpts = { replaceAll?: boolean; debug?: boolean };

export const importHrUsers = (items: any[], opts?: ImportOpts) => {
  const query: Record<string, string> = {};
  if (opts?.replaceAll) query.replaceAll = "true";
  if (opts?.debug) query.debug = "true";
  return postJson("/api/hr-import", items, query);
};

export const importAccounts       = (appId: string, items: any[]) => postJson("/api/accounts-import", items, { appId });
export const importEntitlements   = (appId: string, items: any[]) => postJson("/api/entitlements-import", items, { appId });
export const importSodPolicies    = (items: any[]) => postJson("/api/sod-import", items);
export const importApplications   = (items: any[]) => postJson("/api/applications-import", items);

// Delete application (backend should accept { id })
export const deleteApplication = (appId: string) => postJson("/api/applications-delete", { id: appId });

// Messages
export const saveMessageToBackend = (message: any) => postJson("/api/messages", message);