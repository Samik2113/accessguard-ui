import React, { useState, useRef, useMemo, useEffect } from 'react';
import { getAccounts, getAccountsByUser } from '../services/api';
import { Upload, Database, FileText, CheckCircle2, AlertCircle, Download, FileSpreadsheet, Plus, Settings2, Link, Link2Off, Trash2, ShieldAlert, ListChecks, Users2, Eye, Shield, UserMinus, UserCheck, X, ShieldCheck, Zap, Edit2, Info, ArrowRight, ChevronRight, AlertTriangle } from 'lucide-react';
import { ApplicationAccess, User, Application, EntitlementDefinition, SoDPolicy } from '../types';
import { HR_TEMPLATE_HEADERS, APP_ACCESS_TEMPLATE_HEADERS, ENTITLEMENT_TEMPLATE_HEADERS, SOD_POLICY_TEMPLATE_HEADERS } from '../constants';

interface InventoryProps {
  users: User[];
  access: ApplicationAccess[];
  applications: Application[];
  entitlements: EntitlementDefinition[];
  sodPolicies: SoDPolicy[];
  onDataImport: (type: 'HR' | 'APPLICATIONS' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD', data: any[], appId?: string) => void;
  onAddApp: (app: Application) => void;
  onRemoveApp: (appId: string) => void;
  onUpdateEntitlement: (ent: EntitlementDefinition) => void;
  onUpdateSoD: (policies: SoDPolicy[]) => void;
  onSelectApp?: (appId: string) => void;
}

const Inventory: React.FC<InventoryProps> = ({ users, access, applications, entitlements, sodPolicies, onDataImport, onAddApp, onRemoveApp, onUpdateEntitlement, onUpdateSoD, onSelectApp }) => {
  const [activeSubTab, setActiveSubTab] = useState<'identities' | 'applications' | 'sod'>('identities');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [appManagementTab, setAppManagementTab] = useState<'accounts' | 'definitions'>('accounts');
  const [showAddApp, setShowAddApp] = useState(false);
  const [newApp, setNewApp] = useState({ name: '', ownerId: '', description: '' });
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [groupInApp, setGroupInApp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [userAllAccess, setUserAllAccess] = useState<ApplicationAccess[] | null>(null);
  
  // Editing state for Entitlements
  const [editingEnt, setEditingEnt] = useState<EntitlementDefinition | null>(null);

  // SoD Violation View - NOW USING POLICY ID
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);

  // New Global SoD state
  const [showAddSod, setShowAddSod] = useState(false);
  const [newSod, setNewSod] = useState<Partial<SoDPolicy>>({ riskLevel: 'HIGH' });
  const [sodError, setSodError] = useState<string | null>(null);

  const hrInputRef = useRef<HTMLInputElement>(null);
  const accountInputRef = useRef<HTMLInputElement>(null);
  const entInputRef = useRef<HTMLInputElement>(null);
  const sodInputRef = useRef<HTMLInputElement>(null);
  const appsInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = (type: 'HR' | 'APPLICATIONS' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD') => {
    let headers: string[] = [];
    let rows: any[] = [];

    if (type === 'HR') headers = HR_TEMPLATE_HEADERS;
	else if (type === 'APPLICATIONS') {
  // Minimal columns your import expects
  headers = ['appId', 'name', 'ownerId', 'description'];
  // (Optional) pre-fill existing apps to let admins "export" and re-import
  rows = applications.map(a => [a.id ?? a.appId, a.name, a.ownerId ?? '', a.description ?? '']);
}
    else if (type === 'APP_ACCESS') headers = APP_ACCESS_TEMPLATE_HEADERS;
    else if (type === 'APP_ENT') {
      headers = ENTITLEMENT_TEMPLATE_HEADERS;
      if (selectedAppId) {
        rows = entitlements.filter(e => e.appId === selectedAppId).map(e => [
          e.entitlement, e.description, e.owner, e.isPrivileged ? 'YES' : 'NO', e.risk, e.riskScore
        ]);
      }
    }
    else if (type === 'APP_SOD') {
      headers = SOD_POLICY_TEMPLATE_HEADERS;
      rows = sodPolicies.map(s => [s.policyName, s.appId1, s.entitlement1, s.appId2, s.entitlement2, s.riskLevel]);
    }

    const content = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type.toLowerCase()}_${selectedAppId || 'global'}_data.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'HR' | 'APPLICATIONS' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD', appId?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim() !== '');
      if (lines.length === 0) return;
      
      const headers = lines[0].split(',').map(h => h.trim());
      let expectedHeaders: string[] = [];
      if (type === 'HR') expectedHeaders = HR_TEMPLATE_HEADERS;
      else if (type === 'APP_ACCESS') expectedHeaders = APP_ACCESS_TEMPLATE_HEADERS;
      else if (type === 'APP_ENT') expectedHeaders = ENTITLEMENT_TEMPLATE_HEADERS;
      else if (type === 'APP_SOD') expectedHeaders = SOD_POLICY_TEMPLATE_HEADERS;

      const isValid = expectedHeaders.every(h => headers.includes(h));
      if (!isValid) {
        alert(`Invalid CSV headers. Expected: ${expectedHeaders.join(', ')}`);
        return;
      }

      const data = lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        const obj: any = {};
        headers.forEach((header, i) => {
          obj[header] = values[i];
        });

        // For app account uploads, ensure backend-required fields exist
        if (type === 'APP_ACCESS') {
          // Ensure appId comes from the selected app (don't rely on CSV)
          if (appId) obj.appId = appId;

          // Account ID should default to userId (or id/email) so CSV need not include it
          obj.accountId = obj.accountId || obj.userId || obj.id || obj.email || `ACC_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          // Make sure userId is present as well
          obj.userId = obj.userId || obj.accountId;
        }

        // For entitlement uploads, coerce common truthy/falsey values into actual boolean for isPrivileged
        if (type === 'APP_ENT') {
          const v = obj.isPrivileged;
          if (typeof v === 'boolean') {
            // already correct
          } else if (typeof v === 'string') {
            const s = v.trim().toLowerCase();
            if (s === 'true' || s === 'yes' || s === '1') obj.isPrivileged = true;
            else if (s === 'false' || s === 'no' || s === '0' || s === '') obj.isPrivileged = false;
            else {
              // unknown value, leave as-is (backend validation may reject)
              obj.isPrivileged = s === 'true';
            }
          } else if (typeof v === 'number') {
            obj.isPrivileged = v === 1;
          } else {
            obj.isPrivileged = false;
          }
          // Normalize owner: prefer storing user ID if owner matches a known user (by id or name)
          // Support both 'owner' and 'ownerId' columns in CSV. Prefer ownerId when present.
          if (obj.ownerId && !obj.owner) {
            // ownerId provided directly
            const ownerMatch = users.find(u => u.id === String(obj.ownerId));
            if (ownerMatch) {
              obj.ownerId = ownerMatch.id;
              obj.owner = ownerMatch.name;
            } else {
              obj.ownerId = String(obj.ownerId);
            }
          } else if (obj.owner) {
            const ownerMatch = users.find(u => u.id === obj.owner || u.name === obj.owner);
            if (ownerMatch) {
              obj.ownerId = ownerMatch.id;
              obj.owner = ownerMatch.name;
            } else {
              obj.ownerId = String(obj.owner);
            }
          }

          // Auto-calc risk and riskScore based on isPrivileged
          if (obj.isPrivileged) {
            obj.risk = 'HIGH';
            obj.riskScore = '10';
          } else {
            // Preserve provided risk if present, otherwise default to LOW/1
            obj.risk = obj.risk || 'LOW';
            obj.riskScore = obj.riskScore || '1';
          }
        }

        return obj;
      });

      onDataImport(type, data, appId);
      if (e.target) e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleAddApp = () => {
    if (!newApp.name || !newApp.ownerId) {
      window.alert("Please fill in Application Name and select an Owner.");
      return;
    }
    const appId = `APP_${Date.now()}`;
    onAddApp({ ...newApp, id: appId, appId });
    setNewApp({ name: '', ownerId: '', description: '' });
    setShowAddApp(false);
  };

  const normalizeEntOwnerForEdit = (ent: EntitlementDefinition) => {
    let ownerId = (ent as any).ownerId || ent.owner;
    let ownerName = ent.owner;
    if (ownerId) {
      const match = users.find(u => u.id === ownerId || u.name === ownerId || u.name === ownerName);
      if (match) {
        ownerId = match.id;
        ownerName = match.name;
      }
    }
    return { ...ent, owner: ownerName, ownerId } as EntitlementDefinition;
  };

  const handleAddGlobalSod = () => {
  setSodError(null);
    if (!newSod.policyName || !newSod.appId1 || !newSod.entitlement1 || !newSod.appId2 || !newSod.entitlement2) {
      window.alert("Please complete all SoD policy fields.");
      return;
    }

    // UNIQUE CHECK
    const isDuplicateName = sodPolicies.some(p => p.policyName.toLowerCase() === newSod.policyName?.toLowerCase());
    if (isDuplicateName) {
      window.alert("Policy with the same name already exist");
      return;
    }

    const policy: SoDPolicy = {
      id: `SOD_${Date.now()}`,
      policyName: newSod.policyName!,
      appId1: newSod.appId1!,
      entitlement1: newSod.entitlement1!,
      appId2: newSod.appId2!,
      entitlement2: newSod.entitlement2!,
      riskLevel: newSod.riskLevel as 'HIGH' | 'MEDIUM' | 'LOW'
    };
    onUpdateSoD([...sodPolicies, policy]);
    setShowAddSod(false);
    setNewSod({ riskLevel: 'HIGH' });
  };

  const isPrivilegedEntitlement = (appId: string, entitlement: string) => {
    return entitlements.some(e => e.appId === appId && e.entitlement === entitlement && e.isPrivileged);
  };

  const getRiskDisplay = (acc: ApplicationAccess | { entitlements: ApplicationAccess[], isOrphan: boolean }) => {
    let hasSod = false;
    let policies: { name: string, id: string }[] = [];
    let isOrphan = false;
    let hasPrivileged = false;

    if ('entitlements' in acc) {
      hasSod = acc.entitlements.some(e => e.isSoDConflict);
      const uniquePolicyIds = Array.from(new Set(acc.entitlements.flatMap(e => e.violatedPolicyIds || [])));
      policies = uniquePolicyIds.map(id => ({ 
        id, 
        name: sodPolicies.find(p => p.id === id)?.policyName || 'Unknown Policy' 
      }));
      isOrphan = acc.isOrphan;
      hasPrivileged = acc.entitlements.some(e => isPrivilegedEntitlement(e.appId, e.entitlement));
    } else {
      hasSod = acc.isSoDConflict;
      policies = (acc.violatedPolicyIds || []).map(id => ({ 
        id, 
        name: sodPolicies.find(p => p.id === id)?.policyName || 'Unknown Policy' 
      }));
      isOrphan = acc.isOrphan;
      hasPrivileged = isPrivilegedEntitlement(acc.appId, acc.entitlement);
    }

    // Classification Level
    let level: 'CLEAR' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'CLEAR';
    if (hasSod) level = 'CRITICAL';
    else if (isOrphan) level = 'HIGH';
    else if (hasPrivileged) level = 'MEDIUM';

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
            level === 'CRITICAL' ? 'bg-red-600 text-white' :
            level === 'HIGH' ? 'bg-orange-500 text-orange-950' :
            level === 'MEDIUM' ? 'bg-indigo-500 text-white' :
            'bg-emerald-500 text-white'
          }`}>
            {level === 'CLEAR' ? 'LOW RISK' : `${level} RISK`}
          </span>
        </div>
        
        <div className="space-y-1">
          {hasSod && (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1 text-red-600 font-bold uppercase text-[8px]">
                <Shield className="w-2.5 h-2.5" /> SOD CONFLICT
              </div>
              {policies.map(p => (
                <button 
                  key={p.id} 
                  onClick={() => setViewingPolicyId(p.id)}
                  className="text-[8px] text-blue-500 font-bold leading-tight uppercase hover:underline text-left block"
                >
                  Policy: {p.name}
                </button>
              ))}
            </div>
          )}
          {isOrphan && (
            <div className="flex items-center gap-1 text-orange-600 font-bold uppercase text-[8px]">
              <AlertCircle className="w-2.5 h-2.5" /> ORPHAN ACCOUNT
            </div>
          )}
          {hasPrivileged && (
            <div className="flex items-center gap-1 text-indigo-600 font-bold uppercase text-[8px]">
              <ShieldCheck className="w-2.5 h-2.5" /> PRIVILEGED ACCESS
            </div>
          )}
        </div>
      </div>
    );
  };

  const selectedAppData = access.filter(a => a.appId === selectedAppId);
  const selectedEntitlements = entitlements.filter(e => e.appId === selectedAppId);

  const groupedSelectedAppData = useMemo(() => {
    if (!groupInApp) return null;
    const groups: Record<string, { userId: string, userName: string, entitlements: ApplicationAccess[], isOrphan: boolean }> = {};
    selectedAppData.forEach(acc => {
      const key = acc.correlatedUserId || acc.userId;
      if (!groups[key]) groups[key] = { userId: acc.userId, userName: acc.userName, entitlements: [], isOrphan: acc.isOrphan };
      groups[key].entitlements.push(acc);
    });
    return Object.values(groups);
  }, [selectedAppData, groupInApp]);

  const userGlobalAccess = useMemo(() => {
    if (!viewingUserId) return [];
    // Only show userAllAccess once it has been fetched (not null)
    if (userAllAccess !== null) {
      return userAllAccess.filter(a => a.correlatedUserId === viewingUserId);
    }
    // While fetching, show empty (don't fall back to selectedAppId-filtered access)
    return [];
  }, [userAllAccess, viewingUserId]);

  // When a user drill-down is opened, fetch all accounts for that user across apps
  useEffect(() => {
    let alive = true;
    if (!viewingUserId) {
      setUserAllAccess([]);
      return;
    }

    (async () => {
      try {
        // Try server-side user-scoped endpoint first (more efficient)
        try {
          const res = await getAccountsByUser(viewingUserId!, 1000);
          if (res && res.items) {
            if (!alive) return;
            const items: ApplicationAccess[] = (res.items || []).map((acc: any) => {
              const email = (acc.email || acc.userEmail || acc.accountEmail || '').toLowerCase();
              let match = users.find(u => u.email && u.email.toLowerCase() === email);
              if (!match) match = users.find(u => u.id === acc.userId || u.id === acc.accountId || u.id === acc.employeeId || u.id === acc.id);
              return {
                ...acc,
                correlatedUserId: match?.id,
                isOrphan: !match,
                userName: match?.name || acc.userName || acc.name || '',
                email: acc.email || match?.email || ''
              } as ApplicationAccess;
            });
            // Recalculate SoD for the fetched items
            const userAccessMap: Record<string, { appId: string; entitlement: string }[]> = {};
            items.forEach(acc => {
              if (!acc.correlatedUserId) return;
              if (!userAccessMap[acc.correlatedUserId]) userAccessMap[acc.correlatedUserId] = [];
              userAccessMap[acc.correlatedUserId].push({ appId: acc.appId, entitlement: acc.entitlement });
            });
            const final = items.map(acc => {
              if (!acc.correlatedUserId) return { ...acc, isSoDConflict: false, violatedPolicyIds: [], violatedPolicyNames: [] } as ApplicationAccess;
              const userItems = userAccessMap[acc.correlatedUserId] || [];
              const violatedPolicies = sodPolicies.filter(policy => {
                const has1 = userItems.some(i => i.appId === policy.appId1 && i.entitlement.trim().toLowerCase() === policy.entitlement1.trim().toLowerCase());
                const has2 = userItems.some(i => i.appId === policy.appId2 && i.entitlement.trim().toLowerCase() === policy.entitlement2.trim().toLowerCase());
                if (has1 && has2) {
                  return (acc.appId === policy.appId1 && acc.entitlement.trim().toLowerCase() === policy.entitlement1.trim().toLowerCase()) ||
                         (acc.appId === policy.appId2 && acc.entitlement.trim().toLowerCase() === policy.entitlement2.trim().toLowerCase());
                }
                return false;
              });
              return { ...acc, isSoDConflict: violatedPolicies.length > 0, violatedPolicyIds: violatedPolicies.map(p => p.id), violatedPolicyNames: violatedPolicies.map(p => p.policyName) } as ApplicationAccess;
            });
            setUserAllAccess(final);
            return;
          }
        } catch (e) {
          // If server endpoint not available or returns an error, fall back to per-app aggregation
          console.debug('getAccountsByUser failed, falling back to per-app aggregation.', e?.message || e);
        }

        // Fallback: fetch accounts per application in batches to avoid huge parallel load
        const batchSize = 20;
        const batches: string[][] = [];
        for (let i = 0; i < applications.length; i += batchSize) batches.push(applications.slice(i, i + batchSize).map(a => a.id));
        const rawItems: any[] = [];
        for (const batch of batches) {
          const fetches = batch.map(appId => getAccounts(appId, viewingUserId, undefined, 200).catch(() => ({ items: [] })));
          // await each batch to limit concurrency
          // eslint-disable-next-line no-await-in-loop
          const results = await Promise.all(fetches);
          if (!alive) return;
          results.forEach(r => { rawItems.push(...(r.items || [])); });
        }
        const items: ApplicationAccess[] = rawItems.map((acc: any) => {
          const email = (acc.email || acc.userEmail || acc.accountEmail || '').toLowerCase();
          let match = users.find(u => u.email && u.email.toLowerCase() === email);
          if (!match) match = users.find(u => u.id === acc.userId || u.id === acc.accountId || u.id === acc.employeeId || u.id === acc.id);
          return {
            ...acc,
            correlatedUserId: match?.id,
            isOrphan: !match,
            userName: match?.name || acc.userName || acc.name || '',
            email: acc.email || match?.email || ''
          } as ApplicationAccess;
        });

        // Recalculate SoD locally for the fetched user access
        const userAccessMap: Record<string, { appId: string; entitlement: string }[]> = {};
        items.forEach(acc => {
          if (!acc.correlatedUserId) return;
          if (!userAccessMap[acc.correlatedUserId]) userAccessMap[acc.correlatedUserId] = [];
          userAccessMap[acc.correlatedUserId].push({ appId: acc.appId, entitlement: acc.entitlement });
        });

        const final = items.map(acc => {
          if (!acc.correlatedUserId) return { ...acc, isSoDConflict: false, violatedPolicyIds: [], violatedPolicyNames: [] } as ApplicationAccess;
          const userItems = userAccessMap[acc.correlatedUserId] || [];
          const violatedPolicies = sodPolicies.filter(policy => {
            const has1 = userItems.some(i => i.appId === policy.appId1 && i.entitlement.trim().toLowerCase() === policy.entitlement1.trim().toLowerCase());
            const has2 = userItems.some(i => i.appId === policy.appId2 && i.entitlement.trim().toLowerCase() === policy.entitlement2.trim().toLowerCase());
            if (has1 && has2) {
              return (acc.appId === policy.appId1 && acc.entitlement.trim().toLowerCase() === policy.entitlement1.trim().toLowerCase()) ||
                     (acc.appId === policy.appId2 && acc.entitlement.trim().toLowerCase() === policy.entitlement2.trim().toLowerCase());
            }
            return false;
          });
          return { ...acc, isSoDConflict: violatedPolicies.length > 0, violatedPolicyIds: violatedPolicies.map(p => p.id), violatedPolicyNames: violatedPolicies.map(p => p.policyName) } as ApplicationAccess;
        });

        setUserAllAccess(final);
      } catch (e) {
        console.error('Failed to load user access:', e);
        if (alive) setUserAllAccess([]);
      }
    })();

    return () => { alive = false; };
  }, [viewingUserId, users, sodPolicies]);

  const viewingUser = users.find(u => u.id === viewingUserId);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveSubTab('identities')}
          className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeSubTab === 'identities' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Identity Inventory (HR)
        </button>
        <button
          onClick={() => setActiveSubTab('applications')}
          className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeSubTab === 'applications' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          App Configurations
        </button>
        <button
          onClick={() => setActiveSubTab('sod')}
          className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeSubTab === 'sod' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Global SoD Policies
        </button>
      </div>

      {activeSubTab === 'identities' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-indigo-100 p-3 rounded-xl">
                <Database className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-lg">Identity Source of Truth</h3>
                <p className="text-sm text-slate-500">Manage correlated users from HR data.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => downloadTemplate('HR')} className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                <Download className="w-4 h-4" /> Template
              </button>
              <input type="file" ref={hrInputRef} className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, 'HR')} />
              <button onClick={() => hrInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800">
                <Upload className="w-4 h-4" /> Upload HR Data
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto min-h-[300px]">
              {users.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <Users2 className="w-12 h-12 mb-4 opacity-20" />
                  <p>No identities found.</p>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider font-bold border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Employee ID</th>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Department</th>
                      <th className="px-6 py-3">Reporting Manager</th>
                      <th className="px-6 py-3">Access Summary</th>
                      <th className="px-6 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {users.map((u) => {
                      const userAccess = access.filter(a => a.correlatedUserId === u.id);
                      const userViolations = Array.from(new Set(userAccess.flatMap(a => a.violatedPolicyIds || [])));
                      const hasSod = userAccess.some(a => a.isSoDConflict);
                      const manager = users.find(m => m.id === u.managerId);
                      return (
                        <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-mono font-medium text-slate-600">{u.id}</td>
                          <td className="px-6 py-4">
                            <div className="font-bold text-slate-800">{u.name}</div>
                            <div className="text-[10px] text-slate-400">{u.email}</div>
                          </td>
                          <td className="px-6 py-4 text-slate-600 font-medium">{u.department}</td>
                          <td className="px-6 py-4">
                            <div className="text-slate-700 font-semibold">{manager?.name || 'N/A'}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{u.managerId || '-'}</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${userAccess.length > 0 ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-400'}`}>
                                  {userAccess.length} Items
                                </span>
                                {hasSod && (
                                  <button 
                                    onClick={() => setViewingUserId(u.id)}
                                    className="flex items-center gap-1 text-red-600 bg-red-50 px-2 py-0.5 rounded text-[10px] font-black border border-red-100 hover:bg-red-100 transition-colors"
                                  >
                                    <ShieldAlert className="w-3 h-3" /> SOD ({userViolations.length})
                                  </button>
                                )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button onClick={() => setViewingUserId(u.id)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1.5 ml-auto font-bold text-xs">
                              <Eye className="w-3.5 h-3.5" /> Drill Down
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'sod' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-red-100 p-3 rounded-xl">
                <ShieldAlert className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-lg">Inter-App SoD Policies</h3>
                <p className="text-sm text-slate-500">Define conflicting roles within or across multiple applications.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => downloadTemplate('APP_SOD')} className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                <Download className="w-4 h-4" /> Export Data
              </button>
              <input type="file" ref={sodInputRef} className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, 'APP_SOD')} />
              <button onClick={() => sodInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-sm font-medium hover:bg-slate-200">
                <Upload className="w-4 h-4" /> Bulk Upload
              </button>
              <button onClick={() => setShowAddSod(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                <Plus className="w-4 h-4" /> New Policy
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b">
                <tr>
                  <th className="px-6 py-4">Policy ID / Name</th>
                  <th className="px-6 py-4">Condition 1 (App: Role)</th>
                  <th className="px-6 py-4">Condition 2 (App: Role)</th>
                  <th className="px-6 py-4">Risk Level</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sodPolicies.length === 0 ? (
                  <tr><td colSpan={5} className="p-20 text-center text-slate-400">No SoD policies defined yet.</td></tr>
                ) : (
                  sodPolicies.map(p => {
                    const app1 = applications.find(a => a.id === p.appId1)?.name || p.appId1;
                    const app2 = applications.find(a => a.id === p.appId2)?.name || p.appId2;
                    return (
                      <tr key={p.id}>
                        <td className="px-6 py-4">
                           <div className="font-bold text-slate-800">{p.policyName}</div>
                           <div className="text-[9px] text-slate-400 font-mono">ID: {p.id}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-slate-400 text-xs font-medium mr-2">{app1}:</span>
                          <code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{p.entitlement1}</code>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-slate-400 text-xs font-medium mr-2">{app2}:</span>
                          <code className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">{p.entitlement2}</code>
                        </td>
                        <td className="px-6 py-4">
                           <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                             p.riskLevel === 'HIGH' ? 'bg-red-50 text-red-600' :
                             p.riskLevel === 'MEDIUM' ? 'bg-orange-50 text-orange-950' :
                             'bg-blue-50 text-blue-600'
                           }`}>{p.riskLevel}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => onUpdateSoD(sodPolicies.filter(x => x.id !== p.id))} className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'applications' && (
	    
	  
	  
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
		{/* Applications bulk import/export */}
<div className="space-y-2">
  <button
    onClick={() => downloadTemplate('APPLICATIONS')}
    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-all font-semibold text-sm"
  >
    <Download className="w-4 h-4" />
    Export / Template (Applications)
  </button>

  <input
    type="file"
    ref={appsInputRef}
    className="hidden"
    accept=".csv"
    onChange={(e) => handleFileUpload(e, 'APPLICATIONS')}
  />

  <button
    onClick={() => appsInputRef.current?.click()}
    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all font-semibold text-sm"
  >
    <Upload className="w-4 h-4" />
    Bulk Upload Applications
  </button>
</div>
          <div className="lg:col-span-1 space-y-4">
		  <button onClick={() => setShowAddApp(true)} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border-2 border-dashed border-slate-200 text-slate-500 rounded-xl hover:border-blue-300 hover:text-blue-600 transition-all font-semibold text-sm">
              <Plus className="w-4 h-4" /> Add Application
            </button>
            <div className="space-y-2">
              {applications.map(app => (
                <button key={app.id} onClick={() => {
				setSelectedAppId(app.id);
				onSelectApp?.(app.id);
				}
				} className={`w-full text-left p-4 rounded-xl border transition-all ${selectedAppId === app.id ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-slate-200 hover:border-blue-300'}`}>
                  <div className="font-bold flex justify-between items-center">
                    <span>{app.name}</span>
                    {selectedAppId === app.id && <Settings2 className="w-3.5 h-3.5" />}
                  </div>
                  <div className={`text-[11px] mt-1 ${selectedAppId === app.id ? 'text-blue-100' : 'text-slate-400'}`}>Owner: {users.find(u => u.id === app.ownerId)?.name || 'Unknown'}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3">
            {selectedAppId ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{applications.find(a => a.id === selectedAppId)?.name}</h3>
                    <p className="text-sm text-slate-500">Manage accounts, definitions, and SoD rules.</p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setShowDeleteConfirm(selectedAppId)} 
                      className="flex items-center gap-2 px-3 py-1.5 text-red-600 hover:bg-red-50 rounded-lg text-xs font-bold border border-transparent hover:border-red-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" /> Delete Application
                    </button>
                    <button onClick={() => {setSelectedAppId(null);
					onSelectApp?.("");
					}} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex border-b border-slate-100 mb-6">
                  <button onClick={() => setAppManagementTab('accounts')} className={`px-4 py-2 text-xs font-bold transition-all border-b-2 ${appManagementTab === 'accounts' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>Accounts ({selectedAppData.length})</button>
                  <button onClick={() => setAppManagementTab('definitions')} className={`px-4 py-2 text-xs font-bold transition-all border-b-2 ${appManagementTab === 'definitions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>Catalog / Definitions ({selectedEntitlements.length})</button>
                </div>

                {appManagementTab === 'accounts' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <button onClick={() => downloadTemplate('APP_ACCESS')} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Template</button>
                        <input type="file" ref={accountInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'APP_ACCESS', selectedAppId)} />
                        <button onClick={() => accountInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800"><Upload className="w-3.5 h-3.5" /> Upload Accounts</button>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={groupInApp} onChange={e => setGroupInApp(e.target.checked)} className="rounded text-blue-600" />
                          <span className="text-xs font-bold text-slate-600">Group by Identity</span>
                        </label>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl border overflow-hidden max-h-[600px] overflow-y-auto shadow-inner">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-slate-100 z-10">
                          <tr className="text-slate-400 uppercase font-bold border-b">
                            <th className="px-4 py-3">Identity / Account</th>
                            <th className="px-4 py-3">Correlation</th>
                            <th className="px-4 py-3">Entitlement(s)</th>
                            <th className="px-4 py-3">Risk Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {groupInApp ? (
                            groupedSelectedAppData?.map(group => {
                              const hasPrivileged = group.entitlements.some(e => isPrivilegedEntitlement(e.appId, e.entitlement));
                              
                              return (
                                <tr key={group.userId} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="font-bold text-slate-800 flex items-center gap-2">
                                      {group.userName}
                                      {hasPrivileged && (
                                        <span title="Privileged Account">
                                          <ShieldCheck className="w-3 h-3 text-indigo-500 fill-current" />
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-slate-400 font-mono text-[10px]">{group.userId}</div>
                                  </td>
                                  <td className="px-4 py-3">
                                    {group.isOrphan ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100 font-bold">
                                        <UserMinus className="w-3 h-3" /> Orphan
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 font-bold">
                                        <UserCheck className="w-3 h-3" /> Correlated
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex flex-wrap gap-1">
                                      {group.entitlements.map(e => (
                                        <code key={e.id} className={`px-1 rounded border ${e.isSoDConflict ? 'bg-red-50 text-red-700 border-red-100 font-bold' : isPrivilegedEntitlement(e.appId, e.entitlement) ? 'bg-indigo-50 text-indigo-700 border-indigo-100 font-bold' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>{e.entitlement}</code>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    {getRiskDisplay(group)}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            selectedAppData.map(acc => {
                              const isPriv = isPrivilegedEntitlement(acc.appId, acc.entitlement);
                              return (
                                <tr key={acc.id} className="hover:bg-slate-50 transition-colors">
                                  <td className="px-4 py-3">
                                    <div className="font-bold text-slate-800 flex items-center gap-2">
                                      {acc.userName}
                                      {isPriv && (
                                        <span title="Privileged Account">
                                          <ShieldCheck className="w-3 h-3 text-indigo-500 fill-current" />
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-slate-400 font-mono text-[10px]">{acc.userId}</div>
                                  </td>
                                  <td className="px-4 py-3">
                                    {acc.isOrphan ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100 font-bold">
                                        <UserMinus className="w-3 h-3" /> Orphan
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100 font-bold">
                                        <UserCheck className="w-3 h-3" /> Correlated
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <code className={`px-1.5 py-0.5 rounded border ${acc.isSoDConflict ? 'bg-red-50 text-red-700 border-red-100 font-bold' : isPriv ? 'bg-indigo-50 text-indigo-700 border-indigo-100 font-bold' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>{acc.entitlement}</code>
                                  </td>
                                  <td className="px-4 py-3">
                                    {getRiskDisplay(acc)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {appManagementTab === 'definitions' && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div className="flex gap-2">
                        <button onClick={() => downloadTemplate('APP_ENT')} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Export Data</button>
                        <input type="file" ref={entInputRef} className="hidden" onChange={(e) => handleFileUpload(e, 'APP_ENT', selectedAppId)} />
                        <button onClick={() => entInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800"><Upload className="w-3.5 h-3.5" /> Bulk Update</button>
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic flex items-center gap-1.5"><Info className="w-3 h-3" /> You can edit definitions inline via the Edit button</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl border overflow-hidden max-h-[500px] overflow-y-auto shadow-inner">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-slate-100 z-10">
                          <tr className="text-slate-400 uppercase font-bold border-b">
                            <th className="px-4 py-3">Entitlement</th>
                            <th className="px-4 py-3">Risk Level</th>
                            <th className="px-4 py-3">Privileged?</th>
                            <th className="px-4 py-3">Owner</th>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {selectedEntitlements.length === 0 ? (
                            <tr><td colSpan={6} className="py-20 text-center opacity-50">No catalog data. Upload accounts to auto-generate.</td></tr>
                          ) : (
                            selectedEntitlements.map(ent => (
                              <tr key={ent.entitlement} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-bold">{ent.entitlement}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded font-black ${
                                    ent.risk === 'HIGH' ? 'bg-red-50 text-red-600' : 
                                    ent.risk === 'MEDIUM' ? 'bg-orange-50 text-orange-950' : 
                                    'bg-blue-50 text-blue-600'
                                  }`}>{ent.risk || 'LOW'} (Score: {ent.riskScore})</span>
                                </td>
                                <td className="px-4 py-3">
                                  {ent.isPrivileged ? (
                                    <span className="flex items-center gap-1 text-red-600 font-bold"><ShieldCheck className="w-3 h-3" /> YES</span>
                                  ) : (
                                    <span className="text-slate-400">NO</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-slate-600">{users.find(u => u.id === (ent as any).ownerId || u.id === ent.owner)?.name || ent.owner || '-'}</td>
                                <td className="px-4 py-3 text-slate-500 italic max-w-xs truncate">{ent.description || 'No description provided.'}</td>
                                <td className="px-4 py-3 text-right">
                                  <button onClick={() => setEditingEnt(normalizeEntOwnerForEdit(ent))} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-40 bg-white border border-dashed rounded-2xl text-slate-400 shadow-sm"><Settings2 className="w-16 h-16 mb-4 opacity-10" /><p className="font-medium">Select an application from the sidebar to manage its data.</p></div>
            )}
          </div>
        </div>
      )}

      {/* MODALS */}

      {/* Delete Application Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95">
            <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mb-6 mx-auto">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-center text-slate-900 mb-2">Delete Application?</h3>
            <p className="text-sm text-center text-slate-500 mb-8 leading-relaxed">
                This action is <b>permanent</b>. It will delete this application, all associated accounts, and <b>all associated catalog definitions</b>. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button 
                onClick={() => {
                  onRemoveApp(showDeleteConfirm);
                  setSelectedAppId(null);
                  setShowDeleteConfirm(null);
                }} 
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold shadow-lg shadow-red-500/20 hover:bg-red-700"
              >
                Yes, Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Policy Details Modal */}
      {viewingPolicyId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Policy Violation Details</h3>
              <button onClick={() => setViewingPolicyId(null)} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-5 h-5" /></button>
            </div>
            {(() => {
              const policy = sodPolicies.find(p => p.id === viewingPolicyId);
              if (!policy) return <p className="text-slate-500">Policy details not found.</p>;
              return (
                <div className="space-y-6">
                  <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-red-900 text-sm">{policy.policyName}</h4>
                      <p className="text-xs text-red-700 mt-1">This policy prevents users from possessing both roles due to excessive administrative or financial risk.</p>
                      <p className="text-[9px] text-slate-400 mt-1 font-mono">Policy ID: {policy.id}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                     <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Conflicting Entitlement 1</p>
                        <p className="text-sm font-bold text-slate-800">{policy.entitlement1}</p>
                        <p className="text-[10px] text-slate-500 font-medium">Application: {applications.find(a => a.id === policy.appId1)?.name}</p>
                     </div>
                     <div className="flex justify-center"><ChevronRight className="w-5 h-5 text-slate-300 rotate-90" /></div>
                     <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Conflicting Entitlement 2</p>
                        <p className="text-sm font-bold text-slate-800">{policy.entitlement2}</p>
                        <p className="text-[10px] text-slate-500 font-medium">Application: {applications.find(a => a.id === policy.appId2)?.name}</p>
                     </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className="text-xs font-bold text-slate-400 uppercase">Policy Risk Impact</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                        policy.riskLevel === 'HIGH' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-950'
                    }`}>{policy.riskLevel}</span>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => setViewingPolicyId(null)} className="w-full mt-8 py-3 bg-slate-900 text-white rounded-xl font-bold">Close Detail</button>
          </div>
        </div>
      )}

      {/* Global Identity Access Drill-Down Modal */}
      {viewingUserId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[85vh] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg"><Users2 className="w-6 h-6" /></div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{viewingUser?.name}</h3>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{viewingUser?.department} • ID: {viewingUser?.id}</p>
                </div>
              </div>
              <button onClick={() => setViewingUserId(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto bg-slate-50/30">
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4 mb-2">
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Apps with Access</p>
                        <p className="text-2xl font-black text-slate-800">{Array.from(new Set(userGlobalAccess.map(a => a.appId))).length}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Entitlements</p>
                        <p className="text-2xl font-black text-slate-800">{userGlobalAccess.length}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active SoD Violations</p>
                        <p className="text-2xl font-black text-red-600">{userGlobalAccess.filter(a => a.isSoDConflict).length}</p>
                    </div>
                </div>

                {applications.map(app => {
                  const appAccess = userGlobalAccess.filter(a => a.appId === app.id);
                  if (appAccess.length === 0) return null;
                  const hasPrivilegedApp = appAccess.some(acc => isPrivilegedEntitlement(acc.appId, acc.entitlement));
                  
                  return (
                    <div key={app.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <div className="bg-slate-50 px-4 py-3 border-b flex justify-between items-center">
                        <div className="flex items-center gap-2">
                           <Shield className="w-4 h-4 text-blue-600" />
                           <span className="font-bold text-slate-700">{app.name}</span>
                           {hasPrivilegedApp && (
                             <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[9px] font-black uppercase border border-indigo-100">
                               <ShieldCheck className="w-2.5 h-2.5" /> Privileged Account
                             </span>
                           )}
                        </div>
                        <span className="text-[10px] bg-white border px-2 py-0.5 rounded font-bold text-slate-500">{appAccess.length} items</span>
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50/50 text-[10px] text-slate-400 uppercase font-bold border-b">
                          <tr>
                            <th className="px-4 py-2">Account ID</th>
                            <th className="px-4 py-2">Entitlement</th>
                            <th className="px-4 py-2 text-right">Risk & SoD Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {appAccess.map(acc => {
                            const isPriv = isPrivilegedEntitlement(acc.appId, acc.entitlement);
                            return (
                              <tr key={acc.id} className="hover:bg-slate-50/50">
                                <td className="px-4 py-2 font-mono text-slate-400">{acc.userId}</td>
                                <td className="px-4 py-2 flex items-center gap-2">
                                  <span className="font-medium text-slate-700">{acc.entitlement}</span>
                                  {isPriv && (
                                    <span title="Privileged Entitlement">
                                      <ShieldCheck className="w-3 h-3 text-indigo-500 fill-current" />
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <div className="flex flex-col items-end gap-1">
                                    {acc.isSoDConflict ? (
                                      <>
                                        <div className="flex flex-wrap justify-end gap-1">
                                          {acc.violatedPolicyIds?.map((pid, idx) => (
                                            <button 
                                              key={pid}
                                              onClick={() => setViewingPolicyId(pid)}
                                              className="inline-flex items-center gap-1 text-red-600 font-black uppercase text-[10px] bg-red-50 px-2 py-0.5 rounded border border-red-100 hover:bg-red-100"
                                            >
                                              <ShieldAlert className="w-3 h-3" /> Conflict: {acc.violatedPolicyNames?.[idx] || 'SoD'}
                                            </button>
                                          ))}
                                        </div>
                                        <span className="text-[8px] text-slate-400 font-bold uppercase">Risk against this account</span>
                                      </>
                                    ) : (
                                      <span className="text-slate-400">Low Risk</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Application Modal */}
      {showAddApp && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold mb-6 text-slate-900">Configure New Application</h3>
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Application Name</label>
                <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" placeholder="e.g. SAP Finance, AWS Prod" value={newApp.name} onChange={e => setNewApp({...newApp, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Business Owner</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={newApp.ownerId} onChange={e => setNewApp({...newApp, ownerId: e.target.value})}>
                  <option value="">Select Identity...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowAddApp(false)} className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleAddApp} className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-700">Add App</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Entitlement Modal */}
      {editingEnt && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Edit Entitlement: <code className="text-blue-600 ml-2">{editingEnt.entitlement}</code></h3>
              <button onClick={() => setEditingEnt(null)} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-5 h-5" /></button>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <div className="col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Description</label>
                <textarea className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/10 outline-none" rows={3} value={editingEnt.description} onChange={e => setEditingEnt({...editingEnt, description: e.target.value})} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Owner</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/10 outline-none" value={editingEnt.owner} onChange={e => setEditingEnt({...editingEnt, owner: e.target.value})}>
                  <option value="">Select Owner...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Risk Level</label>
                <select 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/10 outline-none" 
                    value={editingEnt.risk} 
                    onChange={e => setEditingEnt({...editingEnt, risk: e.target.value as any})}
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Risk Score (1-10)</label>
                <input 
                    type="number" 
                    min="1" 
                    max="10" 
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/10 outline-none" 
                    value={editingEnt.riskScore} 
                    onChange={e => setEditingEnt({...editingEnt, riskScore: e.target.value})} 
                />
              </div>
              <div className="flex items-center h-full pt-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-blue-600" 
                    checked={editingEnt.isPrivileged} 
                    onChange={e => {
                      const isPriv = e.target.checked;
                      const newState = {...editingEnt, isPrivileged: isPriv};
                      if (isPriv) {
                        newState.risk = 'HIGH';
                        newState.riskScore = '10';
                      } else {
                        newState.risk = 'LOW';
                        newState.riskScore = '1';
                      }
                      setEditingEnt(newState);
                    }} 
                    />
                  <span className="text-sm font-bold text-slate-700">Privileged Entitlement?</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setEditingEnt(null)} className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => { onUpdateEntitlement(editingEnt); setEditingEnt(null); }} className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-700">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Global SoD Modal */}
      {showAddSod && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-2xl shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-bold text-slate-900 mb-6">Create New Inter-App SoD Policy</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Policy Name (Unique)</label>
                <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl" placeholder="e.g. IT Admin vs Auditor Conflict" value={newSod.policyName || ''} onChange={e => setNewSod({...newSod, policyName: e.target.value})} />
              </div>
              
              <div className="grid grid-cols-2 gap-6 items-center">
                <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <h4 className="text-xs font-black text-slate-400 uppercase">Conflict condition 1</h4>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Application</label>
                    <select className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg" value={newSod.appId1 || ''} onChange={e => setNewSod({...newSod, appId1: e.target.value, entitlement1: ''})}>
                      <option value="">Select App...</option>
                      {applications.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Entitlement</label>
                    <select className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg" value={newSod.entitlement1 || ''} onChange={e => setNewSod({...newSod, entitlement1: e.target.value})} disabled={!newSod.appId1}>
                      <option value="">Select Entitlement...</option>
                      {entitlements.filter(e => e.appId === newSod.appId1).map(e => <option key={e.entitlement} value={e.entitlement}>{e.entitlement}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex justify-center text-slate-300">
                  <ArrowRight className="w-8 h-8" />
                </div>

                <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                   <h4 className="text-xs font-black text-slate-400 uppercase">Conflict condition 2</h4>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Application</label>
                    <select className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg" value={newSod.appId2 || ''} onChange={e => setNewSod({...newSod, appId2: e.target.value, entitlement2: ''})}>
                      <option value="">Select App...</option>
                      {applications.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Entitlement</label>
                    <select className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg" value={newSod.entitlement2 || ''} onChange={e => setNewSod({...newSod, entitlement2: e.target.value})} disabled={!newSod.appId2}>
                      <option value="">Select Entitlement...</option>
                      {entitlements.filter(e => e.appId === newSod.appId2).map(e => <option key={e.entitlement} value={e.entitlement}>{e.entitlement}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Risk Level</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl" value={newSod.riskLevel || 'HIGH'} onChange={e => setNewSod({...newSod, riskLevel: e.target.value as any})}>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="LOW">LOW</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-10">
              <button onClick={() => setShowAddSod(false)} className="flex-1 px-6 py-4 border border-slate-200 rounded-2xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={handleAddGlobalSod} className="flex-1 px-6 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg hover:bg-blue-700">Create Policy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;