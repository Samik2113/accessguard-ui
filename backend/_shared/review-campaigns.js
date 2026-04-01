const { customAlphabet } = require("nanoid");

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

const APP_TYPE_SCOPE_MAP = {
  ALL_APPLICATIONS: "Application",
  ALL_SERVERS: "Servers",
  ALL_DATABASES: "Database",
  ALL_SHARED_MAILBOXES: "Shared Mailbox",
  ALL_SHARED_FOLDERS: "Shared Folder"
};

const REVIEWER_TYPES = new Set([
  "MANAGER",
  "APPLICATION_OWNER",
  "APPLICATION_ADMIN",
  "ENTITLEMENT_OWNER",
  "SPECIFIC_USER"
]);

const SAFE = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "").toUpperCase();
const LIST = (value) => {
  if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  return String(value || "")
    .split(/[;,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};
const parseBool = (value) => value === true || value === 1 || String(value || "").trim().toLowerCase() === "true" || String(value || "").trim().toLowerCase() === "yes";

function normalizeHrStatus(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const lowered = value.toLowerCase();
  if (lowered.includes("terminat") || lowered.includes("inactive") || lowered.includes("separat") || lowered.includes("offboard") || lowered.includes("exit") || lowered.includes("left") || lowered.includes("former") || lowered.includes("disable")) return "TERMINATED";
  if (lowered.includes("active") || lowered.includes("onroll") || lowered.includes("enabled") || lowered.includes("current")) return "ACTIVE";
  return value.toUpperCase();
}

function normalizeAccountStatus(raw) {
  const value = String(raw || "").trim();
  if (!value) return "ACTIVE";
  const lowered = value.toLowerCase();
  if (["active", "enable", "enabled", "1", "true", "a"].includes(lowered)) return "ACTIVE";
  if (["inactive", "disable", "disabled", "0", "false", "i"].includes(lowered)) return "INACTIVE";
  return value.toUpperCase();
}

function resolveHrStatusSource(hr, fallback) {
  return hr?.employeeStatus || hr?.employmentStatus || hr?.status || fallback;
}

function getAppType(app) {
  const appType = String(app?.appType || "Application").trim();
  return appType || "Application";
}

function getAppKey(app) {
  return String(app?.appId || app?.id || "").trim();
}

function getScopeSummary(scope) {
  const labels = [];
  for (const [scopeKey, appType] of Object.entries(APP_TYPE_SCOPE_MAP)) {
    if (scope?.[scopeKey]) labels.push(`All ${appType}`);
  }
  const specificCount = Array.isArray(scope?.specificAppIds) ? scope.specificAppIds.filter(Boolean).length : 0;
  if (specificCount > 0) labels.push(`${specificCount} specific app${specificCount === 1 ? "" : "s"}`);
  return labels.join(", ") || "No scope selected";
}

function getReviewerLabel(reviewerType) {
  if (reviewerType === "APPLICATION_OWNER") return "Application Owner";
  if (reviewerType === "APPLICATION_ADMIN") return "Application Admin";
  if (reviewerType === "ENTITLEMENT_OWNER") return "Entitlement Owner";
  if (reviewerType === "SPECIFIC_USER") return "Specific User";
  return "Manager";
}

function getRiskScopeLabel(riskScope) {
  if (riskScope === "SOD_ONLY") return "SoD Conflicts";
  if (riskScope === "PRIVILEGED_ONLY") return "Privileged Access";
  if (riskScope === "ORPHAN_ONLY") return "Orphan Accounts";
  return "All Access";
}

async function readAppByIdOrAppId(appsC, targetAppId) {
  try {
    const { resource } = await appsC.item(targetAppId, targetAppId).read();
    if (resource) return resource;
  } catch (_) {
  }
  try {
    const { resources } = await appsC.items.query({
      query: "SELECT TOP 1 * FROM c WHERE c.appId=@a OR c.id=@a",
      parameters: [{ name: "@a", value: targetAppId }]
    }).fetchAll();
    return resources?.[0] || null;
  } catch (_) {
    return null;
  }
}

async function resolveCandidateToHrId(hrC, candidates) {
  for (const candidate of candidates) {
    if (!candidate.userId) continue;
    try {
      const uid = String(candidate.userId).trim();
      if (!uid) continue;
      const { resource: hr } = await hrC.item(uid, uid).read();
      if (hr && hr.userId) return String(hr.userId).trim();
    } catch (_) {
    }
  }

  for (const candidate of candidates) {
    if (!candidate.email) continue;
    try {
      const email = String(candidate.email).trim().toLowerCase();
      if (!email) continue;
      const { resources: hits } = await hrC.items.query({
        query: "SELECT TOP 1 c.userId FROM c WHERE LOWER(c.email)=@e",
        parameters: [{ name: "@e", value: email }]
      }).fetchAll();
      if (hits?.length && hits[0]?.userId) return String(hits[0].userId).trim();
    } catch (_) {
    }
  }

  for (const candidate of candidates) {
    if (!candidate.name) continue;
    try {
      const name = String(candidate.name).trim();
      if (!name) continue;
      const { resources: hits } = await hrC.items.query({
        query: "SELECT TOP 1 c.userId FROM c WHERE c.name=@n",
        parameters: [{ name: "@n", value: name }]
      }).fetchAll();
      if (hits?.length && hits[0]?.userId) return String(hits[0].userId).trim();
    } catch (_) {
    }
  }

  return "";
}

function collectOwnerCandidates(appMeta) {
  const candidates = [];
  const directOwner = appMeta?.ownerUserId || appMeta?.ownerId || null;
  const directEmail = appMeta?.ownerEmail || null;
  const directName = appMeta?.ownerName || appMeta?.ownerDisplayName || null;

  if (directOwner) candidates.push({ userId: String(directOwner).trim() });
  if (directEmail) candidates.push({ email: String(directEmail).trim().toLowerCase() });
  if (directName) candidates.push({ name: String(directName).trim() });

  if (Array.isArray(appMeta?.owners)) {
    for (const owner of appMeta.owners) {
      if (!owner) continue;
      if (owner.userId) candidates.push({ userId: String(owner.userId).trim() });
      if (owner.email) candidates.push({ email: String(owner.email).trim().toLowerCase() });
      if (owner.name) candidates.push({ name: String(owner.name).trim() });
    }
  }

  return candidates;
}

function collectAdminCandidates(appMeta) {
  const candidates = [];
  LIST(appMeta?.ownerAdminIds).forEach((userId) => candidates.push({ userId }));
  LIST(appMeta?.ownerAdminId).forEach((userId) => candidates.push({ userId }));
  if (Array.isArray(appMeta?.admins)) {
    for (const admin of appMeta.admins) {
      if (!admin) continue;
      if (admin.userId) candidates.push({ userId: String(admin.userId).trim() });
      if (admin.email) candidates.push({ email: String(admin.email).trim().toLowerCase() });
      if (admin.name) candidates.push({ name: String(admin.name).trim() });
    }
  }
  return candidates;
}

async function resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken }) {
  const candidates = collectOwnerCandidates(appMeta);
  if (candidates.length === 0) return fallbackToken;
  const resolved = await resolveCandidateToHrId(hrC, candidates);
  return resolved || fallbackToken;
}

