import React, { useEffect, useMemo, useState } from 'react';
import { getAccountsByUser } from '../services/api';
import { Application, SoDPolicy } from '../types';
import { ShieldAlert, ShieldCheck, Layers } from 'lucide-react';

interface MyAccessProps {
  currentUserId: string;
  applications: Application[];
  sodPolicies: SoDPolicy[];
}

const normalize = (v: any) => String(v || '').trim().toLowerCase();

const MyAccess: React.FC<MyAccessProps> = ({ currentUserId, applications, sodPolicies }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!currentUserId) return;
      setLoading(true);
      setError(null);
      try {
        const res: any = await getAccountsByUser(currentUserId, 1000);
        if (!alive) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      } catch (e: any) {
        if (!alive) return;
        setItems([]);
        setError(e?.message || 'Failed to load your access details.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [currentUserId]);

  const appNameById = (appId: string) => applications.find(a => a.id === appId)?.name || appId;

  const withRisk = useMemo(() => {
    const ents = items.map(i => ({
      appId: String(i.appId || ''),
      entitlement: String(i.entitlement || '')
    }));

    const policyNameById = new Map(sodPolicies.map(p => [p.id, p.policyName]));

    return items.map(item => {
      const appId = String(item.appId || '');
      const entitlement = String(item.entitlement || '');

      const matchingPolicies = sodPolicies.filter(policy => {
        const has1 = ents.some(entry => entry.appId === policy.appId1 && normalize(entry.entitlement) === normalize(policy.entitlement1));
        const has2 = ents.some(entry => entry.appId === policy.appId2 && normalize(entry.entitlement) === normalize(policy.entitlement2));
        if (!(has1 && has2)) return false;
        return (appId === policy.appId1 && normalize(entitlement) === normalize(policy.entitlement1)) ||
               (appId === policy.appId2 && normalize(entitlement) === normalize(policy.entitlement2));
      });

      const policyIds = matchingPolicies.map(p => p.id);
      const policyNames = policyIds.map(id => policyNameById.get(id) || id);

      return {
        ...item,
        appId,
        appName: item.appName || appNameById(appId),
        isPrivileged: !!item.isPrivileged,
        isOrphan: !!item.isOrphan,
        isSoDConflict: policyIds.length > 0,
        violatedPolicyIds: policyIds,
        violatedPolicyNames: policyNames
      };
    });
  }, [items, sodPolicies, applications]);

  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    withRisk.forEach(item => {
      const key = item.appId || 'UNKNOWN';
      const arr = m.get(key) || [];
      arr.push(item);
      m.set(key, arr);
    });
    return Array.from(m.entries()).map(([appId, appItems]) => ({
      appId,
      appName: appItems[0]?.appName || appNameById(appId),
      items: appItems
    }));
  }, [withRisk, applications]);

  const privilegedCount = withRisk.filter(i => i.isPrivileged).length;
  const sodCount = withRisk.filter(i => i.isSoDConflict).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Access</h1>
        <p className="text-slate-500">View all applications and entitlements assigned to your account.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Applications</p>
          <p className="text-2xl font-bold text-slate-800 mt-1">{grouped.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">Privileged Access</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1">{privilegedCount}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] font-black text-slate-400 uppercase">SoD Conflicts</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{sodCount}</p>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-500">Loading your access...</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      {!loading && !error && grouped.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
          No access records found for your user.
        </div>
      )}

      {!loading && !error && grouped.map(group => (
        <div key={group.appId} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <h3 className="font-bold text-slate-800">{group.appName}</h3>
            </div>
            <span className="text-xs font-semibold text-slate-500">{group.items.length} item(s)</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-5 py-3">Account ID</th>
                  <th className="px-5 py-3">Entitlement</th>
                  <th className="px-5 py-3">Risk Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.items.map((item: any) => (
                  <tr key={item.id || `${item.appId}-${item.userId}-${item.entitlement}`}>
                    <td className="px-5 py-3 text-slate-600 font-mono">{item.userId || item.appUserId || '-'}</td>
                    <td className="px-5 py-3 font-medium text-slate-800">{item.entitlement || '-'}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.isPrivileged && (
                          <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                            <ShieldCheck className="w-3 h-3" /> Privileged
                          </span>
                        )}
                        {item.isSoDConflict && (
                          <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                            <ShieldAlert className="w-3 h-3" /> SoD Conflict
                          </span>
                        )}
                        {item.isOrphan && (
                          <span className="inline-flex items-center gap-1 bg-orange-50 text-orange-700 border border-orange-100 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                            Orphan
                          </span>
                        )}
                        {!item.isPrivileged && !item.isSoDConflict && !item.isOrphan && (
                          <span className="inline-flex items-center gap-1 bg-slate-50 text-slate-500 border border-slate-200 px-2 py-0.5 rounded text-[10px] font-bold uppercase">
                            Normal
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default MyAccess;
