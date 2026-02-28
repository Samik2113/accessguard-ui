// src/services/api.ts
const BASE = import.meta.env.VITE_API_BASE_URL;     // e.g., "https://func-accessguard-dev-....azurewebsites.net"
const FN_KEY = import.meta.env.VITE_AZ_FUNC_KEY ?? ""; // provided via env at build time (not committed)

type ApiError = Error & { code?: string; details?: unknown; status?: number };
type GetJsonOptions = { keyInQuery?: boolean; signal?: AbortSignal; forceRevalidate?: boolean };
type PostJsonOptions = { keyInQuery?: boolean; ifMatch?: string };

type CacheEntry = {
  data: any;
  etag?: string;
  lastModified?: string;
  updatedAt: number;
};

const getCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<any>>();
const inflightControllers = new Map<string, AbortController>();

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

function makeCacheKey(path: string, params: Record<string, string | number | undefined>, includeQueryKey: boolean) {
  return buildUrl(path, params, includeQueryKey);
}

function createApiError(message: string, status?: number, code?: string, details?: unknown): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

async function getJson(path: string, params: Record<string, string | number | undefined> = {}, opts?: GetJsonOptions) {
  const includeQueryKey = !!opts?.keyInQuery;
  const url = buildUrl(path, params, includeQueryKey);
  const key = makeCacheKey(path, params, includeQueryKey);

  if (inflight.has(key)) return inflight.get(key)!;

  if (inflightControllers.has(key)) {
    inflightControllers.get(key)?.abort();
    inflightControllers.delete(key);
  }

  const headers: Record<string, string> = {};
  if (FN_KEY && !includeQueryKey) headers["x-functions-key"] = FN_KEY;   // prefer header

  const cached = getCache.get(key);
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

  const controller = new AbortController();
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const signal = controller.signal;
  inflightControllers.set(key, controller);

  const promise = fetch(url, { method: "GET", headers, signal })
    .then(async (res) => {
      if (res.status === 304 && cached) {
        return cached.data;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data as any)?.ok === false) {
        const normalized = (data as any)?.error;
        if (normalized && typeof normalized === 'object') {
          throw createApiError(normalized.message || `GET ${path} failed`, res.status, normalized.code, normalized.details);
        }
        throw createApiError((data as any)?.error ?? `GET ${path} failed`, res.status);
      }

      const etag = res.headers.get("ETag") || undefined;
      const lastModified = res.headers.get("Last-Modified") || undefined;
      getCache.set(key, {
        data,
        etag,
        lastModified,
        updatedAt: Date.now()
      });

      return data;
    })
    .finally(() => {
      inflight.delete(key);
      inflightControllers.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

async function postJson(path: string, body: any, params: Record<string, string | number | undefined> = {}, opts?: PostJsonOptions) {
  const url = buildUrl(path, params, !!opts?.keyInQuery);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (FN_KEY && !opts?.keyInQuery) headers["x-functions-key"] = FN_KEY;   // prefer header
  if (opts?.ifMatch) headers["If-Match"] = opts.ifMatch;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as any)?.ok === false) {
    const normalized = (data as any)?.error;
    if (normalized && typeof normalized === 'object') {
      throw createApiError(normalized.message || `POST ${path} failed`, res.status, normalized.code, normalized.details);
    }
    throw createApiError((data as any)?.error ?? `POST ${path} failed`, res.status);
  }

  // conservative invalidation: clear cached GET entries for review slice after writes
  if (path.includes("reviews-") || path.includes("review")) {
    Array.from(getCache.keys()).forEach((k) => {
      if (k.includes("/api/review") || k.includes("/api/reviews")) getCache.delete(k);
    });
  }
  return data;
}

// -------------------- Reads (hydrate UI) --------------------
export const getApplications      = (top=100, ct?:string) => getJson("/api/applications-get", { top, continuationToken: ct });
export const getEntitlements      = (appId: string, search?: string, top=200, ct?:string) => getJson("/api/entitlements-get", { appId, search, top, continuationToken: ct });
export const getAccounts          = (appId: string, userId?: string, entitlement?: string, top=200, ct?:string, search?: string) =>
  getJson("/api/accounts-get", { appId, userId, entitlement, top, continuationToken: ct, search });
// Optional server-side: fetch all accounts for a user across apps
export const getAccountsByUser   = (userId: string, top=500, search?: string) => getJson("/api/accounts-get-by-user", { userId, top, search });
export const getHrUsers           = (opts: { userId?: string; managerId?: string; search?: string; top?: number; ct?: string } = {}) =>
  getJson("/api/hr-users-get", { userId: opts.userId, managerId: opts.managerId, search: opts.search, top: opts.top ?? 50, continuationToken: opts.ct });
export const getAuditLogs         = (opts: { userId?: string; action?: string; from?: string; to?: string; top?: number; ct?: string } = {}) =>
  getJson("/api/auditlogs-get", { userId: opts.userId, action: opts.action, from: opts.from, to: opts.to, top: opts.top ?? 100, continuationToken: opts.ct });

// (Optional) SoD list for admin
export const getSodPolicies       = (search?: string, top=100, ct?:string) => getJson("/api/sod-get", { search, top, continuationToken: ct });