async function resolveAppAdminReviewerId({ hrC, appMeta, fallbackToken }) {
  const candidates = collectAdminCandidates(appMeta);
  if (candidates.length === 0) return resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken });
  const resolved = await resolveCandidateToHrId(hrC, candidates);
  return resolved || resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken });
}

async function resolveEntitlementOwnerReviewerId({ entitlementsByKey, entitlementOwnerCache, hrC, appMeta, appId, entitlement, fallbackToken }) {
  const key = `${appId}::${SAFE(entitlement)}`;
  if (!entitlementOwnerCache.has(key)) {
    const ent = entitlementsByKey.get(key);
    let resolved = "";
    if (ent) {
      const candidates = [];
      if (ent.ownerId) candidates.push({ userId: String(ent.ownerId).trim() });
      if (ent.ownerEmail) candidates.push({ email: String(ent.ownerEmail).trim().toLowerCase() });
      if (ent.owner) candidates.push({ name: String(ent.owner).trim() });
      resolved = await resolveCandidateToHrId(hrC, candidates);
    }
    entitlementOwnerCache.set(key, resolved || null);
  }
  const cached = entitlementOwnerCache.get(key);
  if (cached) return cached;
  return resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken });
}

async function readAllApplications(appsC) {
  const { resources } = await appsC.items.query("SELECT * FROM c").fetchAll();
  return Array.isArray(resources) ? resources : [];
}

