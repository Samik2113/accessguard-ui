import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { FileDown, ShieldCheck, UserCheck, AlertTriangle, Layers, ChevronLeft, Shield, Users, X, ShieldAlert, ChevronRight, FileSpreadsheet, Clock, Activity } from 'lucide-react';
import { ReviewCycle, ReviewItem, Application, ApplicationAccess, ActionStatus, User, SoDPolicy } from '../types';

interface GovernanceProps {
  cycles: ReviewCycle[];
  reviewItems: ReviewItem[];
  applications: Application[];
  access: ApplicationAccess[];
  onTabChange: (tab: string) => void;
  users: User[];
  sodPolicies: SoDPolicy[];
}

const Governance: React.FC<GovernanceProps> = ({ cycles, reviewItems, applications, access, onTabChange, users, sodPolicies }) => {
  const [detailView, setDetailView] = useState<'METRICS' | 'APPS' | 'IDENTITIES' | 'SOD'>('METRICS');
  const [viewingIdentityId, setViewingIdentityId] = useState<string | null>(null);
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);
  
  const sodViolations = useMemo(() => access.filter(a => a.isSoDConflict), [access]);
  const uniqueUsersCount = useMemo(() => new Set(access.map(a => a.correlatedUserId).filter(Boolean)).size, [access]);

  // Updated colors for a more cohesive and professional look
  const COLORS = {
    APPROVED: '#10b981', // Emerald
    PENDING_SYNC: '#f97316', // Orange
    VERIFIED: '#6366f1', // Indigo (Soothing instead of Red)
    NO_DECISION: '#94a3b8' // Slate/Blue
  };

  const historyData = useMemo(() => {
    const quarters: Record<string, { 
      name: string; 
      approved: number; 
      revokedPending: number; 
      revokedVerified: number;
    }> = {};

    cycles.forEach(cycle => {
      const key = `${cycle.year} Q${cycle.quarter}`;
      if (!quarters[key]) {
        quarters[key] = { name: key, approved: 0, revokedPending: 0, revokedVerified: 0 };
      }
      const cycleItems = reviewItems.filter(i => i.reviewCycleId === cycle.id);
      quarters[key].approved += cycleItems.filter(i => i.status === ActionStatus.APPROVED).length;
      quarters[key].revokedPending += cycleItems.filter(i => i.status === ActionStatus.REVOKED).length;
      quarters[key].revokedVerified += cycleItems.filter(i => i.status === ActionStatus.REMEDIATED).length;
    });
    return Object.values(quarters).sort((a, b) => a.name.localeCompare(b.name)).slice(-4);
  }, [cycles, reviewItems]);

  const decisionData = useMemo(() => [
    { name: 'APPROVED', value: reviewItems.filter(i => i.status === ActionStatus.APPROVED).length, color: COLORS.APPROVED },
    { name: 'PENDING SYNC', value: reviewItems.filter(i => i.status === ActionStatus.REVOKED).length, color: COLORS.PENDING_SYNC },
    { name: 'VERIFIED', value: reviewItems.filter(i => i.status === ActionStatus.REMEDIATED).length, color: COLORS.VERIFIED },
    { name: 'NO DECISION', value: reviewItems.filter(i => i.status === ActionStatus.PENDING).length, color: COLORS.NO_DECISION }
  ].filter(d => d.value > 0), [reviewItems, COLORS]);

  const userGlobalAccess = useMemo(() => access.filter(a => a.correlatedUserId === viewingIdentityId), [access, viewingIdentityId]);
  const viewingUser = users.find(u => u.id === viewingIdentityId);

  const exportMasterAuditorReport = () => {
    const headers = [
      'Campaign Name', 'App Name', 'User Name', 'Account ID', 'Entitlement', 'Reviewer (Manager)',
      'Decision', 'Decision Detail (Status)', 'SoD Conflict', 'Orphan Account',
      'Privileged Access', 'Decision Date', 'Remediation Verified Date', 'Justification/Comment'
    ];

    const csvContent = [
      headers.join(','),
      ...reviewItems.map(i => {
        const cycle = cycles.find(c => c.id === i.reviewCycleId);
        const manager = users.find(u => u.id === i.managerId);
        
        let decision = 'PENDING';
        let detailStatus = 'Pending Review';
        
        if (i.status === ActionStatus.APPROVED) {
            decision = 'APPROVED';
            detailStatus = 'Approved / Maintained';
        } else if (i.status === ActionStatus.REVOKED) {
            decision = 'REVOKED';
            detailStatus = 'Revoked (Awaiting De-provisioning)';
        } else if (i.status === ActionStatus.REMEDIATED) {
            decision = 'REVOKED';
            detailStatus = 'Revoked & Remediation Verified';
        }

        return [
          `"${cycle?.name || 'Unknown'}"`,
          `"${i.appName}"`,
          `"${i.userName}"`,
          `"${i.appUserId}"`,
          `"${i.entitlement.replace(/"/g, '""')}"`,
          `"${manager?.name || i.managerId}"`,
          `"${decision}"`,
          `"${detailStatus}"`,
          `"${i.isSoDConflict ? 'YES' : 'NO'}"`,
          `"${i.isOrphan ? 'YES' : 'NO'}"`,
          `"${i.isPrivileged ? 'YES' : 'NO'}"`,
          `"${i.actionedAt || ''}"`,
          `"${i.remediatedAt || ''}"`,
          `"${(i.comment || '').replace(/"/g, '""')}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Master_Governance_Auditor_Report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderContent = () => {
    if (detailView === 'APPS') {
      return (
        <div className="space-y-6 animate-in fade-in duration-300">
          <button onClick={() => setDetailView('METRICS')} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Metrics
          </button>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-200">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Layers className="w-5 h-5 text-indigo-600" /> Managed Inventory</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-[10px] uppercase font-bold text-slate-400 border-b">
                  <tr><th className="px-8 py-4">App Name</th><th className="px-8 py-4">Owner</th><th className="px-8 py-4">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {applications.map(app => (
                    <tr key={app.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-5 font-bold text-slate-800 uppercase">{app.name}</td>
                      <td className="px-8 py-5 text-sm text-slate-500">{users.find(u => u.id === app.ownerId)?.name || app.ownerId}</td>
                      <td className="px-8 py-5"><span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase">Monitored</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (detailView === 'IDENTITIES') {
      return (
        <div className="space-y-6 animate-in fade-in duration-300">
          <button onClick={() => setDetailView('METRICS')} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Metrics
          </button>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5 text-emerald-600" /> Correlated Identities</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-[10px] uppercase font-bold text-slate-400 border-b">
                  <tr><th className="px-8 py-4">Identity</th><th className="px-8 py-4">Dept</th><th className="px-8 py-4 text-right">Coverage</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.filter(u => access.some(a => a.correlatedUserId === u.id)).map(u => (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-800">{u.name}</div>
                        <div className="text-[10px] text-slate-400">ID: {u.id}</div>
                      </td>
                      <td className="px-8 py-5 text-sm text-slate-600">{u.department}</td>
                      <td className="px-8 py-5 text-right">
                        <button onClick={() => setViewingIdentityId(u.id)} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 transition-all border border-blue-100">
                          {access.filter(a => a.correlatedUserId === u.id).length} Items
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    if (detailView === 'SOD') {
      return (
        <div className="space-y-6 animate-in fade-in duration-300">
          <button onClick={() => setDetailView('METRICS')} className="flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Metrics
          </button>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 bg-slate-50 border-b flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" /> Compliance Risks (SoD)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50/50 text-[10px] uppercase font-bold text-slate-400 border-b">
                  <tr><th className="px-8 py-4">User</th><th className="px-8 py-4">Application</th><th className="px-8 py-4">Entitlement</th><th className="px-8 py-4 text-right">Violation Details</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sodViolations.map(v => (
                    <tr key={v.id} className="hover:bg-slate-50">
                      <td className="px-8 py-5"><div className="font-bold text-slate-800">{v.userName}</div></td>
                      <td className="px-8 py-5 text-sm font-black text-slate-900 uppercase">{v.appName}</td>
                      <td className="px-8 py-5 font-mono text-xs"><span className="bg-red-50 text-red-700 px-2 py-0.5 rounded border border-red-100 font-bold">{v.entitlement}</span></td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex flex-col items-end gap-1">
                          {v.violatedPolicyNames?.map((name, idx) => (
                             <button key={idx} onClick={() => setViewingPolicyId(v.violatedPolicyIds![idx])} className="text-[10px] font-bold text-red-600 hover:underline">
                               {name}
                             </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Governance Oversight</h1>
            <p className="text-slate-500">Cross-application metrics and compliance posture.</p>
          </div>
          <button 
            onClick={exportMasterAuditorReport}
            className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:bg-slate-800 transition-all"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            Master Auditor Record
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-slate-200 shadow-sm" style={{ height: '480px' }}>
            <div className="flex items-center justify-between mb-8">
               <h3 className="font-bold text-slate-800 uppercase tracking-widest text-xs">Review Velocity (Decisions per Quarter)</h3>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={historyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }} 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} 
                  />
                  {/* Single Stacked Bar per Quarter - Redundant grey bar removed */}
                  <Bar dataKey="approved" stackId="decisions" fill={COLORS.APPROVED} name="Approved" barSize={50} />
                  <Bar dataKey="revokedVerified" stackId="decisions" fill={COLORS.VERIFIED} name="Revoked (Verified)" />
                  <Bar dataKey="revokedPending" stackId="decisions" fill={COLORS.PENDING_SYNC} radius={[6, 6, 0, 0]} name="Revoked (Pending Sync)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-4 mt-8 px-2">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase"><div className="w-3 h-3 rounded bg-emerald-500"></div> Approved</div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase"><div className="w-3 h-3 rounded bg-orange-500"></div> Pending Sync</div>
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase"><div className="w-3 h-3 rounded bg-indigo-500"></div> Remediation Verified</div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col" style={{ height: '480px' }}>
            <h3 className="font-bold text-slate-800 mb-6 uppercase tracking-widest text-xs">Decision Mix</h3>
            <div className="flex-1 flex items-center justify-center">
               <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie 
                    data={decisionData} 
                    cx="50%" 
                    cy="50%" 
                    innerRadius={75} 
                    outerRadius={105} 
                    paddingAngle={4} 
                    dataKey="value"
                    stroke="none"
                  >
                     {decisionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                     ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '11px', fontWeight: 'bold' }} 
                    formatter={(value, name) => [`${value} items`, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-y-4 gap-x-4 mt-4 px-2">
                {decisionData.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }}></div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-slate-400 uppercase leading-none tracking-tight">{item.name}</span>
                      <span className="text-xs font-black text-slate-700">{item.value}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <button onClick={() => setDetailView('APPS')} className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm text-left hover:border-blue-400 hover:shadow-md transition-all group">
            <div className="bg-indigo-50 w-12 h-12 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <Layers className="w-6 h-6 text-indigo-600" />
            </div>
            <p className="text-4xl font-black text-slate-900">{applications.length}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Monitored Inventory</p>
          </button>
          
          <button onClick={() => setDetailView('IDENTITIES')} className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm text-left hover:border-emerald-400 hover:shadow-md transition-all group">
            <div className="bg-emerald-50 w-12 h-12 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <UserCheck className="w-6 h-6 text-emerald-600" />
            </div>
            <p className="text-4xl font-black text-slate-900">{uniqueUsersCount}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">Identity Coverage</p>
          </button>
          
          <button onClick={() => setDetailView('SOD')} className="bg-white border border-slate-200 p-8 rounded-3xl shadow-sm text-left hover:border-amber-400 hover:shadow-md transition-all group">
            <div className="bg-amber-50 w-12 h-12 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <p className="text-4xl font-black text-amber-600">{sodViolations.length}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">SoD Violation Backlog</p>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="relative min-h-screen">
      {renderContent()}

      {viewingIdentityId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95">
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
              <div className="flex items-center gap-4">
                <Users className="w-8 h-8 text-indigo-600" />
                <h3 className="text-xl font-bold text-slate-900">{viewingUser?.name} ({viewingUser?.id})</h3>
              </div>
              <button onClick={() => setViewingIdentityId(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="p-6 flex-1 overflow-y-auto bg-slate-50/30">
              <div className="space-y-4">
                {applications.map(app => {
                  const appAccess = userGlobalAccess.filter(a => a.appId === app.id);
                  if (appAccess.length === 0) return null;
                  return (
                    <div key={app.id} className="bg-white border rounded-2xl shadow-sm overflow-hidden">
                      <div className="bg-slate-50 px-4 py-3 border-b flex items-center gap-2">
                         <Shield className="w-4 h-4 text-blue-600" /><span className="font-black uppercase text-[10px] tracking-widest text-slate-600">{app.name}</span>
                      </div>
                      <table className="w-full text-left text-xs">
                        <tbody className="divide-y text-slate-700">
                          {appAccess.map(acc => (
                            <tr key={acc.id} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3 font-semibold">{acc.entitlement}</td>
                              <td className="px-4 py-3 text-right">
                                {acc.isSoDConflict && <span className="bg-red-50 text-red-600 font-bold uppercase text-[9px] px-2 py-0.5 rounded border border-red-100">Conflict Detected</span>}
                              </td>
                            </tr>
                          ))}
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

      {viewingPolicyId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-red-600" /> Policy Analysis</h3>
              <button onClick={() => setViewingPolicyId(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {(() => {
              const policy = sodPolicies.find(p => p.id === viewingPolicyId);
              if (!policy) return <p className="text-slate-400 italic">No policy data found.</p>;
              return (
                <div className="space-y-4">
                  <div className="p-4 bg-red-50 border border-red-100 rounded-xl">
                    <h4 className="font-black text-red-900 text-sm uppercase">{policy.policyName}</h4>
                    <p className="text-[10px] text-red-700 mt-1">This policy prevents conflicting entitlements across systems.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-3 bg-slate-50 border rounded-xl">
                        <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Entitlement A</p>
                        <p className="text-xs font-bold text-slate-800">{policy.entitlement1}</p>
                    </div>
                    <div className="p-3 bg-slate-50 border rounded-xl">
                        <p className="text-[9px] font-bold text-slate-400 uppercase mb-1">Entitlement B</p>
                        <p className="text-xs font-bold text-slate-800 uppercase">{policy.entitlement2}</p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => setViewingPolicyId(null)} className="w-full mt-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors">Close Policy View</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Governance;