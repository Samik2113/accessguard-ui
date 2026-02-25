import React, { useState, useMemo, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import ManagerPortal from './components/ManagerPortal';
import Governance from './components/Governance';
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
  importSodPolicies
} from "./services/api";



const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState({ name: 'Admin User', id: 'ADM001', role: UserRole.ADMIN });
  
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

  // Audit Log Filter State
  const [auditFilterUser, setAuditFilterUser] = useState('');
  const [auditFilterAction, setAuditFilterAction] = useState('ALL');
  const [auditFilterDateFrom, setAuditFilterDateFrom] = useState('');
  const [auditFilterDateTo, setAuditFilterDateTo] = useState('');

  const activeManagers = useMemo(() => {
    const managerIds = new Set(reviewItems.filter(i => {
      const cycle = cycles.find(c => c.id === i.reviewCycleId);
      return cycle?.status !== ReviewStatus.COMPLETED;
    }).map(item => item.managerId));
    return users.filter(u => managerIds.has(u.id));
  }, [reviewItems, users, cycles]);

  const toggleRole = () => {
    if (currentUser.role === UserRole.ADMIN) {
      const firstManager = activeManagers.length > 0 ? activeManagers[0] : null;
      setCurrentUser({ 
        name: firstManager ? firstManager.name : 'No Managers Found', 
        id: firstManager ? firstManager.id : 'MGR_AUTO', 
        role: UserRole.MANAGER 
      });
      setActiveTab('reviews');
    } else {
      setCurrentUser({ name: 'Admin User', id: 'ADM001', role: UserRole.ADMIN });
      setActiveTab('dashboard');
    }
  };

  const handleSwitchManager = (managerId: string) => {
    const target = users.find(u => u.id === managerId);
    if (target) {
      setCurrentUser(prev => ({ ...prev, id: target.id, name: target.name }));
      addAuditLog('MANAGER_SWITCH', `Admin impersonated view for manager: ${target.name} (${target.id})`);
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
    setSelectedAppId(applications[0].appId);
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
      setAccess(res.items || []);
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

  const correlateAccount = (acc: any, identityList: User[]): Partial<ApplicationAccess> => {
    let match = identityList.find(u => u.id === acc.userId);
    if (!match && acc.email) {
      match = identityList.find(u => u.email.toLowerCase() === acc.email.toLowerCase());
    }
    return { 
      correlatedUserId: match?.id, 
      isOrphan: !match, 
      email: acc.email || match?.email 
    };
  };

  const recalculateSoD = (currentAccess: ApplicationAccess[], policies: SoDPolicy[]): ApplicationAccess[] => {
    const userAccessMap: Record<string, { appId: string, entitlement: string }[]> = {};
    currentAccess.forEach(acc => {
      if (!acc.correlatedUserId) return;
      if (!userAccessMap[acc.correlatedUserId]) userAccessMap[acc.correlatedUserId] = [];
      userAccessMap[acc.correlatedUserId].push({ appId: acc.appId, entitlement: acc.entitlement });
    });

    return currentAccess.map(acc => {
      if (!acc.correlatedUserId) return { ...acc, isSoDConflict: false, violatedPolicyNames: [], violatedPolicyIds: [] };
      const userItems = userAccessMap[acc.correlatedUserId] || [];
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
      const nextCycles = prevCycles.map(cycle => {
        if (cycle.status === ReviewStatus.COMPLETED) return cycle;
        const cycleItems = reviewItems.filter(i => i.reviewCycleId === cycle.id);
        if (cycleItems.length === 0) return cycle;
        const pendingReviewCount = cycleItems.filter(i => i.status === ActionStatus.PENDING).length;
        const activeRevokeCount = cycleItems.filter(i => i.status === ActionStatus.REVOKED).length;
        const managersInCycle = Array.from(new Set(cycleItems.map(i => i.managerId)));
        const allManagersConfirmed = managersInCycle.length > 0 && managersInCycle.every(mId => cycle.confirmedManagers.includes(mId));
        let nextStatus: ReviewStatus = cycle.status;
        let completedAt = cycle.completedAt;
        if (allManagersConfirmed && pendingReviewCount === 0) {
          if (activeRevokeCount > 0) {
            nextStatus = ReviewStatus.PENDING_VERIFICATION;
          } else {
            nextStatus = ReviewStatus.COMPLETED;
            completedAt = completedAt || new Date().toISOString();
          }
        } else if (cycle.status === ReviewStatus.PENDING_VERIFICATION && activeRevokeCount === 0) {
          nextStatus = ReviewStatus.COMPLETED;
          completedAt = completedAt || new Date().toISOString();
        }
        if (nextStatus !== cycle.status || cycle.pendingItems !== pendingReviewCount || cycle.completedAt !== completedAt) {
          hasGlobalChanges = true;
          return { ...cycle, status: nextStatus, pendingItems: pendingReviewCount, completedAt };
        }
        return cycle;
      });
      return hasGlobalChanges ? nextCycles : prevCycles;
    });
  }, [reviewItems, cycles.map(c => c.confirmedManagers.length).join(',')]);

  const handleConfirmReview = (cycleId: string, managerId: string) => {
    setCycles(prev => prev.map(c => {
      if (c.id === cycleId && !c.confirmedManagers.includes(managerId)) {
        return { ...c, confirmedManagers: [...c.confirmedManagers, managerId] };
      }
      return c;
    }));
    addAuditLog('MANAGER_CONFIRM', `Manager ${managerId} locked decisions for campaign: ${cycleId}.`);
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
	  
	  
    await importHrUsers(normalized, { replaceAll: true, debug: true });            // POST to /api/hr/import
      const res = await getHrUsers({ top: 200 }); // refresh
      setUsers(res.items ?? []);
      setAccess(prev => recalculateSoD(prev, sodPolicies));
      return;
    }


		
		
      // 1) Persist to Cosmos via Azure Function
      //await importHrUsers(data);
      // 2) Refresh from backend
     // const res = await getHrUsers({ top: 200 });
      //setUsers(res.items ?? []);
      // Recalculate SoD flags (accounts already in state)
     // setAccess(prev => recalculateSoD(prev, sodPolicies));
      // Optional: toast/log success here
    else if (type === 'APPLICATIONS') {
      await importApplications(data);
      const res = await getApplications(100);
      setApplications(res.items ?? []);
      // If needed, auto-select the first app again
      if (!selectedAppId && (res.items ?? []).length > 0) {
        setSelectedAppId(res.items[0].appId ?? res.items[0].id);
      }
    } else if (type === 'APP_ACCESS') {
      if (!appId) { alert("Missing appId for Accounts import"); return; }
      await importAccounts(appId, data);
      const res = await getAccounts(appId, undefined, undefined, 200);
      setAccess(res.items ?? []);
      setAccess(prev => recalculateSoD(prev, sodPolicies));
    } else if (type === 'APP_ENT') {
      if (!appId) { alert("Missing appId for Entitlements import"); return; }
      await importEntitlements(appId, data);
      const res = await getEntitlements(appId, undefined, 200);
      setEntitlements(res.items ?? []);
      // Optional: recalc SoD (privileged flags may change)
      setAccess(prev => recalculateSoD(prev, sodPolicies));
    } else if (type === 'APP_SOD') {
      await importSodPolicies(data);
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

  const handleLaunchReview = (appId: string, dueDateStr?: string) => {
    const targetApp = applications.find(a => a.id === appId);
    if (!targetApp) return;
    const existingActive = cycles.find(c => c.appId === appId && c.status !== ReviewStatus.COMPLETED);
    if (existingActive) { alert(`A campaign for ${targetApp.name} is already running.`); return; }
    const appAccess = access.filter(a => a.appId === appId);
    if (appAccess.length === 0) { alert(`No accounts found for ${targetApp.name}.`); return; }
    const now = new Date();
    const cycleId = `CYC_${appId}_${Date.now()}`;
    const dueDate = dueDateStr ? new Date(dueDateStr) : new Date();
    if (!dueDateStr) dueDate.setDate(dueDate.getDate() + 14);
    const dateStr = now.toLocaleDateString().replace(/\//g, '-');
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }).replace(/:/g, '-');
    const campaignName = `Manager Campaign - ${targetApp.name} - ${dateStr}-${timeStr}`;
    const newCycle: ReviewCycle = {
      id: cycleId, name: campaignName, appId, appName: targetApp.name,
      year: now.getFullYear(), quarter: Math.ceil((now.getMonth() + 1) / 3),
      status: ReviewStatus.ACTIVE, totalItems: appAccess.length, pendingItems: appAccess.length,
      launchedAt: now.toISOString(), dueDate: dueDate.toISOString(), confirmedManagers: []
    };
    const tasks: ReviewItem[] = appAccess.map((acc, idx) => {
      const identity = users.find(u => u.id === acc.correlatedUserId);
      const isPriv = entitlements.some(e => e.appId === acc.appId && e.entitlement === acc.entitlement && e.isPrivileged);
      return {
        id: `ITM${cycleId}-${idx}`, reviewCycleId: cycleId, accessId: acc.id, appUserId: acc.userId,
        managerId: acc.isOrphan ? targetApp.ownerId : (identity?.managerId || targetApp.ownerId),
        status: ActionStatus.PENDING, userName: acc.userName, appName: acc.appName, entitlement: acc.entitlement,
        isSoDConflict: acc.isSoDConflict, violatedPolicyNames: acc.violatedPolicyNames, violatedPolicyIds: acc.violatedPolicyIds,
        isOrphan: acc.isOrphan, isPrivileged: isPriv
      };
    });
    setCycles(prev => [newCycle, ...prev]);
    setReviewItems(prev => [...tasks, ...prev]);
    addAuditLog('CAMPAIGN_LAUNCH', `Launched ${newCycle.name} for ${targetApp.name}.`);
  };

  const handleAction = (itemId: string, status: ActionStatus, comment?: string) => {
    setReviewItems(prev => prev.map(i => i.id === itemId ? { ...i, status, comment, actionedAt: new Date().toISOString() } : i));
  };

  const handleBulkAction = (itemIds: string[], status: ActionStatus, comment?: string) => {
    setReviewItems(prev => prev.map(i => itemIds.includes(i.id) ? { ...i, status, comment, actionedAt: new Date().toISOString() } : i));
    addAuditLog('BULK_DECISION', `Bulk ${status} on ${itemIds.length} records.`);
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

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} currentUser={currentUser} toggleRole={toggleRole} availableManagers={activeManagers} onSwitchManager={handleSwitchManager}>
      {activeTab === 'dashboard' && <Dashboard cycles={cycles} applications={applications} onLaunch={handleLaunchReview} reviewItems={reviewItems} users={users} sodPolicies={sodPolicies} />}
      {activeTab === 'inventory' && (
  <Inventory
    users={users}
    access={access}
    applications={applications}
    entitlements={entitlements}
    sodPolicies={sodPolicies}
    onSelectApp={setSelectedAppId}         // <-- add this if Inventory can drive selection
    onDataImport={handleDataImport}
    onAddApp={app => setApplications(p => [...p, app])}
    onRemoveApp={id => setApplications(p => p.filter(a => a.id !== id))}
    onUpdateEntitlement={ent => setEntitlements(p => p.map(e => (e.appId === ent.appId && e.entitlement === ent.entitlement ? ent : e)))}
    onUpdateSoD={handleUpdateSoD}
  />
)}
      {activeTab === 'reviews' && (
        <ManagerPortal 
          items={reviewItems.filter(i => {
            const cycle = cycles.find(c => c.id === i.reviewCycleId);
            return cycle?.status !== ReviewStatus.COMPLETED;
          })} 
          onAction={handleAction} onBulkAction={handleBulkAction} currentManagerId={currentUser.id} isAdmin={currentUser.role === UserRole.ADMIN} 
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