async function readAllAccounts(accountsC) {
  const { resources } = await accountsC.items.query(
    "SELECT c.id, c.userId, c.userName, c.email, c.entitlement, c.accountStatus, c.isOrphan, c.correlatedUserId, c.correlation, c.appId, c.isPrivileged FROM c"
  ).fetchAll();
  return Array.isArray(resources) ? resources : [];
}

async function readAllPolicies(sodC) {
  const { resources } = await sodC.items.query("SELECT * FROM c").fetchAll();
  return Array.isArray(resources) ? resources : [];
}

async function readAllEntitlements(entitlementsC) {
  const { resources } = await entitlementsC.items.query("SELECT c.appId, c.entitlement, c.owner, c.ownerId, c.ownerEmail, c.isPrivileged FROM c").fetchAll();
  return Array.isArray(resources) ? resources : [];
}

function resolveSelectedApps(allApps, scope) {
  const selected = new Map();
  for (const app of allApps) {
    const appId = getAppKey(app);
    if (!appId) continue;
    const appType = getAppType(app);
    const explicitlySelected = Array.isArray(scope?.specificAppIds) && scope.specificAppIds.some((candidate) => String(candidate || "").trim() === appId);
    const includedByType = Object.entries(APP_TYPE_SCOPE_MAP).some(([scopeKey, targetType]) => scope?.[scopeKey] === true && appType === targetType);
    if (!explicitlySelected && !includedByType) continue;
    selected.set(appId, app);
  }
  return Array.from(selected.values());
}

function buildAccountIdentityKey(account) {
  const correlatedUserId = String(account?.correlatedUserId || "").trim();
  if (correlatedUserId) return `u:${correlatedUserId}`;
  if (parseBool(account?.isOrphan)) {
    const orphanEmail = String(account?.email || "").trim().toLowerCase();
    if (orphanEmail) return `e:${orphanEmail}`;
    const orphanName = String(account?.userName || "").trim().toLowerCase();
    if (orphanName) return `n:${orphanName}`;
  }
  const userId = String(account?.userId || "").trim();
  if (userId) return `id:${userId}`;
  const email = String(account?.email || "").trim().toLowerCase();
  if (email) return `e:${email}`;
  const userName = String(account?.userName || "").trim().toLowerCase();
  if (userName) return `n:${userName}`;
  return null;
}

