import React, { useState, useMemo, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import ManagerPortal from './components/ManagerPortal';
import Governance from './components/Governance';
import MyAccess from './components/MyAccess';
import { UserRole, ReviewCycle, ReviewStatus, ReviewItem, ActionStatus, AuditLog, User, ApplicationAccess, Application, EntitlementDefinition, SoDPolicy } from './types';
import { FileSpreadsheet, XCircle, Search, Calendar, Filter, User as UserIcon, Zap } from 'lucide-react';
import { saveMessageToBackend } from './services/api';
import { getApplications } from "./services/api";
import { getEntitlements } from "./services/api";
import { getAccounts } from "./services/api";
import { getAuditLogs } from "./services/api";
import { getHrUsers } from "./services/api";
import { getSodPolicies } from "./services/api";

import {
  importHrUsers,
  importApplications,
  importAccounts,
  importEntitlements,
  importSodPolicies,
  deleteApplication,
  getReviewCycles,
  getReviewItems,
  launchReview,
  actOnItem,
  reassignReviewItem,
  confirmManager,
  archiveCycle,
  loginUser,
  changePassword,
  resetUserPassword,
  setUserRole,
  setUserRolesBulk
} from "./services/api";



const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState({ name: 'Admin User', id: 'ADM001', role: UserRole.ADMIN });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetCurrentPassword, setResetCurrentPassword] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resettingPassword, setResettingPassword] = useState(false);
  
  const [users, setUsers] = useState<User[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [access, setAccess] = useState<ApplicationAccess[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementDefinition[]>([]);
  const [sodPolicies, setSodPolicies] = useState<SoDPolicy[]>([]);
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  const getApplicationId = (app: any): string => String(app?.id ?? app?.appId ?? '');
  const getApplicationById = (appId?: string | null): Application | undefined => {
    if (!appId) return undefined;
    const target = String(appId);
    return applications.find((app: any) => String(app?.id ?? app?.appId ?? '') === target);
  };
  const getApplicationNameById = (appId?: string | null): string => {
    const app = getApplicationById(appId);
    return app?.name || String(appId || 'Unknown App');
  };
  const getApplicationOwnerById = (appId?: string | null): string => {
    const app = getApplicationById(appId);
    return String((app as any)?.ownerId ?? '');
  };
  const shouldResolveToAppOwner = (managerId?: string | null): boolean => {
    const value = String(managerId || '').trim().toUpperCase();
    return !value || value === 'APP_OWNER' || value === 'APP-OWNER' || value === 'APP OWNER';
  };
  const normalizeCycle = (cycle: any): ReviewCycle => {
    const normalizedAppId = String(cycle?.appId ?? cycle?.applicationId ?? '');
    const normalizedStatus = cycle?.status === ReviewStatus.PENDING_VERIFICATION
      ? ReviewStatus.REMEDIATION
      : cycle?.status;
    return {
      ...cycle,
      appId: normalizedAppId,
      status: normalizedStatus,
      appName: cycle?.appName || getApplicationNameById(normalizedAppId),
      pendingRemediationItems: typeof cycle?.pendingRemediationItems === 'number' ? cycle.pendingRemediationItems : 0,
      confirmedManagers: Array.isArray(cycle?.confirmedManagers) ? cycle.confirmedManagers : [],
    };
  };
  const normalizeReviewItem = (item: any): ReviewItem => {
    const parentCycle = cycles.find(c => c.id === item?.reviewCycleId);
    const normalizedAppId = String(item?.appId ?? item?.applicationId ?? parentCycle?.appId ?? '');
    const isOrphan = typeof item?.isOrphan === 'boolean' ? item.isOrphan : false;
    const resolvedManagerId = (isOrphan && shouldResolveToAppOwner(item?.managerId))
      ? (getApplicationOwnerById(normalizedAppId) || String(item?.managerId || ''))
      : String(item?.managerId || '');
    return {
      ...item,
      appName: item?.appName || parentCycle?.appName || getApplicationNameById(normalizedAppId),
      managerId: resolvedManagerId,
      isSoDConflict: typeof item?.isSoDConflict === 'boolean' ? item.isSoDConflict : false,
      isOrphan,
      isPrivileged: typeof item?.isPrivileged === 'boolean' ? item.isPrivileged : false,
      violatedPolicyNames: Array.isArray(item?.violatedPolicyNames) ? item.violatedPolicyNames : [],
      violatedPolicyIds: Array.isArray(item?.violatedPolicyIds) ? item.violatedPolicyIds : [],
      reassignmentCount: typeof item?.reassignmentCount === 'number' ? item.reassignmentCount : 0,
    };
  };

  // UAR Loading/Error States
  const [uarLoading, setUarLoading] = useState(false);
  const [uarError, setUarError] = useState<string | null>(null);
  const [launchingReview, setLaunchingReview] = useState(false);
  const [actingOnItem, setActingOnItem] = useState<string | null>(null); // itemId being actioned
  const [confirmingReview, setConfirmingReview] = useState<string | null>(null); // cycleId being confirmed

  // Audit Log Filter State
  const [auditFilterUser, setAuditFilterUser] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('ALL');
  const [auditFilterDateFrom, setAuditFilterDateFrom] = useState('');
  const [auditFilterDateTo, setAuditFilterDateTo] = useState('');

  const handleLogin = async () => {
    setLoginError(null);
    const email = loginEmail.trim().toLowerCase();
    const password = loginPassword;

    if (!email || !password) {
      setLoginError('Enter emailId and password.');
      return;
    }

    setLoggingIn(true);
    try {
      const res: any = await loginUser({ email, password });
      const roleRaw = String(res?.user?.role || '').toUpperCase();
      const role = roleRaw === UserRole.ADMIN ? UserRole.ADMIN : roleRaw === UserRole.AUDITOR ? UserRole.AUDITOR : UserRole.USER;
      setCurrentUser({
        name: String(res?.user?.name || res?.user?.userId || 'User'),
        id: String(res?.user?.id || res?.user?.userId || ''),
        role
      });
      setActiveTab(role === UserRole.USER ? 'my-access' : 'dashboard');
      setIsAuthenticated(true);
    } catch (err: any) {
      setLoginError(err?.message || 'Invalid emailId or password.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setActiveTab('dashboard');
    setLoginEmail('');
    setLoginPassword('');
    setLoginError(null);
    setLoggingIn(false);
    setCurrentUser({ name: 'Admin User', id: 'ADM001', role: UserRole.ADMIN });
  };

  const handleSelfPasswordReset = async () => {
    setResetError(null);
    setResetSuccess(null);

    const email = resetEmail.trim().toLowerCase();
    if (!email || !resetCurrentPassword || !resetNewPassword || !resetConfirmPassword) {
      setResetError('Fill all fields.');
      return;
    }
    if (resetNewPassword.length < 8) {
      setResetError('New password must be at least 8 characters.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError('New password and confirm password must match.');
      return;
    }

    setResettingPassword(true);
    try {
      await changePassword({ email, currentPassword: resetCurrentPassword, newPassword: resetNewPassword });
      setShowPasswordReset(false);
      setResetSuccess(null);
      setResetError(null);
      setResetCurrentPassword('');
      setResetNewPassword('');
      setResetConfirmPassword('');
      setLoginEmail(email);
      setLoginPassword('');
    } catch (err: any) {
      setResetError(err?.message || 'Failed to reset password.');
    } finally {
      setResettingPassword(false);
    }
  };

  /*const addAuditLog = (action: string, details: string) => {
    const newLog: AuditLog = {
      id: `LOG${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      action,
      details,
    };
    setAuditLogs(prev => [newLog, ...prev]);
  };*/

const addAuditLog = async (action: string, details: string) => {
  const newLog: AuditLog = {
    id: `LOG${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: currentUser.id,
    userName: currentUser.name,
    action,
    details,
  };

  // 1) Keep local state (UI stays instant)
  setAuditLogs(prev => [newLog, ...prev]);

  // 2) Persist to Azure (Cosmos via Function)
  try {
    // Combine action + details as the message body we store server-side
    const message = `[${action}] ${details}`;
    const id = await saveMessageToBackend(message);
    // (Optional) You can append the backend id into the log if you want:
    // setAuditLogs(prev => prev.map(l => l.id === newLog.id ? { ...l, details: `${l.details} (id:${id})` } : l));
    console.debug('Saved to Cosmos. id=', id);
  } catch (err: any) {
    console.error('Backend save failed:', err?.message || err);
    // (Optional) surface a toast/snackbar here if you have one.
  }
};

useEffect(() => {
  let isMounted = true;

  async function loadApps() {
    try {
      // optional: set a tiny loading flag if you want
      const res = await getApplications(100);
	  if (!res?.ok && res?.status) {
  // Show a toast or set a local error label
  console.error("Applications load failed:", res.message);
  // e.g., setStatus(`Failed to load applications: ${res.message}`);
  return;
}
      if (!isMounted) return;

      // res.items = array of applications from Cosmos
      // Each item has at least: { appId, name, ownerId, description, ... }
      setApplications(res.items || []);
    } catch (e) {
      // optional: surface a toast/log
      console.error("Failed to load applications:", e);
    }
  }

  loadApps();
  return () => { isMounted = false; };
}, []); // ← run once on first render

useEffect(() => {
  if (!selectedAppId && applications.length > 0) {
    setSelectedAppId(getApplicationId(applications[0]));
  }
}, [applications, selectedAppId]);

useEffect(() => {
  let alive = true;
  async function loadEnts() {
    if (!selectedAppId) return;
    try {
      const res = await getEntitlements(selectedAppId, undefined, 200);
      if (!alive) return;
      // res.items = array of entitlements from Cosmos for this app
      setEntitlements(res.items || []);
    } catch (e) {
      console.error("Failed to load entitlements:", e);
      if (alive) setEntitlements([]); // keep UI stable
    }
  }
  loadEnts();
  return () => { alive = false; };
}, [selectedAppId]);

useEffect(() => {
  let alive = true;

  async function loadAccounts() {
    if (!selectedAppId) {
      setAccess([]);  // clear when no app selected
      return;
    }
    try {
      const res = await getAccounts(selectedAppId, undefined, undefined, 200);
      if (!alive) return;

      if (!res?.ok && res?.status) {
        // Friendly error handling from Step 4
        console.error(`Failed to load accounts for ${selectedAppId}:`, res.message);
        setAccess([]);
        return;
      }

      // res.items is an array of accounts from Cosmos
      const raw = res.items || [];
      const enriched: ApplicationAccess[] = raw.map((acc: any) => ({
        ...acc,
        // ensure correlation fields are present
        ...correlateAccount(acc, users),
        userName: acc.userName || acc.name || acc.userName || '',
      }));

      // Merge into existing access state (replace this app's entries) and recalc SoD across all apps
      setAccess(prev => {
        const other = prev.filter(a => a.appId !== selectedAppId);
        const merged = [...other, ...enriched];
        return recalculateSoD(merged, sodPolicies);
      });
    } catch (e) {
      console.error("Accounts load error:", e);
      if (alive) setAccess([]);
    }
  }

  loadAccounts();
  return () => { alive = false; };
}, [selectedAppId]);

useEffect(() => {
  let alive = true;
  (async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      // Basic page 1. You can implement paging later with continuationToken.
      const res = await getHrUsers({ top: 200 });
      if (!alive) return;

      if (!res?.ok && res?.status) {
        // Friendly message from Step 4’s hardened helper
        setUsersError(res.message || "Failed to load HR users.");
        setUsers([]);
        return;
      }

      setUsers(res.items || []);
      // If you want to keep the token for “Load more…” later:
      // setUsersNext(res.continuationToken || undefined);
    } catch (e: any) {
      if (!alive) return;
      setUsersError(e?.message || "Failed to load HR users.");
      setUsers([]);
    } finally {
      if (alive) setUsersLoading(false);
    }
  })();
  return () => { alive = false; };
}, []);

useEffect(() => {
  let alive = true;
  (async () => {
    try {
      const res = await getSodPolicies();              // GET /api/sod-get
      if (!alive) return;
      const items = res?.items ?? [];
      setSodPolicies(items);
      // Re-evaluate SoD on whatever access is already in state
      setAccess(prev => recalculateSoD(prev, items));
    } catch (e) {
      console.error("Failed to load SoD policies:", e);
      if (alive) setSodPolicies([]);
    }
  })();
  return () => { alive = false; };
}, []);

useEffect(() => {
  let alive = true;
  (async () => {
    try {
      setUarLoading(true);
      setUarError(null);
      // Fetch review cycles and items from backend
      const cyclesRes = await getReviewCycles({ top: 200 });
      const itemsRes = await getReviewItems({ top: 500 });
      if (!alive) return;
      setCycles(Array.isArray(cyclesRes?.cycles) ? cyclesRes.cycles.map(normalizeCycle) : []);
      setReviewItems(Array.isArray(itemsRes?.items)
        ? itemsRes.items.map(normalizeReviewItem)
        : []);
    } catch (e) {
      console.error("Failed to load UAR data:", e);
      if (alive) {
        setUarError(e?.message || "Failed to load review campaigns and items.");
        setCycles([]);
        setReviewItems([]);
      }
    } finally {
      if (alive) setUarLoading(false);
    }
  })();
  return () => { alive = false; };
}, []);

useEffect(() => {
  if (applications.length === 0) return;
  setCycles(prev => prev.map(normalizeCycle));
  setReviewItems(prev => prev.map(normalizeReviewItem));
}, [applications]);

  const correlateAccount = (acc: any, identityList: User[]): Partial<ApplicationAccess> => {
    // Prefer matching by email first. If email matches, use it and skip id checks.
    const accEmails = [acc.email, acc.userEmail, acc.accountEmail].filter(Boolean).map((s: string) => s.toLowerCase());
    let match: User | undefined;
    if (accEmails.length > 0) {
      match = identityList.find(u => u.email && accEmails.includes(u.email.toLowerCase()));
      if (match) {
        return {
          correlatedUserId: match.id,
          isOrphan: false,
          email: match.email,
          userName: match.name || acc.userName || acc.name || ''
        };
      }
    }

    // If email didn't match, try various id fields (employee id, account id, etc.)
    const possibleIds = [acc.userId, acc.accountId, acc.employeeId, acc.account_id, acc.id].filter(Boolean);
    if (possibleIds.length > 0) {
      match = identityList.find(u => possibleIds.includes(u.id));
      if (match) {
        return {
          correlatedUserId: match.id,
          isOrphan: false,
          email: acc.email || match.email,
          userName: match.name || acc.userName || acc.name || ''
        };
      }
    }

    // No match -> orphan
    return {
      correlatedUserId: undefined,
      isOrphan: true,
      email: acc.email || undefined,
      userName: acc.userName || acc.name || ''
    };
  };

  const recalculateSoD = (currentAccess: ApplicationAccess[], policies: SoDPolicy[]): ApplicationAccess[] => {
    // Build access map per logical owner: prefer correlatedUserId, fall back to account/userId for orphans
    const userAccessMap: Record<string, { appId: string, entitlement: string }[]> = {};
    currentAccess.forEach(acc => {
      const fallbackId = acc.userId || acc.id || '';
      const key = acc.correlatedUserId ? `u:${acc.correlatedUserId}` : `a:${fallbackId}`;
      if (!userAccessMap[key]) userAccessMap[key] = [];
      userAccessMap[key].push({ appId: acc.appId, entitlement: acc.entitlement });
    });

    return currentAccess.map(acc => {
      const fallbackId = acc.userId || acc.id || '';
      const key = acc.correlatedUserId ? `u:${acc.correlatedUserId}` : `a:${fallbackId}`;
      const userItems = userAccessMap[key] || [];
      const violatedPolicies = policies.filter(policy => {
        const has1 = userItems.some(i => i.appId === policy.appId1 && i.entitlement.trim().toLowerCase() === policy.entitlement1.trim().toLowerCase());
        const has2 = userItems.some(i => i.appId === policy.appId2 && i.entitlement.trim().toLowerCase() === policy.entitlement2.trim().toLowerCase());
        if (has1 && has2) {
          return (acc.appId === policy.appId1 && acc.entitlement.trim().toLowerCase() === policy.entitlement1.trim().toLowerCase()) ||
                 (acc.appId === policy.appId2 && acc.entitlement.trim().toLowerCase() === policy.entitlement2.trim().toLowerCase());
        }
        return false;
      });
      return { 
        ...acc, 
        isSoDConflict: violatedPolicies.length > 0,
        violatedPolicyNames: violatedPolicies.map(p => p.policyName),
        violatedPolicyIds: violatedPolicies.map(p => p.id)
      };
    });
  };

  useEffect(() => {
    setCycles(prevCycles => {
      let hasGlobalChanges = false;
      // Collect cycles that need archiving and update cycles synchronously
      const cyclesToArchive = [];
      const nextCycles = prevCycles.map(cycle => {
        if (cycle.status === ReviewStatus.COMPLETED) return cycle;
        const cycleItems = reviewItems.filter(i => i.reviewCycleId === cycle.id);
        if (cycleItems.length === 0) return cycle;
        const pendingReviewCount = cycleItems.filter(i => i.status === ActionStatus.PENDING).length;
        const pendingRemediationCount = cycleItems.filter(i => i.status === ActionStatus.REVOKED).length;
        const managersInCycle = Array.from(new Set(cycleItems.map(i => i.managerId)));
        const allManagersConfirmed = managersInCycle.length > 0 && managersInCycle.every(mId => cycle.confirmedManagers.includes(mId));
        let nextStatus: ReviewStatus = ReviewStatus.ACTIVE;
        let completedAt = cycle.completedAt;
        let needsArchive = false;

        if (allManagersConfirmed && pendingReviewCount === 0 && pendingRemediationCount > 0) {
          nextStatus = ReviewStatus.REMEDIATION;
          completedAt = undefined;
        } else if (allManagersConfirmed && pendingReviewCount === 0 && pendingRemediationCount === 0) {
          nextStatus = ReviewStatus.COMPLETED;
          completedAt = completedAt || new Date().toISOString();
          if (cycle.status !== ReviewStatus.COMPLETED) {
            needsArchive = true;
          }
        } else {
          nextStatus = ReviewStatus.ACTIVE;
          completedAt = undefined;
        }
        if (needsArchive) {
          cyclesToArchive.push({ cycleId: cycle.id, appId: cycle.appId });
        }
        if (nextStatus !== cycle.status || cycle.pendingItems !== pendingReviewCount || cycle.pendingRemediationItems !== pendingRemediationCount || cycle.completedAt !== completedAt) {
          hasGlobalChanges = true;
          return { ...cycle, status: nextStatus, pendingItems: pendingReviewCount, pendingRemediationItems: pendingRemediationCount, completedAt };
        }
        return cycle;
      });
      // Fire-and-forget archive requests (do not await in map)
      if (cyclesToArchive.length > 0) {
        cyclesToArchive.forEach(({ cycleId, appId }) => {
          archiveCycle({ cycleId, appId }).catch(e => console.error('Failed to archive cycle:', e));
        });
      }
      return hasGlobalChanges ? nextCycles : prevCycles;
    });
  }, [reviewItems, cycles.map(c => c.confirmedManagers.length).join(',')]);

  // Recalculate correlation and SoD whenever HR users or SoD policies change
  useEffect(() => {
    setAccess(prev => {
      const updated = prev.map(acc => ({ ...acc, ...correlateAccount(acc, users) }));
      return recalculateSoD(updated, sodPolicies);
    });
  }, [users, sodPolicies]);

  const handleConfirmReview = async (cycleId: string, managerId: string) => {
    setConfirmingReview(cycleId);
    try {
      const cycle = cycles.find(c => c.id === cycleId);
      if (!cycle) {
        throw new Error('Review cycle not found');
      }

      // Call backend to confirm manager review
      await confirmManager({
        cycleId,
        appId: cycle.appId,
        managerId
      });

      // Refresh cycles from backend
      const cyclesRes = await getReviewCycles({ top: 200 });
      setCycles(Array.isArray(cyclesRes?.cycles) ? cyclesRes.cycles.map(normalizeCycle) : []);

      // Also refresh items in case cycle status changed to COMPLETED and items need refresh
      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? itemsRes.items.map(normalizeReviewItem) : []);

      await addAuditLog('MANAGER_CONFIRM', `Manager ${managerId} locked decisions for campaign: ${cycleId}.`);
      alert('✓ Review finalized successfully!');
    } catch (e: any) {
      console.error('Failed to confirm review:', e);
      alert(`Failed to finalize review: ${e?.message || 'Unknown error'}`);
    } finally {
      setConfirmingReview(null);
    }
  };
  const handleDataImport = async (
  type: 'HR' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD' | 'APPLICATIONS',
  data: any[],
  appId?: string
) => {
  try {
    if (type === 'HR') {
		
 // 🔁 Normalize CSV rows to the expected DTO
      const normalized = data.map((r: any) => {
        const userId = r.userId || r.id;  // map 'id' -> 'userId' if needed
        return {
          id: userId,                     // keep id and userId aligned
          userId,
          name: r.name ?? '',
          email: r.email ?? '',
          managerId: r.managerId ?? '',
          department: r.department ?? '',
          title: r.title ?? '',           // optional
          status: r.status ?? 'Active',   // default
          type: 'hr-user'
        };
	  });
	  
	  
    const importResult: any = await importHrUsers(normalized, { replaceAll: true, debug: true, resetPasswords: false, returnCredentials: true });            // POST to /api/hr/import
      if (Array.isArray(importResult?.credentials) && importResult.credentials.length > 0) {
        const headers = ['userId', 'name', 'email', 'temporaryPassword', 'mustChangePassword'];
        const rows = importResult.credentials.map((cred: any) => [
          cred.userId,
          cred.name,
          cred.email,
          cred.temporaryPassword,
          String(!!cred.mustChangePassword)
        ]);
        const csv = [headers.join(','), ...rows.map((row: string[]) => row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `new_user_credentials_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        alert(`Generated ${importResult.credentials.length} temporary passwords. CSV downloaded for secure sharing.`);
      }
      const res = await getHrUsers({ top: 200 }); // refresh
      setUsers(res.items ?? []);
      setAccess(prev => recalculateSoD(prev, sodPolicies));
      return;
    } else if (type === 'APPLICATIONS') {
      await importApplications(data);
      const res = await getApplications(100);
      setApplications(res.items ?? []);
      // If needed, auto-select the first app again
      if (!selectedAppId && (res.items ?? []).length > 0) {
        setSelectedAppId(res.items[0].appId ?? res.items[0].id);
      }
    } else if (type === 'APP_ACCESS') {
      if (!appId) { alert("Missing appId for Accounts import"); return; }
      // Enrich payload with correlation fields so backend persists correlation/isOrphan
      const targetApp = applications.find(a => a.id === appId) || applications.find(a => a.appId === appId);
      const enrichedPayload = data.map((item: any) => ({ ...item, appId: appId!, ...correlateAccount(item, users) }));
      // Persist enriched accounts to backend
      await importAccounts(appId!, enrichedPayload);

      // Build access list locally so UI can immediately reflect correlation, entitlements, and SoD
      const newAccessList: ApplicationAccess[] = enrichedPayload.map((item, idx) => ({
        ...item,
        id: `ACC_${appId}_${idx}_${Date.now()}`,
        appName: targetApp?.name || '',
        isSoDConflict: false
      }));

      // Sync entitlements catalog from uploaded accounts
      const uniqueEntsFromAccess = Array.from(new Set(newAccessList.map(a => a.entitlement)));
      setEntitlements(prev => {
        const otherAppEnts = prev.filter(e => e.appId !== appId);
        const existingAppEnts = prev.filter(e => e.appId === appId);
        const synchronizedEnts = uniqueEntsFromAccess.map(entName => {
          const existing = existingAppEnts.find(e => e.entitlement === entName);
          return existing || { appId: appId!, entitlement: entName, description: '', owner: '', isPrivileged: false, risk: 'LOW' as const, riskScore: '0' };
        });
        return [...otherAppEnts, ...synchronizedEnts];
      });

      // Update review items in backend: mark revoked items as remediated if they no longer exist
      const remediatedCandidates = reviewItems.filter(item => {
        const cycle = cycles.find(c => c.id === item.reviewCycleId);
        if (!cycle || cycle.appId !== appId || item.status !== ActionStatus.REVOKED) return false;
        const stillExists = newAccessList.some(acc => acc.userId === item.appUserId && acc.entitlement === item.entitlement);
        return !stillExists;
      });

      if (remediatedCandidates.length > 0) {
        const remediationTimestamp = new Date().toISOString();
        await Promise.all(
          remediatedCandidates.map(item =>
            actOnItem({
              itemId: item.id,
              managerId: item.managerId || currentUser.id,
              status: ActionStatus.REMEDIATED,
              remediationComment: 'Verified removed via account upload',
              remediatedAt: remediationTimestamp
            })
          )
        );
      }

      const refreshedItemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(refreshedItemsRes?.items)
        ? refreshedItemsRes.items.map(normalizeReviewItem)
        : []);

      // Recalculate SoD and set access state
      setAccess(prev => recalculateSoD([...prev.filter(a => a.appId !== appId), ...newAccessList], sodPolicies));
      addAuditLog('DATA_IMPORT', `Imported ${data.length} accounts for ${targetApp?.name || appId}.`);
    } else if (type === 'APP_ENT') {
      if (!appId) { alert("Missing appId for Entitlements import"); return; }
      await importEntitlements(appId, data);
      const res = await getEntitlements(appId, undefined, 200);
      setEntitlements(res.items ?? []);
      // Optional: recalc SoD (privileged flags may change)
      setAccess(prev => recalculateSoD(prev, sodPolicies));
    } else if (type === 'APP_SOD') {
      try {
        const res = await importSodPolicies(data);
        console.debug('sod-import response:', res);
      } catch (err: any) {
        console.error('sod-import failed:', err);
        // show a helpful alert including server message if available
        window.alert('SoD import failed: ' + (err?.message || JSON.stringify(err)));
        throw err;
      }
      const sod = await getSodPolicies();
      const items = sod.items ?? [];
      setSodPolicies(items);
      setAccess(prev => recalculateSoD(prev, items));
    }
    // Optionally add: addAuditLog('DATA_IMPORT', `Imported ${data.length} items for ${type}${appId ? ' ('+appId+')' : ''}.`);
  } catch (e: any) {
    console.error(`Import failed for ${type}${appId ? ` (${appId})` : ''}:`, e?.message ?? e);
    alert(e?.message ?? `Import failed for ${type}.`);
  }
};

  /*const handleDataImport = (type: 'HR' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD', data: any[], appId?: string) => {
    if (type === 'HR') {
      const newUsers = data as User[];
      setUsers(newUsers);
      setAccess(prev => {
        const correlated = prev.map(acc => ({ ...acc, ...correlateAccount(acc, newUsers) }));
        return recalculateSoD(correlated, sodPolicies);
      });
      addAuditLog('DATA_IMPORT', `Admin imported ${data.length} HR records.`);
    } else if (type === 'APP_ACCESS') {
      const targetApp = applications.find(a => a.id === appId);
      if (!targetApp) return;
      const newAccessList: ApplicationAccess[] = data.map((item, idx) => ({
          ...item,
          id: `ACC_${appId}_${idx}_${Date.now()}`,
          appId: appId!,
          appName: targetApp.name,
          ...correlateAccount(item, users),
          isSoDConflict: false
      }));
      const uniqueEntsFromAccess = Array.from(new Set(newAccessList.map(a => a.entitlement)));
      setEntitlements(prev => {
        const otherAppEnts = prev.filter(e => e.appId !== appId);
        const existingAppEnts = prev.filter(e => e.appId === appId);
        const synchronizedEnts = uniqueEntsFromAccess.map(entName => {
          const existing = existingAppEnts.find(e => e.entitlement === entName);
          return existing || { appId: appId!, entitlement: entName, description: '', owner: '', isPrivileged: false, risk: 'LOW' as const, riskScore: '0' };
        });
        return [...otherAppEnts, ...synchronizedEnts];
      });
      setReviewItems(prevItems => {
        return prevItems.map(item => {
          const cycle = cycles.find(c => c.id === item.reviewCycleId);
          if (cycle?.appId === appId && item.status === ActionStatus.REVOKED) {
            const stillExists = newAccessList.some(acc => acc.userId === item.appUserId && acc.entitlement === item.entitlement);
            if (!stillExists) return { ...item, status: ActionStatus.REMEDIATED, remediatedAt: new Date().toISOString() };
          }
          return item;
        });
      });
      setAccess(prev => recalculateSoD([...prev.filter(a => a.appId !== appId), ...newAccessList], sodPolicies));
      addAuditLog('DATA_IMPORT', `Imported ${data.length} accounts for ${targetApp.name}.`);
    } else if (type === 'APP_ENT') {
      const importedEnts: EntitlementDefinition[] = data.map(item => {
        const isPriv = String(item.isPrivileged).toLowerCase() === 'true' || item.isPrivileged === 'YES';
        return { ...item, appId: appId!, isPrivileged: isPriv, risk: isPriv ? 'HIGH' : (item.risk || 'LOW'), riskScore: isPriv ? '10' : (item.riskScore || '0') };
      });
      setEntitlements(prev => [...prev.filter(e => e.appId !== appId), ...importedEnts]);
      addAuditLog('DATA_IMPORT', `Updated catalog for app: ${appId}.`);
    } else if (type === 'APP_SOD') {
      const newSods: SoDPolicy[] = data.map((item, idx) => ({ ...item, id: item.id || `SOD_G_${idx}_${Date.now()}` }));
      setSodPolicies(newSods);
      setAccess(prev => recalculateSoD(prev, newSods));
      addAuditLog('DATA_IMPORT', `Global SoD catalog refreshed.`);
    }
  };*/

  const handleUpdateSoD = (newPolicies: SoDPolicy[]) => {
    setSodPolicies(newPolicies);
    setAccess(prev => recalculateSoD(prev, newPolicies));
    addAuditLog('SOD_UPDATE', `SoD policies updated manually.`);
  };

  const handleLaunchReview = async (appId: string, dueDateStr?: string) => {
    const targetApp = getApplicationById(appId);
    if (!targetApp) return;
    const normalizedAppId = getApplicationId(targetApp);
    const existingActive = cycles.find(c => c.appId === normalizedAppId && c.status !== ReviewStatus.COMPLETED);
    if (existingActive) { alert(`A campaign for ${targetApp.name} is already running.`); return; }
    const appAccess = access.filter(a => a.appId === normalizedAppId);
    if (appAccess.length === 0) { alert(`No accounts found for ${targetApp.name}.`); return; }

    setLaunchingReview(true);
    try {
      const now = new Date();
      const dueDate = dueDateStr ? new Date(dueDateStr) : new Date();
      if (!dueDateStr) dueDate.setDate(dueDate.getDate() + 14);

      // Call backend to launch review
      if (!normalizedAppId || typeof normalizedAppId !== 'string' || normalizedAppId.trim().length === 0) {
        throw new Error('No valid appId provided for UAR launch');
      }
      const response = await launchReview({
        appId: normalizedAppId.trim(),
        name: targetApp.name,
        dueDate: dueDate.toISOString()
      });

      // Refresh cycles and items from backend
      const cyclesRes = await getReviewCycles({ top: 200 });
      const itemsRes = await getReviewItems({ top: 500 });
      console.debug('UAR: cycles after launch', cyclesRes);
      console.debug('UAR: items after launch', itemsRes);
      setCycles(Array.isArray(cyclesRes?.cycles) ? cyclesRes.cycles.map(normalizeCycle) : []);
      setReviewItems(Array.isArray(itemsRes?.items) ? itemsRes.items.map(normalizeReviewItem) : []);

      await addAuditLog('CAMPAIGN_LAUNCH', `Launched review campaign for ${targetApp.name}. Cycle ID: ${response?.id || 'N/A'}`);
      alert(`✓ Review campaign launched for ${targetApp.name}!`);
    } catch (e: any) {
      console.error('Failed to launch review:', e);
      alert(`Failed to launch review: ${e?.message || 'Unknown error'}`);
    } finally {
      setLaunchingReview(false);
    }
  };

  const handleAction = async (itemId: string, status: ActionStatus, comment?: string) => {
    setActingOnItem(itemId);
    try {
      console.log('[handleAction] Start', { itemId, status, comment });
      const item = reviewItems.find(i => i.id === itemId);
      console.log('[handleAction] Found item:', item);
      if (!item) {
        throw new Error('Item not found');
      }

      // Call backend to update item status
      console.log('[handleAction] Calling actOnItem');
      await actOnItem({
        itemId,
        managerId: currentUser.id,
        status,
        comment
      });
      console.log('[handleAction] actOnItem complete');

      // Refresh items from backend
      console.log('[handleAction] Fetching review items from backend');
      const itemsRes = await getReviewItems({ top: 500 });
      console.log('[handleAction] itemsRes:', itemsRes);
      const mappedItems = Array.isArray(itemsRes?.items)
        ? itemsRes.items.map(normalizeReviewItem)
        : [];
      console.log('[handleAction] mappedItems:', mappedItems);
      setReviewItems(mappedItems);

      await addAuditLog('ITEM_ACTION', `${status} on review item ${itemId}`);
      console.log('[handleAction] addAuditLog complete');
    } catch (e: any) {
      console.error('[handleAction] Failed to action item:', e);
      alert(`Failed to update item: ${e?.message || 'Unknown error'}`);
    } finally {
      setActingOnItem(null);
      console.log('[handleAction] End');
    }
  };

  const handleBulkAction = async (itemIds: string[], status: ActionStatus, comment?: string) => {
    setActingOnItem('bulk');
    try {
      // Call backend for each item
      await Promise.all(
        itemIds.map(itemId =>
          actOnItem({
            itemId,
            managerId: currentUser.id,
            status,
            comment
          })
        )
      );

      // Refresh items from backend
      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items)
        ? itemsRes.items.map(normalizeReviewItem)
        : []);
      
      await addAuditLog('BULK_DECISION', `Bulk ${status} on ${itemIds.length} items`);
    } catch (e: any) {
      console.error('Failed to bulk action items:', e);
      alert(`Failed to bulk update: ${e?.message || 'Unknown error'}`);
    } finally {
      setActingOnItem(null);
    }
  };

  const handleReassignReviewItem = async (itemId: string, fromManagerId: string, toManagerId: string, comment?: string) => {
    try {
      await reassignReviewItem({ itemId, managerId: fromManagerId, reassignToManagerId: toManagerId, comment });
      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? itemsRes.items.map(normalizeReviewItem) : []);
      await addAuditLog('ITEM_REASSIGN', `Reassigned review item ${itemId} from ${fromManagerId} to ${toManagerId}`);
    } catch (e: any) {
      console.error('Failed to reassign review item:', e);
      alert(`Failed to reassign item: ${e?.message || 'Unknown error'}`);
    }
  };

  const handleBulkReassignReviewItems = async (itemsToReassign: Array<{ itemId: string; fromManagerId: string }>, toManagerId: string, comment?: string) => {
    try {
      const results = await Promise.allSettled(
        itemsToReassign.map(item => reassignReviewItem({ itemId: item.itemId, managerId: item.fromManagerId, reassignToManagerId: toManagerId, comment }))
      );

      const successCount = results.filter(result => result.status === 'fulfilled').length;
      const failed = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[];

      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? itemsRes.items.map(normalizeReviewItem) : []);

      await addAuditLog('ITEM_REASSIGN_BULK', `Bulk reassigned ${successCount}/${itemsToReassign.length} items to ${toManagerId}`);

      if (failed.length > 0) {
        const firstFailure = failed[0]?.reason?.message || 'Unknown error';
        alert(`Bulk reassignment completed with partial failures. Success: ${successCount}, Failed: ${failed.length}. First error: ${firstFailure}`);
      }
    } catch (e: any) {
      console.error('Failed to bulk reassign review items:', e);
      alert(`Failed to bulk reassign items: ${e?.message || 'Unknown error'}`);
    }
  };

  // --- Audit Filter Logic ---
  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const matchUser = !auditFilterUser || 
        log.userName.toLowerCase().includes(auditFilterUser.toLowerCase()) || 
        log.userId.toLowerCase().includes(auditFilterUser.toLowerCase());
      const matchAction = auditFilterAction === 'ALL' || log.action === auditFilterAction;
      const logTime = new Date(log.timestamp).getTime();
      const matchFrom = !auditFilterDateFrom || logTime >= new Date(auditFilterDateFrom).getTime();
      const matchTo = !auditFilterDateTo || logTime <= (new Date(auditFilterDateTo).getTime() + 86400000); // end of day
      return matchUser && matchAction && matchFrom && matchTo;
    });
  }, [auditLogs, auditFilterUser, auditFilterAction, auditFilterDateFrom, auditFilterDateTo]);

  const uniqueActions = useMemo(() => Array.from(new Set(auditLogs.map(l => l.action))).sort(), [auditLogs]);

  const exportAuditLogs = () => {
    const headers = ['Timestamp', 'User Name', 'User ID', 'Action', 'Details'];
    const csvContent = [
      headers.join(','),
      ...filteredAuditLogs.map(l => [
        `"${new Date(l.timestamp).toLocaleString()}"`,
        `"${l.userName}"`,
        `"${l.userId}"`,
        `"${l.action}"`,
        `"${l.details.replace(/"/g, '""')}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AccessGuard_Audit_Logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAuditFilters = () => {
    setAuditFilterUser('');
    setAuditFilterAction('ALL');
    setAuditFilterDateFrom('');
    setAuditFilterDateTo('');
  };

  const refreshUsers = async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await getHrUsers({ top: 200 });
      if (!res?.ok && res?.status) {
        setUsersError(res.message || "Failed to refresh HR users.");
        setUsers([]);
        return;
      }
      setUsers(res.items || []);
    } catch (e: any) {
      setUsersError(e?.message || "Failed to refresh HR users.");
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  };

  // Create a single application by reusing the import endpoint (upsert)
  const createApplication = async (app: Application) => {
    try {
      const res = await importApplications([app]);
      if (!res?.ok) {
        console.error('Create application failed:', res);
        window.alert('Failed to create application. See console for details.');
        return;
      }
      // Add to local state (backend should persist)
      setApplications(prev => [...prev, app]);
      await addAuditLog('APP_CREATE', `Created application ${app.name} (${app.id})`);
    } catch (err: any) {
      console.error('Create application error:', err);
      window.alert('Failed to create application. See console for details.');
    }
  };

  // Remove application from backend then local state
  const removeApplication = async (appId?: string | null) => {
  if (!appId) return;
  if (!confirm('This will permanently delete the application and all associated accounts and definitions. Continue?')) return;
  try {
    const res = await deleteApplication(appId);
    if (!res?.ok) {
      console.error('Delete application failed:', res);
      window.alert('Failed to delete application. See console for details.');
      return;
    }
    // Remove from local state
    setApplications(prev => prev.filter(a => a.id !== appId));
    // If the deleted app was selected, clear selection
    if (selectedAppId === appId) setSelectedAppId(null);
    addAuditLog('APP_DELETE', `Deleted application ${appId}`);
  } catch (err: any) {
    console.error('Delete application error:', err);
    window.alert('Failed to delete application. See console for details.');
  }
};

  const handleResetUserPassword = async (userId: string) => {
    const res: any = await resetUserPassword({ userId });
    await addAuditLog('PASSWORD_RESET', `Temporary password reset for user ${userId}`);
    return {
      temporaryPassword: String(res?.temporaryPassword || ''),
      user: res?.user || { userId }
    };
  };

  const handleSetUserRole = async (userId: string, role: UserRole) => {
    const allowedRole = role === UserRole.ADMIN || role === UserRole.AUDITOR ? role : UserRole.USER;
    await setUserRole({ userId, role: allowedRole });
    setUsers(prev => prev.map(user => user.id === userId ? ({ ...user, role: allowedRole } as any) : user));
    await addAuditLog('ROLE_UPDATE', `Updated role for ${userId} to ${allowedRole}`);
  };

  const handleBulkSetUserRole = async (userIds: string[], role: UserRole) => {
    const allowedRole = role === UserRole.ADMIN || role === UserRole.AUDITOR ? role : UserRole.USER;
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    if (uniqueUserIds.length === 0) return;

    const payload = uniqueUserIds.map(userId => ({ userId, role: allowedRole }));
    const result: any = await setUserRolesBulk(payload);
    const successfulIds = Array.isArray(result?.results) && result.results.length > 0
      ? result.results.map((r: any) => String(r.userId))
      : uniqueUserIds;

    setUsers(prev => prev.map(user => successfulIds.includes(user.id) ? ({ ...user, role: allowedRole } as any) : user));
    await addAuditLog('ROLE_UPDATE_BULK', `Updated role to ${allowedRole} for users: ${successfulIds.join(', ')}`);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AccessGuard Login</h1>
            <p className="text-sm text-slate-500 mt-1">Sign in with emailId and password.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Email Id</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => {
                  setLoginEmail(event.target.value);
                  setLoginError(null);
                }}
                placeholder="name@company.com"
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Password</label>
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => {
                  setLoginPassword(event.target.value);
                  setLoginError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleLogin();
                }}
                placeholder="Enter password"
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {loginError && <p className="text-sm text-red-600">{loginError}</p>}

            <button
              onClick={handleLogin}
              disabled={loggingIn}
              className="w-full px-4 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors"
            >
              {loggingIn ? 'Signing In...' : 'Sign In'}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowPasswordReset(true);
                setResetEmail(loginEmail);
                setResetError(null);
                setResetSuccess(null);
              }}
              className="w-full text-sm text-blue-700 hover:text-blue-800 font-semibold"
            >
              Reset Password
            </button>
          </div>
        </div>

        {showPasswordReset && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Reset Password</h3>
                <p className="text-sm text-slate-500 mt-1">Enter your current password and set a new password.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Email Id</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Current Password</label>
                <input
                  type="password"
                  value={resetCurrentPassword}
                  onChange={(e) => setResetCurrentPassword(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">New Password</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Confirm New Password</label>
                <input
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {resetError && <p className="text-sm text-red-600">{resetError}</p>}
              {resetSuccess && <p className="text-sm text-emerald-600">{resetSuccess}</p>}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordReset(false);
                    setResetError(null);
                    setResetSuccess(null);
                  }}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSelfPasswordReset}
                  disabled={resettingPassword}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {resettingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} currentUser={currentUser} onLogout={handleLogout}>
      {activeTab === 'dashboard' && <Dashboard cycles={cycles} applications={applications} onLaunch={handleLaunchReview} reviewItems={reviewItems} users={users} sodPolicies={sodPolicies} isAdmin={currentUser.role === UserRole.ADMIN} onReassign={handleReassignReviewItem} onBulkReassign={handleBulkReassignReviewItems} />}
      {activeTab === 'my-access' && <MyAccess currentUserId={currentUser.id} applications={applications} sodPolicies={sodPolicies} />}
      {activeTab === 'inventory' && (
  <Inventory
    users={users}
    access={access}
    applications={applications}
    entitlements={entitlements}
    sodPolicies={sodPolicies}
    onSetUserRole={handleSetUserRole}
    onBulkSetUserRole={handleBulkSetUserRole}
    onResetUserPassword={handleResetUserPassword}
    onSelectApp={setSelectedAppId}         // <-- add this if Inventory can drive selection
    onDataImport={handleDataImport}
    onAddApp={app => { createApplication(app); }}
    onRemoveApp={id => { removeApplication(id); }}
    onUpdateEntitlement={async (ent) => {
      try {
        // Ensure ownerId is present as string for backend
        const payload: any = { ...ent };
        if (!payload.ownerId && payload.owner) payload.ownerId = String(payload.owner);
        console.debug('Saving entitlement payload:', payload);
        await importEntitlements(ent.appId, [payload]);
        const res = await getEntitlements(ent.appId, undefined, 200);
        setEntitlements(res.items || []);
      } catch (err) {
        console.error('Failed to save entitlement:', err);
        setEntitlements(p => p.map(e => (e.appId === ent.appId && e.entitlement === ent.entitlement ? ent : e)));
      }
    }}
    onUpdateSoD={handleUpdateSoD}
  />
)}
      {activeTab === 'reviews' && (
        <ManagerPortal 
          items={reviewItems.filter(i => {
            const cycle = cycles.find(c => c.id === i.reviewCycleId);
            return cycle?.status !== ReviewStatus.COMPLETED;
          })} 
          onAction={handleAction} onBulkAction={handleBulkAction} onReassign={handleReassignReviewItem} onBulkReassign={handleBulkReassignReviewItems} currentManagerId={currentUser.id} isAdmin={currentUser.role === UserRole.ADMIN} 
          applications={applications} sodPolicies={sodPolicies} users={users} access={access} cycles={cycles} onConfirmReview={handleConfirmReview}
        />
      )}
      {activeTab === 'governance' && <Governance cycles={cycles} reviewItems={reviewItems} applications={applications} access={access} onTabChange={setActiveTab} users={users} sodPolicies={sodPolicies} />}
      {activeTab === 'audit' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
              <div>
                <h3 className="text-xl font-bold text-slate-800">Security Audit Logs</h3>
                <p className="text-sm text-slate-500 mt-1">Monitor all administrative and review actions across the platform.</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={exportAuditLogs}
                  className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-all"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                  Export CSV
                </button>
                <button 
                  onClick={resetAuditFilters}
                  className="p-3 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100 transition-all border border-slate-200"
                  title="Reset Filters"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b border-slate-100 mb-6">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <UserIcon className="w-3 h-3" /> User (Name/ID)
                </label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={auditFilterUser}
                    onChange={e => setAuditFilterUser(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 outline-none transition-all pl-10"
                    placeholder="e.g. ADM001"
                  />
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
                </div>
              </div>
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Zap className="w-3 h-3" /> Action Type
                </label>
                <div className="relative">
                  <select 
                    value={auditFilterAction}
                    onChange={e => setAuditFilterAction(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 outline-none transition-all appearance-none pr-10"
                  >
                    <option value="ALL">All Actions</option>
                    {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <Filter className="w-3.5 h-3.5 absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> From Date
                </label>
                <input 
                  type="date" 
                  value={auditFilterDateFrom}
                  onChange={e => setAuditFilterDateFrom(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> To Date
                </label>
                <input 
                  type="date" 
                  value={auditFilterDateTo}
                  onChange={e => setAuditFilterDateTo(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500/10 outline-none transition-all"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-inner bg-slate-50/20">
              <table className="w-full text-left">
                <thead className="bg-slate-100/50 text-slate-500 text-[10px] uppercase font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4">Timestamp</th>
                    <th className="px-6 py-4">Identity</th>
                    <th className="px-6 py-4">Action</th>
                    <th className="px-6 py-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                           <Search className="w-8 h-8 opacity-20" />
                           <p className="font-medium italic">No logs found matching those filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredAuditLogs.map(log => (
                      <tr key={log.id} className="hover:bg-white transition-colors">
                        <td className="px-6 py-4 text-xs font-mono text-slate-400">
                          {new Date(log.timestamp).toLocaleDateString()}
                          <span className="block text-[10px] opacity-60">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800">{log.userName}</div>
                          <div className="text-[10px] text-slate-400 font-mono">ID: {log.userId}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-black uppercase border border-blue-100">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-slate-600 max-w-xl line-clamp-2" title={log.details}>{log.details}</p>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="mt-4 flex items-center justify-between px-2">
              <span className="text-xs text-slate-400 font-medium">Showing {filteredAuditLogs.length} of {auditLogs.length} total events</span>
              {filteredAuditLogs.length > 0 && (
                <div className="flex items-center gap-1">
                   <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                   <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Live Monitoring Active</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default App;