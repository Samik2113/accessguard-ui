import React, { useMemo, useState } from 'react';
import { Application, ApplicationAccess, EntitlementDefinition, SoDPolicy, User } from '../types';
import { Layers, Users, Users2, Shield, ShieldAlert, ShieldCheck, AlertTriangle, ChevronRight, X } from 'lucide-react';
import ModalShell from './ModalShell';

interface MyTeamAccessProps {
  currentManagerId: string;
  users: User[];
  access: ApplicationAccess[];
  applications: Application[];
  entitlements: EntitlementDefinition[];
  sodPolicies: SoDPolicy[];
}

const MyTeamAccess: React.FC<MyTeamAccessProps> = ({ currentManagerId, users, access, applications, entitlements, sodPolicies }) => {
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);

  const parseBool = (value: any) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === 'yes' || normalized === '1';
    }
    return false;
  };

  const getRiskLevel = (item: any) => {
    if (parseBool(item?.isSoDConflict)) return 'CRITICAL';
    if (parseBool(item?.isOrphan)) return 'HIGH';
    if (isPrivilegedAccount(item)) return 'MEDIUM';
    return 'LOW';
  };

  const normalizeValue = (value: any) => String(value || '').trim().toLowerCase();
  const isPrivilegedEntitlement = (appId: string, entitlement: string) => {
    const appIdNorm = normalizeValue(appId);
    const entNorm = normalizeValue(entitlement);
    return entitlements.some((entry) => normalizeValue(entry.appId) === appIdNorm && normalizeValue(entry.entitlement) === entNorm && entry.isPrivileged);
  };
  const isPrivilegedAccount = (item: any) => parseBool(item?.isPrivileged) || isPrivilegedEntitlement(String(item?.appId || ''), String(item?.entitlement || ''));

  const reportees = useMemo(() => {
    return users
      .filter((user) => String(user.managerId || '').trim() === String(currentManagerId || '').trim())
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [users, currentManagerId]);

  const appNameById = (appId: string) => {
    const app = applications.find((entry: any) => String(entry.id || entry.appId) === String(appId));
    return app?.name || appId;
  };

  const teamAccessByUser = useMemo(() => {
    const reporteeIds = new Set(reportees.map((user) => user.id));
    const buckets = new Map<string, ApplicationAccess[]>();

    access.forEach((item) => {
      const correlatedUserId = String(item.correlatedUserId || '').trim();
      if (!correlatedUserId || !reporteeIds.has(correlatedUserId)) return;
      const arr = buckets.get(correlatedUserId) || [];
      arr.push(item);
      buckets.set(correlatedUserId, arr);
    });

    return buckets;
  }, [access, reportees]);

  const teamSummary = useMemo(() => {
    const allItems = Array.from(teamAccessByUser.values()).flat();
    return {
      identities: reportees.length,
      coveredIdentities: reportees.filter((u) => (teamAccessByUser.get(u.id) || []).length > 0).length,
      totalEntitlements: allItems.length,
      sodConflicts: allItems.filter((item) => parseBool((item as any).isSoDConflict)).length,
      privileged: allItems.filter((item) => isPrivilegedAccount(item)).length,
      orphan: allItems.filter((item) => parseBool((item as any).isOrphan)).length
    };
  }, [teamAccessByUser, reportees]);

  const viewingUser = reportees.find((user) => user.id === viewingUserId) || null;
  const viewingAccess = useMemo(() => {
    if (!viewingUserId) return [];
    return teamAccessByUser.get(viewingUserId) || [];
  }, [teamAccessByUser, viewingUserId]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Team Access</h1>
        <p className="text-slate-500">View direct-report identities and drill down into application access with risk context.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Reportees</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{teamSummary.identities}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Covered</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{teamSummary.coveredIdentities}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Entitlements</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{teamSummary.totalEntitlements}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">SoD</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{teamSummary.sodConflicts}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Privileged</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">{teamSummary.privileged}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Orphan</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{teamSummary.orphan}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-600" />
          <h3 className="font-bold text-slate-800">Direct Reports</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3">Identity</th>
                <th className="px-5 py-3">Department</th>
                <th className="px-5 py-3">Entitlements</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reportees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-500">No direct reports found for your account.</td>
                </tr>
              ) : reportees.map((user) => {
                const count = (teamAccessByUser.get(user.id) || []).length;
                return (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="font-semibold text-slate-800">{user.name}</div>
                      <div className="text-[10px] text-slate-400">ID: {user.id}</div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{user.department || '-'}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800">{count}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setViewingUserId(user.id)}
                        className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 border border-blue-100"
                      >
                        Drill Down
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {viewingUserId && (
        <ModalShell overlayClassName="z-[999]" panelClassName="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0">
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
                        <p className="text-2xl font-black text-slate-800">{Array.from(new Set(viewingAccess.map(a => a.appId))).length}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Entitlements</p>
                        <p className="text-2xl font-black text-slate-800">{viewingAccess.length}</p>
                    </div>
                    <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active SoD Violations</p>
                        <p className="text-2xl font-black text-red-600">{viewingAccess.filter(a => parseBool((a as any).isSoDConflict)).length}</p>
                    </div>
                </div>

                {applications.map(app => {
                  const appKeys = new Set([String((app as any).id || '').trim(), String((app as any).appId || '').trim()].filter(Boolean));
                  const appAccess = viewingAccess.filter(a => appKeys.has(String((a as any).appId || '').trim()));
                  if (appAccess.length === 0) return null;
                  const hasPrivilegedApp = appAccess.some(acc => isPrivilegedAccount(acc));
                  
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
                            const isPriv = isPrivilegedAccount(acc);
                            const hasSod = parseBool((acc as any).isSoDConflict);
                            const isOrphan = parseBool((acc as any).isOrphan);
                            const level = getRiskLevel(acc);
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
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${level === 'CRITICAL' ? 'bg-red-600 text-white' : level === 'HIGH' ? 'bg-orange-500 text-white' : level === 'MEDIUM' ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                      {level} RISK
                                    </span>
                                    {hasSod ? (
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
                                    ) : isOrphan ? (
                                      <span className="inline-flex items-center gap-1 text-orange-600 font-black uppercase text-[10px] bg-orange-50 px-2 py-0.5 rounded border border-orange-100">
                                        <AlertTriangle className="w-3 h-3" /> Orphan Account
                                      </span>
                                    ) : isPriv ? (
                                      <span className="inline-flex items-center gap-1 text-indigo-600 font-black uppercase text-[10px] bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                        <ShieldCheck className="w-3 h-3" /> Privileged Access
                                      </span>
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
        </ModalShell>
      )}

      {viewingPolicyId && (
        <ModalShell overlayClassName="z-[1000]" panelClassName="max-w-md p-8">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900">Policy Violation Details</h3>
              <button onClick={() => setViewingPolicyId(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {(() => {
              const policy = sodPolicies.find(p => p.id === viewingPolicyId);
              if (!policy) return <p className="text-slate-500 italic">Policy details not found.</p>;
              return (
                <div className="space-y-6">
                  <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-red-900 text-sm">{policy.policyName}</h4>
                      <p className="text-xs text-red-700 mt-1 leading-relaxed">This policy prevents users from possessing both roles due to excessive administrative or financial risk.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Conflicting Entitlement 1</p>
                      <p className="text-sm font-bold text-slate-800">{policy.entitlement1}</p>
                      <p className="text-[10px] text-slate-500 font-medium uppercase mt-0.5">Application: {appNameById(policy.appId1)}</p>
                    </div>
                    <div className="flex justify-center"><ChevronRight className="w-5 h-5 text-slate-300 rotate-90" /></div>
                    <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Conflicting Entitlement 2</p>
                      <p className="text-sm font-bold text-slate-800">{policy.entitlement2}</p>
                      <p className="text-[10px] text-slate-500 font-medium uppercase mt-0.5">Application: {appNameById(policy.appId2)}</p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => setViewingPolicyId(null)} className="w-full mt-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all">Close Detail</button>
        </ModalShell>
      )}
    </div>
  );
};

export default MyTeamAccess;