async function buildCampaignDefinition({ db, payload, actor, now, mode, cycleId }) {
  const nowIso = now.toISOString();
  const appsC = db.container("applications");
  const accountsC = db.container("accounts");
  const hrC = db.container("hrUsers");
  const sodC = db.container("sodPolicies");
  const entitlementsC = db.container("entitlements");

  const campaignName = String(payload?.name || "").trim();
  const campaignOwnerId = String(payload?.ownerId || actor?.id || "").trim();
  const dueDate = payload?.dueDate ? new Date(payload.dueDate).toISOString() : new Date(now.getTime() + 14 * 86400000).toISOString();
  const startNow = payload?.startNow !== false;
  const startAt = startNow ? nowIso : String(payload?.startAt || "").trim();
  const riskScopeRaw = String(payload?.riskScope || "ALL_ACCESS").trim().toUpperCase();
  const riskScope = ["ALL_ACCESS", "SOD_ONLY", "PRIVILEGED_ONLY", "ORPHAN_ONLY"].includes(riskScopeRaw) ? riskScopeRaw : "ALL_ACCESS";
  const reviewerTypeRaw = String(payload?.reviewerType || "MANAGER").trim().toUpperCase();
  const reviewerType = REVIEWER_TYPES.has(reviewerTypeRaw) ? reviewerTypeRaw : "MANAGER";
  const specificReviewerId = String(payload?.specificReviewerId || "").trim();
  const orphanReviewerModeRaw = String(payload?.orphanReviewerMode || "APPLICATION_OWNER").trim().toUpperCase();
  const orphanReviewerMode = ["APPLICATION_OWNER", "APPLICATION_ADMIN", "CUSTOM"].includes(orphanReviewerModeRaw)
    ? orphanReviewerModeRaw
    : "APPLICATION_OWNER";
  const orphanReviewerId = String(payload?.customOrphanReviewerId || payload?.orphanReviewerId || "").trim();
  const scope = payload?.scope || {};

  if (!campaignName) throw new Error("Campaign name is required.");
  if (!campaignOwnerId) throw new Error("Campaign owner is required.");
  if (!startNow && !startAt) throw new Error("Start date is required when start now is not selected.");
  if (reviewerType === "SPECIFIC_USER" && !specificReviewerId) throw new Error("Specific reviewer is required.");
  if (orphanReviewerMode === "CUSTOM" && !orphanReviewerId) throw new Error("Specific orphan reviewer is required.");

  const allApps = await readAllApplications(appsC);
  const selectedApps = resolveSelectedApps(allApps, scope);
  if (selectedApps.length === 0) throw new Error("Select at least one application or application type.");

  const selectedAppIds = new Set(selectedApps.map((app) => getAppKey(app)).filter(Boolean));
  const selectedAppIdList = Array.from(selectedAppIds);
  const selectedAppTypeList = Array.from(new Set(selectedApps.map((app) => getAppType(app))));
  const allAccounts = await readAllAccounts(accountsC);
  const scopedAccounts = allAccounts.filter((account) => selectedAppIds.has(String(account?.appId || "").trim()));
  if (scopedAccounts.length === 0) throw new Error("No accounts found in the selected campaign scope.");

  const uniqueUserIds = Array.from(new Set(scopedAccounts.map((account) => String(account?.correlation?.hrUserId || account?.correlatedUserId || account?.userId || "").trim()).filter(Boolean)));
  const hrCache = new Map();
  const batch = 50;
  for (let index = 0; index < uniqueUserIds.length; index += batch) {
    const chunk = uniqueUserIds.slice(index, index + batch);
    await Promise.all(chunk.map(async (userId) => {
      try {
        const { resource } = await hrC.item(userId, userId).read();
        if (resource) hrCache.set(userId, resource);
      } catch (_) {
      }
    }));
  }

  const policies = await readAllPolicies(sodC);
  const entitlements = await readAllEntitlements(entitlementsC);
  const entitlementsByKey = new Map();
  const privilegedEntitlementSet = new Set();
  for (const ent of entitlements) {
    const key = `${String(ent?.appId || "").trim()}::${SAFE(ent?.entitlement)}`;
    entitlementsByKey.set(key, ent);
    if (parseBool(ent?.isPrivileged)) privilegedEntitlementSet.add(key);
  }

  const scopedIdentityKeys = new Set();
  for (const account of scopedAccounts) {
    const key = buildAccountIdentityKey(account);
    if (key) scopedIdentityKeys.add(key);
  }
  const perUserEntitlements = new Map();
  for (const account of allAccounts) {
    const key = buildAccountIdentityKey(account);
    if (!key || !scopedIdentityKeys.has(key)) continue;
    const list = perUserEntitlements.get(key) || [];
    list.push({ appId: String(account?.appId || "").trim(), entitlement: String(account?.entitlement || "") });
    perUserEntitlements.set(key, list);
  }

  const conflictIdsFor = (account) => {
    const key = buildAccountIdentityKey(account);
    if (!key) return [];
    const userEntries = perUserEntitlements.get(key) || [];
    const hits = [];
    for (const policy of policies) {
      const has1 = userEntries.some((entry) => entry.appId === String(policy?.appId1 || "").trim() && SAFE(entry.entitlement) === SAFE(policy?.entitlement1));
      const has2 = userEntries.some((entry) => entry.appId === String(policy?.appId2 || "").trim() && SAFE(entry.entitlement) === SAFE(policy?.entitlement2));
      if (!has1 || !has2) continue;
      const accountAppId = String(account?.appId || "").trim();
      const accountEntitlement = SAFE(account?.entitlement);
      if (
        (accountAppId === String(policy?.appId1 || "").trim() && accountEntitlement === SAFE(policy?.entitlement1)) ||
        (accountAppId === String(policy?.appId2 || "").trim() && accountEntitlement === SAFE(policy?.entitlement2))
      ) {
        hits.push(String(policy?.id || policy?.policyId || "").trim());
      }
    }
    return hits.filter(Boolean);
  };

  const entitlementOwnerCache = new Map();
  const items = [];
  for (const account of scopedAccounts) {
    const hrUserId = String(account?.correlation?.hrUserId || account?.correlatedUserId || account?.userId || "").trim();
    const hr = hrUserId ? hrCache.get(hrUserId) : null;
    const conflictIds = conflictIdsFor(account);
    const conflictNames = conflictIds.map((id) => {
      const hit = policies.find((policy) => String(policy?.id || policy?.policyId || "").trim() === id);
      return hit?.policyName || id;
    });
    const accountStatus = normalizeAccountStatus(account?.accountStatus);
    const isOrphan = !hr;
    const hrStatus = normalizeHrStatus(resolveHrStatusSource(hr, account?.correlation?.status));
    const isTerminated = hrStatus === "TERMINATED" && accountStatus === "ACTIVE";
    const entitlementKey = `${String(account?.appId || "").trim()}::${SAFE(account?.entitlement)}`;
    const isPrivileged = parseBool(account?.isPrivileged) || privilegedEntitlementSet.has(entitlementKey);

    if (hrStatus === "TERMINATED" && accountStatus === "INACTIVE") continue;

    const includeByRiskScope =
      riskScope === "ALL_ACCESS" ||
      (riskScope === "SOD_ONLY" && conflictIds.length > 0) ||
      (riskScope === "PRIVILEGED_ONLY" && isPrivileged) ||
      (riskScope === "ORPHAN_ONLY" && isOrphan);

    if (!includeByRiskScope) continue;

    const appId = String(account?.appId || "").trim();
    const appMeta = selectedApps.find((entry) => getAppKey(entry) === appId) || await readAppByIdOrAppId(appsC, appId);
    const fallbackToken = `OWNER_${SAFE(appId || cycleId || campaignName)}`;

    let managerId = "";
    if (isOrphan && orphanReviewerMode === "CUSTOM") {
      managerId = orphanReviewerId;
    } else if (isOrphan && orphanReviewerMode === "APPLICATION_ADMIN") {
      managerId = await resolveAppAdminReviewerId({ hrC, appMeta, fallbackToken });
    } else if (isOrphan && orphanReviewerMode === "APPLICATION_OWNER") {
      managerId = await resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken });
    } else if (reviewerType === "SPECIFIC_USER") {
      managerId = specificReviewerId;
    } else if (reviewerType === "APPLICATION_OWNER") {
      managerId = await resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken });
    } else if (reviewerType === "APPLICATION_ADMIN") {
      managerId = await resolveAppAdminReviewerId({ hrC, appMeta, fallbackToken });
    } else if (reviewerType === "ENTITLEMENT_OWNER") {
      managerId = await resolveEntitlementOwnerReviewerId({ hrC, entitlementsByKey, entitlementOwnerCache, appMeta, appId, entitlement: account?.entitlement, fallbackToken });
    } else if (hr?.managerId && String(hr.managerId).trim()) {
      managerId = String(hr.managerId).trim();
    } else {
      managerId = await resolveAppOwnerReviewerId({ hrC, appMeta, fallbackToken });
    }

    if (!managerId) managerId = fallbackToken;

    items.push({
      account,
      appId,
      appName: String(appMeta?.name || appMeta?.appName || appId || "Unknown Application"),
      managerId,
      userName: String(account?.userName || "").trim() || null,
      appUserId: String(account?.userId || "").trim(),
      entitlement: String(account?.entitlement || "").trim(),
      hrStatus,
      isTerminated,
      isOrphan,
      isPrivileged,
      isSoDConflict: conflictIds.length > 0,
      violatedPolicyIds: conflictIds,
      violatedPolicyNames: conflictNames,
      createdAt: nowIso,
      actionedAt: null,
      remediatedAt: null,
      comment: null
    });
  }

  if (items.length === 0) {
    throw new Error(`No accounts matched selected risk scope (${getRiskScopeLabel(riskScope)}).`);
  }

  const ownerHr = campaignOwnerId ? hrCache.get(campaignOwnerId) || null : null;
  const cycleToken = SAFE(cycleId || campaignName || nowIso) || nanoid();
  const cyclePrimaryAppName = selectedAppIdList.length === 1
    ? String(selectedApps[0]?.name || selectedAppIdList[0])
    : `${selectedAppIdList.length} Applications`;

  const cycle = {
    id: cycleId || `CYC_${cycleToken}_${nowIso.slice(0, 19).replace(/[-:T]/g, "")}_${nanoid()}`,
    cycleId: cycleId || `CYC_${cycleToken}_${nowIso.slice(0, 19).replace(/[-:T]/g, "")}_${nanoid()}`,
    name: campaignName,
    appId: selectedAppIdList.length === 1 ? selectedAppIdList[0] : `MULTI_${cycleToken}`,
    appName: cyclePrimaryAppName,
    appIds: selectedAppIdList,
    appTypes: selectedAppTypeList,
    scope,
    scopeSummary: getScopeSummary(scope),
    reviewerType,
    reviewerLabel: getReviewerLabel(reviewerType),
    specificReviewerId: reviewerType === "SPECIFIC_USER" ? specificReviewerId : undefined,
    campaignOwnerId,
    campaignOwnerName: String(ownerHr?.name || campaignOwnerId),
    dueDate,
    startAt: startNow ? nowIso : startAt,
    startNow,
    stagedAt: mode === "DRAFT" ? nowIso : undefined,
    launchedAt: mode === "ACTIVE" ? nowIso : undefined,
    status: mode === "ACTIVE" ? "ACTIVE" : "DRAFT",
    totalItems: items.length,
    pendingItems: items.length,
    pendingRemediationItems: 0,
    confirmedManagers: [],
    riskScope,
    certificationType: reviewerType,
    orphanReviewerMode,
    orphanReviewerId: orphanReviewerMode === "CUSTOM" ? orphanReviewerId : undefined,
    year: now.getFullYear(),
    quarter: Math.floor(now.getMonth() / 3) + 1,
    type: "review-cycle"
  };
  cycle.id = cycleId || cycle.cycleId;
  cycle.cycleId = cycle.id;

  return {
    cycle,
    items,
    summary: {
      selectedAppIds: selectedAppIdList,
      selectedAppTypes: selectedAppTypeList,
      scopeSummary: cycle.scopeSummary,
      reviewerLabel: cycle.reviewerLabel
    }
  };
}

