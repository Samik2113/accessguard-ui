
import React, { useState, useMemo } from 'react';
import { ReviewItem, ActionStatus, Application, SoDPolicy, User, ApplicationAccess, ReviewCycle, ReviewStatus } from '../types';
import { Check, X, AlertCircle, Search, Filter, Shield, ListChecks, CheckSquare, Square, MessageSquare, ShieldCheck, ShieldAlert, ChevronRight, Send, Lock, Info, AlertTriangle } from 'lucide-react';

interface ManagerPortalProps {
  items: ReviewItem[];
  onAction: (itemId: string, status: ActionStatus, comment?: string) => void;
  onBulkAction: (itemIds: string[], status: ActionStatus, comment?: string) => void;
  currentManagerId: string;
  isAdmin?: boolean;
  applications: Application[];
  sodPolicies: SoDPolicy[];
  users: User[];
  access: ApplicationAccess[];
  cycles: ReviewCycle[];
  onConfirmReview: (cycleId: string, managerId: string) => void;
}

const ManagerPortal: React.FC<ManagerPortalProps> = ({ items, onAction, onBulkAction, currentManagerId, isAdmin = false, applications, sodPolicies, users, access, cycles, onConfirmReview }) => {
  const [userFilter, setUserFilter] = useState('ALL');
  const [entitlementFilter, setEntitlementFilter] = useState('ALL');
  const [appFilter, setAppFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [riskFilter, setRiskFilter] = useState('ALL');
  
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [showBulkModal, setShowBulkModal] = useState<{ status: ActionStatus | null; items: string[] }>({ status: null, items: [] });
  const [justification, setJustification] = useState('');
  const [singleActionModal, setSingleActionModal] = useState<{ id: string; status: ActionStatus } | null>(null);
  
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);

  const managerItems = useMemo(() => {
    return items.filter(i => isAdmin || i.managerId === currentManagerId);
  }, [items, isAdmin, currentManagerId]);

  const uniqueUsersInView = useMemo(() => Array.from(new Set(managerItems.map(i => i.userName))).sort(), [managerItems]);
  const uniqueEntsInView = useMemo(() => Array.from(new Set(managerItems.map(i => i.entitlement))).sort(), [managerItems]);

  const filteredItems = useMemo(() => {
    return managerItems.filter(item => {
      const matchesUser = userFilter === 'ALL' || item.userName === userFilter;
      const matchesEnt = entitlementFilter === 'ALL' || item.entitlement === entitlementFilter;
      const matchesApp = appFilter === 'ALL' || item.appName === appFilter;
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
      const matchesRisk = riskFilter === 'ALL' || 
        (riskFilter === 'SOD' && item.isSoDConflict) ||
        (riskFilter === 'PRIVILEGED' && item.isPrivileged) ||
        (riskFilter === 'ORPHAN' && item.isOrphan);
      return matchesUser && matchesEnt && matchesApp && matchesStatus && matchesRisk;
    });
  }, [managerItems, userFilter, entitlementFilter, appFilter, statusFilter, riskFilter]);

  const submissionTargets = useMemo(() => {
    const cycleIds = Array.from(new Set(managerItems.map(i => i.reviewCycleId)));
    return cycleIds.map(cycleId => {
      const cycleItems = managerItems.filter(i => i.reviewCycleId === cycleId);
      const cycle = cycles.find(c => c.id === cycleId);
      const isAlreadySubmitted = cycle?.confirmedManagers.includes(currentManagerId);
      const allActioned = cycleItems.every(i => i.status !== ActionStatus.PENDING);
      const appName = cycle?.appName || 'Unknown App';
      return { cycleId, appName, isAvailable: !isAlreadySubmitted && allActioned && cycleItems.length > 0 };
    }).filter(t => t.isAvailable);
  }, [managerItems, cycles, currentManagerId]);

  const isHighRisk = (item: ReviewItem) => item.isSoDConflict || item.isOrphan;

  const handleBulkSubmit = () => {
    if (!showBulkModal.status) return;
    const selectedObjs = showBulkModal.items.map(id => items.find(i => i.id === id)).filter(Boolean) as ReviewItem[];
    const hasHighRisk = selectedObjs.some(isHighRisk);

    if (showBulkModal.status === ActionStatus.APPROVED && hasHighRisk && !justification.trim()) {
      alert("Justification is MANDATORY for approving High/Critical risk items.");
      return;
    }

    onBulkAction(showBulkModal.items, showBulkModal.status, justification.trim());
    setJustification('');
    setShowBulkModal({ status: null, items: [] });
    setSelectedItems([]);
  };

  const handleSingleSubmit = () => {
    if (!singleActionModal) return;
    const item = items.find(i => i.id === singleActionModal.id);
    if (singleActionModal.status === ActionStatus.APPROVED && item && isHighRisk(item) && !justification.trim()) {
      alert("Justification is MANDATORY for approving High/Critical risk items.");
      return;
    }
    onAction(singleActionModal.id, singleActionModal.status, justification.trim());
    setJustification('');
    setSingleActionModal(null);
  };

  const isLocked = (item: ReviewItem) => {
    const cycle = cycles.find(c => c.id === item.reviewCycleId);
    return cycle?.confirmedManagers.includes(currentManagerId);
  };

  const selectableItems = useMemo(() => filteredItems.filter(i => !isLocked(i)), [filteredItems, cycles, currentManagerId]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500 pb-20">
      <div className="bg-white p-6 rounded-2xl border shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1 min-w-[150px]">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">User</span>
            <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
              <option value="ALL">All Users</option>
              {uniqueUsersInView.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[150px]">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Entitlement</span>
            <select value={entitlementFilter} onChange={e => setEntitlementFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
              <option value="ALL">All Entitlements</option>
              {uniqueEntsInView.map(ent => <option key={ent} value={ent}>{ent}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">App</span>
            <select value={appFilter} onChange={e => setAppFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
              <option value="ALL">All Apps</option>
              {Array.from(new Set(managerItems.map(i => i.appName))).map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Decision</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
              <option value="ALL">All Decisions</option>
              <option value={ActionStatus.PENDING}>Pending</option>
              <option value={ActionStatus.APPROVED}>Approved</option>
              <option value={ActionStatus.REVOKED}>Revoked</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Risk</span>
            <select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
              <option value="ALL">Any Risk</option>
              <option value="SOD">SoD Conflict</option>
              <option value="ORPHAN">Orphan Account</option>
              <option value="PRIVILEGED">Privileged Access</option>
            </select>
          </div>
        </div>

        {submissionTargets.length > 0 && (
          <div className="pt-4 border-t flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold uppercase">
               <ListChecks className="w-4 h-4" /> Ready for final submission
            </div>
            <div className="flex flex-wrap gap-2">
              {submissionTargets.map(t => (
                <button key={t.cycleId} onClick={() => onConfirmReview(t.cycleId, currentManagerId)} className="flex items-center gap-2 px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-500/20 hover:bg-emerald-700 transition-all">
                  <Send className="w-4 h-4" /> Finalize & Lock {t.appName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedItems.length > 0 && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 z-40 animate-in slide-in-from-bottom-8">
          <span className="text-sm font-bold">{selectedItems.length} Selected</span>
          <div className="flex gap-2">
            <button onClick={() => setShowBulkModal({ status: ActionStatus.APPROVED, items: selectedItems })} className="px-4 py-2 bg-green-600 rounded-lg text-sm font-bold"><Check className="w-4 h-4 inline mr-1" /> Bulk Approve</button>
            <button onClick={() => setShowBulkModal({ status: ActionStatus.REVOKED, items: selectedItems })} className="px-4 py-2 bg-red-600 rounded-lg text-sm font-bold"><X className="w-4 h-4 inline mr-1" /> Bulk Revoke</button>
            <button onClick={() => setSelectedItems([])} className="px-4 py-2 bg-slate-700 rounded-lg text-sm font-bold">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold border-b">
            <tr>
              <th className="px-6 py-4 w-12"><button onClick={() => setSelectedItems(selectedItems.length === selectableItems.length ? [] : selectableItems.map(i => i.id))}>{selectedItems.length > 0 && selectedItems.length === selectableItems.length ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}</button></th>
              <th className="px-6 py-4">User Details</th>
              <th className="px-6 py-4">Application</th>
              <th className="px-6 py-4">Entitlement</th>
              <th className="px-6 py-4">Risk Factors</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map((item) => {
              const locked = isLocked(item);
              const level = item.isSoDConflict ? 'CRITICAL' : item.isOrphan ? 'HIGH' : item.isPrivileged ? 'MEDIUM' : 'CLEAR';
              return (
                <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${selectedItems.includes(item.id) ? 'bg-blue-50/50' : ''} ${locked ? 'opacity-70 grayscale-[0.3]' : ''}`}>
                  <td className="px-6 py-5">
                    {!locked ? (
                      <button onClick={() => setSelectedItems(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])}>{selectedItems.includes(item.id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-300" />}</button>
                    ) : <Lock className="w-4 h-4 text-slate-300" />}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-bold text-slate-800">{item.userName}</div>
                    <div className="text-[10px] text-slate-400 font-mono">ID: {item.appUserId}</div>
                  </td>
                  <td className="px-6 py-4 font-black text-slate-900 uppercase">{item.appName}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                       {item.entitlement}
                       {/* Fix: Lucide icons do not always expose the title prop correctly in some TypeScript environments. Wrapping in span is safer for tooltips. */}
                       {item.isPrivileged && <span title="Privileged Entitlement"><ShieldCheck className="w-3.5 h-3.5 text-indigo-500 fill-indigo-50" /></span>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase w-fit ${level === 'CRITICAL' ? 'bg-red-600 text-white' : level === 'HIGH' ? 'bg-orange-500 text-white' : level === 'MEDIUM' ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                        {level} RISK
                      </span>
                      <div className="space-y-1 mt-1">
                        {item.isSoDConflict && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[8px] font-black text-red-600 uppercase flex items-center gap-1">
                              <ShieldAlert className="w-2.5 h-2.5" /> SoD Conflict
                            </span>
                            {item.violatedPolicyNames?.map((name, idx) => (
                              <button 
                                key={idx} 
                                onClick={() => item.violatedPolicyIds?.[idx] && setViewingPolicyId(item.violatedPolicyIds[idx])}
                                className="text-[8px] text-blue-500 hover:underline text-left font-bold uppercase truncate max-w-[150px]"
                              >
                                Policy: {name}
                              </button>
                            ))}
                          </div>
                        )}
                        {item.isOrphan && (
                          <span className="text-[8px] font-black text-orange-600 uppercase flex items-center gap-1">
                            <AlertTriangle className="w-2.5 h-2.5" /> Orphan Account
                          </span>
                        )}
                        {item.isPrivileged && (
                          <span className="text-[8px] font-black text-indigo-600 uppercase flex items-center gap-1">
                            <ShieldCheck className="w-2.5 h-2.5" /> Privileged Entitlement
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4"><span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${item.status === ActionStatus.PENDING ? 'bg-orange-50 text-orange-600 border' : item.status === ActionStatus.APPROVED ? 'bg-green-50 text-green-600 border' : 'bg-red-50 text-red-600 border'}`}>{item.status}</span></td>
                  <td className="px-6 py-4 text-center">
                     {!locked ? (
                       <div className="flex justify-center gap-2">
                         <button onClick={() => setSingleActionModal({ id: item.id, status: ActionStatus.APPROVED })} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="Approve"><Check className="w-4 h-4" /></button>
                         <button onClick={() => setSingleActionModal({ id: item.id, status: ActionStatus.REVOKED })} className="p-1.5 text-red-600 hover:bg-red-50 rounded" title="Revoke"><X className="w-4 h-4" /></button>
                       </div>
                     ) : <span className="text-[10px] font-bold text-slate-400 uppercase">Locked</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Policy Details Modal */}
      {viewingPolicyId && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in zoom-in-95">
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
                        <p className="text-[10px] text-slate-500 font-medium uppercase mt-0.5">Application: {applications.find(a => a.id === policy.appId1)?.name || policy.appId1}</p>
                     </div>
                     <div className="flex justify-center"><ChevronRight className="w-5 h-5 text-slate-300 rotate-90" /></div>
                     <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Conflicting Entitlement 2</p>
                        <p className="text-sm font-bold text-slate-800">{policy.entitlement2}</p>
                        <p className="text-[10px] text-slate-500 font-medium uppercase mt-0.5">Application: {applications.find(a => a.id === policy.appId2)?.name || policy.appId2}</p>
                     </div>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => setViewingPolicyId(null)} className="w-full mt-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all">Close Detail</button>
          </div>
        </div>
      )}

      {(showBulkModal.status || singleActionModal) && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in zoom-in-95">
            <h3 className="text-xl font-bold mb-4">Finalize Action</h3>
            {((showBulkModal.status === ActionStatus.APPROVED && showBulkModal.items.some(id => isHighRisk(items.find(i => i.id === id)!))) || 
              (singleActionModal?.status === ActionStatus.APPROVED && isHighRisk(items.find(i => i.id === singleActionModal.id)!))) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-xs font-bold rounded-xl border border-red-100">
                <AlertCircle className="w-4 h-4 inline mr-2" /> Justification mandatory for Critical or High risk items.
              </div>
            )}
            <textarea value={justification} onChange={e => setJustification(e.target.value)} className="w-full h-32 p-4 bg-slate-50 border rounded-xl mb-6 focus:ring-2 focus:ring-blue-500/20 outline-none" placeholder="Provide justification..."></textarea>
            <div className="flex gap-3">
              <button onClick={() => { setJustification(''); setShowBulkModal({ status: null, items: [] }); setSingleActionModal(null); }} className="flex-1 py-3 border rounded-xl font-bold hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={showBulkModal.status ? handleBulkSubmit : handleSingleSubmit} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerPortal;