// -------------------- UAR flows (Read) --------------------
// Get all review cycles (optionally filtered by appId or status)
export const getReviewCycles = async (opts: { appId?: string; status?: string; top?: number; ct?: string } = {}) => {
  // Only include appId if it is a non-empty string
  const params: Record<string, string | number | undefined> = { status: opts.status, top: opts.top ?? 100, continuationToken: opts.ct };
  if (typeof opts.appId === 'string' && opts.appId.trim().length > 0) params.appId = opts.appId.trim();
  console.debug('[API] getReviewCycles params:', params);
  try {
    const result = await getJson("/api/reviewcycles-get", params);
    console.debug('[API] getReviewCycles result:', result);
    return result;
  } catch (err) {
    console.error('[API] getReviewCycles error:', err);
    throw err;
  }
};

// Get review items (optionally filtered by cycleId, managerId, or status)
export const getReviewItems       = (opts: { cycleId?: string; managerId?: string; status?: string; top?: number; ct?: string } = {}) =>
  getJson("/api/reviewitems-get", { reviewCycleId: opts.cycleId, managerId: opts.managerId, status: opts.status, top: opts.top ?? 500, continuationToken: opts.ct });

export const getReviewCycleDetail = (opts: { cycleId: string; appId?: string; managerId?: string; status?: string; top?: number; ct?: string }) =>
  getJson("/api/reviews-cycle-detail", {
    cycleId: opts.cycleId,
    appId: opts.appId,
    managerId: opts.managerId,
    status: opts.status,
    top: opts.top ?? 200,
    continuationToken: opts.ct
  });

// Legacy: alias for backward compatibility
export const getManagerItems      = (managerId: string, status?: string) =>
  getReviewItems({ managerId, status });

// -------------------- UAR flows (Write) --------------------
export const launchReview = async (payload: { appId: string; name?: string; dueDate?: string; launchIfExists?: boolean }) => {
  console.debug('[API] launchReview payload:', payload);
  try {
    const result = await postJson("/api/reviews-launch", payload);
    console.debug('[API] launchReview result:', result);
    return result;
  } catch (err) {
    console.error('[API] launchReview error:', err);
    throw err;
  }
};

export const actOnItem            = (payload: {
  itemId: string;
  managerId: string;
  status: string;
  comment?: string;
  remediationComment?: string;
  remediatedAt?: string;
  etag?: string;
}) =>
  postJson("/api/reviews-item-action", payload, {}, { ifMatch: payload.etag });

export const reassignReviewItem = (payload: {
  itemId: string;
  managerId: string;
  reassignToManagerId: string;
  comment?: string;
  etag?: string;
}) =>
  postJson("/api/reviews-item-action", payload, {}, { ifMatch: payload.etag });

export const confirmManager       = (payload: { cycleId: string; appId: string; managerId: string }) =>
  postJson("/api/reviews-confirm", payload);

export const archiveCycle         = (payload: { cycleId: string; appId: string }) =>
  postJson("/api/reviews-archive", payload);

// -------------------- Ingest (admin screens) --------------------
type ImportOpts = { replaceAll?: boolean; debug?: boolean; resetPasswords?: boolean; returnCredentials?: boolean };

export const importHrUsers = (items: any[], opts?: ImportOpts) => {
  const query: Record<string, string> = {};
  if (opts?.replaceAll) query.replaceAll = "true";
  if (opts?.debug) query.debug = "true";
  if (opts?.resetPasswords) query.resetPasswords = "true";
  if (opts?.returnCredentials) query.returnCredentials = "true";
  return postJson("/api/hr-import", items, query);
};

export const loginUser = (payload: { email: string; password: string }) =>
  postJson("/api/auth-login", payload);

export const changePassword = (payload: { email: string; currentPassword: string; newPassword: string }) =>
  postJson("/api/auth-change-password", payload);

export const resetUserPassword = (payload: { userId: string }) =>
  postJson("/api/auth-reset-password", payload);

export const setUserRole = (payload: { userId: string; role: 'ADMIN' | 'AUDITOR' | 'USER' }) =>
  postJson("/api/auth-set-role", payload);

export const setUserRolesBulk = (payload: Array<{ userId: string; role: 'ADMIN' | 'AUDITOR' | 'USER' }>) =>
  postJson("/api/auth-set-role", payload);

export const importAccounts       = (appId: string, items: any[], ifMatch?: string) => postJson("/api/accounts-import", items, { appId }, { ifMatch });
export const importEntitlements   = (appId: string, items: any[]) => postJson("/api/entitlements-import", items, { appId });
export const importSodPolicies    = (items: any[]) => postJson("/api/sod-import", items);
export const importApplications   = (items: any[]) => postJson("/api/applications-import", items);

// Delete application (backend should accept { appId })
export const deleteApplication = (appId: string) => postJson("/api/applications-delete", { appId });

// Delete an SoD policy by id
export const deleteSodPolicy = (id: string) => postJson("/api/sod-delete", { id });

// Messages
export const saveMessageToBackend = (message: any) => postJson("/api/messages", { message });

export const __test = {
  resetApiState() {
    getCache.clear();
    inflight.clear();
    inflightControllers.forEach((controller) => controller.abort());
    inflightControllers.clear();
  }
};