async function persistCampaignDefinition({ db, definition, mode, existingCycle }) {
  const cyclesC = db.container("reviewCycles");
  const itemsC = db.container("reviewItems");

  if (existingCycle) {
    await deleteDraftArtifacts({ cyclesC, itemsC, cycle: existingCycle });
  }

  await cyclesC.items.upsert(definition.cycle);
  let sequence = 1;
  await Promise.all(definition.items.map((item) => itemsC.items.upsert({
    id: `ITM_${definition.cycle.id}_${String(sequence++).padStart(5, "0")}`,
    reviewCycleId: definition.cycle.id,
    managerId: item.managerId,
    appId: item.appId,
    appName: item.appName,
    appUserId: item.appUserId,
    userName: item.userName,
    entitlement: item.entitlement,
    status: "PENDING",
    hrStatus: item.hrStatus,
    isTerminated: item.isTerminated,
    isOrphan: item.isOrphan,
    isPrivileged: item.isPrivileged,
    isSoDConflict: item.isSoDConflict,
    violatedPolicyIds: item.violatedPolicyIds,
    violatedPolicyNames: item.violatedPolicyNames,
    createdAt: item.createdAt,
    actionedAt: null,
    remediatedAt: null,
    comment: null,
    type: mode === "ACTIVE" ? "review-item" : "review-item-preview"
  })));

  return definition;
}

async function deleteDraftArtifacts({ cyclesC, itemsC, cycle }) {
  const cycleId = String(cycle?.id || cycle?.cycleId || "").trim();
  if (!cycleId) return;
  const { resources: previews } = await itemsC.items.query({
    query: "SELECT c.id, c.managerId FROM c WHERE c.reviewCycleId=@cycleId AND c.type=@type",
    parameters: [
      { name: "@cycleId", value: cycleId },
      { name: "@type", value: "review-item-preview" }
    ]
  }).fetchAll();
  await Promise.all((previews || []).map((item) => itemsC.item(item.id, item.managerId).delete().catch(() => null)));
  await cyclesC.item(cycleId, String(cycle?.appId || "").trim()).delete().catch(() => null);
}

async function materializeCampaign({ db, payload, actor, now, mode, cycleId, existingCycle }) {
  const definition = await buildCampaignDefinition({ db, payload, actor, now, mode, cycleId });
  return persistCampaignDefinition({ db, definition, mode, existingCycle });
}

async function activateDraftCampaign({ db, cycle, now }) {
  const cyclesC = db.container("reviewCycles");
  const itemsC = db.container("reviewItems");
  const cycleId = String(cycle?.id || cycle?.cycleId || "").trim();
  const appId = String(cycle?.appId || "").trim();
  const nowIso = now.toISOString();

  const { resources: previewItems } = await itemsC.items.query({
    query: "SELECT * FROM c WHERE c.reviewCycleId=@cycleId AND c.type=@type",
    parameters: [
      { name: "@cycleId", value: cycleId },
      { name: "@type", value: "review-item-preview" }
    ]
  }).fetchAll();

  if (!previewItems || previewItems.length === 0) {
    throw new Error("No staged campaign items were found to launch.");
  }

  await Promise.all(previewItems.map((item) => itemsC.item(item.id, item.managerId).patch([
    { op: "set", path: "/type", value: "review-item" },
    { op: "set", path: "/createdAt", value: nowIso }
  ], item._etag ? { accessCondition: { type: "IfMatch", condition: item._etag } } : undefined).catch(async () => {
    const next = { ...item, type: "review-item", createdAt: nowIso };
    delete next._etag;
    delete next._rid;
    delete next._self;
    delete next._attachments;
    delete next._ts;
    await itemsC.items.upsert(next);
  })));

  await cyclesC.item(cycleId, appId).patch([
    { op: "set", path: "/status", value: "ACTIVE" },
    { op: "set", path: "/launchedAt", value: nowIso }
  ], cycle._etag ? { accessCondition: { type: "IfMatch", condition: cycle._etag } } : undefined);

  return previewItems.map((item) => ({ ...item, type: "review-item", createdAt: nowIso }));
}

async function readCycleById(cyclesC, cycleId) {
  const { resources } = await cyclesC.items.query({
    query: "SELECT TOP 1 * FROM c WHERE c.id=@id OR c.cycleId=@id",
    parameters: [{ name: "@id", value: cycleId }]
  }, { enableCrossPartitionQuery: true }).fetchAll();
  return resources?.[0] || null;
}

async function findOverlappingDraftOrActiveCycles(cyclesC, appIds, skipCycleId) {
  const { resources } = await cyclesC.items.query({
    query: "SELECT * FROM c WHERE c.type='review-cycle' AND c.status NOT IN ('COMPLETED','CANCELLED')"
  }, { enableCrossPartitionQuery: true }).fetchAll();
  const targetIds = new Set((appIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  return (resources || []).filter((cycle) => {
    const currentCycleId = String(cycle?.id || cycle?.cycleId || "").trim();
    if (skipCycleId && currentCycleId === skipCycleId) return false;
    const cycleAppIds = Array.isArray(cycle?.appIds) && cycle.appIds.length > 0
      ? cycle.appIds.map((id) => String(id || "").trim())
      : [String(cycle?.appId || "").trim()].filter(Boolean);
    return cycleAppIds.some((id) => targetIds.has(id));
  });
}

module.exports = {
  APP_TYPE_SCOPE_MAP,
  REVIEWER_TYPES,
  getScopeSummary,
  getReviewerLabel,
  getRiskScopeLabel,
  readAppByIdOrAppId,
  readCycleById,
  buildCampaignDefinition,
  persistCampaignDefinition,
  materializeCampaign,
  activateDraftCampaign,
  findOverlappingDraftOrActiveCycles
};