import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Filter,
  Layers,
  Lock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  X
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { ActionStatus, Application, ApplicationAccess, AuditLog, ReviewCycle, ReviewItem, SoDPolicy, User } from '../types';
import ModalShell from './ModalShell';
import { findApplicationByAppId, hasActiveOrphanRisk } from '../utils/accessRisk';

type GovernanceDashboardKey = 'EXECUTIVE' | 'RISK' | 'REVIEW' | 'PRIVILEGED' | 'REMEDIATION' | 'EXCEPTIONS' | 'REPORTS';
type TimeRangeKey = '30D' | '90D' | '365D' | 'ALL';
type RiskCategoryKey = 'ALL' | 'PRIVILEGED' | 'ORPHAN' | 'DORMANT' | 'SHARED' | 'SOD' | 'EXCESSIVE';

type EnrichedAccess = ApplicationAccess & {
  systemName: string;
  systemType: NonNullable<Application['appType']> | 'Application';
  businessUnit: string;
  geography: string;
  logicalIdentityId: string;
  logicalIdentityName: string;
  logicalIdentityType: 'HUMAN' | 'PRIVILEGED' | 'SERVICE' | 'SHARED' | 'ORPHAN';
  isPrivilegedDerived: boolean;
  isOrphanRiskDerived: boolean;
  isDormantDerived: boolean;
  isSharedDerived: boolean;
  isExcessiveDerived: boolean;
  riskCategories: Array<'PRIVILEGED' | 'ORPHAN' | 'DORMANT' | 'SHARED' | 'SOD' | 'EXCESSIVE'>;
  weightedRisk: number;
  lastUsedAt?: string;
  detectedAt?: string;
};

type SyntheticRisk = {
  id: string;
  accessId: string;
  identityId: string;
  identityName: string;
  systemId: string;
  systemName: string;
  systemType: string;
  category: Exclude<RiskCategoryKey, 'ALL'>;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  weight: number;
  businessUnit: string;
  geography: string;
  detectedAt?: string;
  ageDays: number;
};

type SyntheticRemediation = {
  id: string;
  reviewItemId: string;
  cycleId: string;
  systemId: string;
  systemName: string;
  systemType: string;
  ownerGroup: string;
  businessUnit: string;
  status: 'OPEN' | 'COMPLETED';
  createdAt?: string;
  dueAt?: string;
  completedAt?: string;
  overdue: boolean;
};

interface GovernanceProps {
  cycles: ReviewCycle[];
  reviewItems: ReviewItem[];
  applications: Application[];
  access: ApplicationAccess[];
  onTabChange: (tab: string) => void;
  users: User[];
  sodPolicies: SoDPolicy[];
  auditLogs: AuditLog[];
}

const CHART_COLORS = ['#0f766e', '#2563eb', '#dc2626', '#f59e0b', '#7c3aed', '#475569'];
const RISK_COLORS: Record<string, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#2563eb',
  HIGH: '#f59e0b',
  CRITICAL: '#dc2626'
};

const DASHBOARD_TABS: Array<{ id: GovernanceDashboardKey; label: string }> = [
  { id: 'EXECUTIVE', label: 'Executive' },
  { id: 'RISK', label: 'Access Risk' },
  { id: 'REVIEW', label: 'Review Effectiveness' },
  { id: 'PRIVILEGED', label: 'Privileged Access' },
  { id: 'REMEDIATION', label: 'Remediation' },
  { id: 'EXCEPTIONS', label: 'Exceptions' },
  { id: 'REPORTS', label: 'Reports' }
];

const severityWeight = (severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') => {
  if (severity === 'CRITICAL') return 10;
  if (severity === 'HIGH') return 7;
  if (severity === 'MEDIUM') return 4;
  return 1;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeText = (value: unknown) => String(value || '').trim();

const normalizeLower = (value: unknown) => normalizeText(value).toLowerCase();

const toBool = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = normalizeLower(value);
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

const toDate = (value: unknown): Date | null => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const daysBetween = (from?: Date | null, to = new Date()) => {
  if (!from) return 999;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
};

const periodCutoff = (range: TimeRangeKey) => {
  if (range === 'ALL') return null;
  const days = range === '30D' ? 30 : range === '90D' ? 90 : 365;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const monthKey = (value?: string) => {
  const parsed = toDate(value);
  if (!parsed) return 'Unknown';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
};

const quarterLabel = (dateValue?: string) => {
  const parsed = toDate(dateValue);
  if (!parsed) return 'Unknown';
  return `${parsed.getFullYear()} Q${Math.floor(parsed.getMonth() / 3) + 1}`;
};

const parseLastUsedDate = (entry: any) => {
  const directCandidates = [
    entry?.lastUsedAt,
    entry?.lastLoginAt,
    entry?.lastLogonDate,
    entry?.lastLoginDetails,
    entry?.customAttributes?.lastUsedAt,
    entry?.customAttributes?.lastLoginAt,
    entry?.customAttributes?.lastLogonDate
  ];

  for (const candidate of directCandidates) {
    const parsed = toDate(candidate);
    if (parsed) return parsed.toISOString();
  }

  const text = normalizeText(entry?.lastLoginDetails);
  const match = text.match(/(20\d{2}-\d{2}-\d{2})/);
  if (match?.[1]) {
    const parsed = toDate(match[1]);
    if (parsed) return parsed.toISOString();
  }

  return undefined;
};

const ownerGroupForSystemType = (systemType: string) => {
  if (systemType === 'Servers' || systemType === 'Database') return 'IT Ops';
  if (systemType === 'Shared Mailbox' || systemType === 'Shared Folder') return 'App Owners';
  return 'IAM';
};

const exportCsv = (fileName: string, headers: string[], rows: Array<Array<string | number>>) => {
  const csv = [
    headers.join(','),
    ...rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const MetricCard: React.FC<{
  title: string;
  value: string;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue';
  subtitle?: string;
  onClick?: () => void;
}> = ({ title, value, tone = 'slate', subtitle, onClick }) => {
  const toneClass = tone === 'green'
    ? 'border-emerald-200 bg-emerald-50/50'
    : tone === 'amber'
      ? 'border-amber-200 bg-amber-50/50'
      : tone === 'red'
        ? 'border-red-200 bg-red-50/50'
        : tone === 'blue'
          ? 'border-blue-200 bg-blue-50/50'
          : 'border-slate-200 bg-white';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md ${toneClass} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{title}</p>
      <p className="mt-3 text-3xl font-black text-slate-900">{value}</p>
      {subtitle ? <p className="mt-2 text-sm text-slate-600">{subtitle}</p> : null}
    </button>
  );
};

const Panel: React.FC<{ title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }> = ({ title, subtitle, action, children }) => (
  <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const EmptyPanel: React.FC<{ title: string; description: string }> = ({ title, description }) => (
  <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
    <h4 className="text-base font-bold text-slate-900">{title}</h4>
    <p className="mt-2 text-sm text-slate-500">{description}</p>
  </div>
);

const Governance: React.FC<GovernanceProps> = ({ cycles, reviewItems, applications, access, onTabChange, users, sodPolicies, auditLogs }) => {
  const [activeDashboard, setActiveDashboard] = useState<GovernanceDashboardKey>('EXECUTIVE');
  const [timeRange, setTimeRange] = useState<TimeRangeKey>('365D');
  const [systemTypeFilter, setSystemTypeFilter] = useState<string>('ALL');
  const [riskCategoryFilter, setRiskCategoryFilter] = useState<RiskCategoryKey>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [geographyFilter, setGeographyFilter] = useState<string>('ALL');
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [trendGranularity, setTrendGranularity] = useState<'MONTH' | 'QUARTER'>('MONTH');

  const applicationsById = useMemo(() => {
    const map = new Map<string, Application>();
    applications.forEach((application) => {
      const keys = [normalizeText(application.id), normalizeText((application as any).appId)].filter(Boolean);
      keys.forEach((key) => map.set(key, application));
    });
    return map;
  }, [applications]);

  const usersById = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach((user) => map.set(normalizeText(user.id), user));
    return map;
  }, [users]);

  const cyclesById = useMemo(() => {
    const map = new Map<string, ReviewCycle>();
    cycles.forEach((cycle) => {
      map.set(normalizeText(cycle.id), cycle);
      const cycleKey = normalizeText((cycle as any).cycleId);
      if (cycleKey) map.set(cycleKey, cycle);
    });
    return map;
  }, [cycles]);

  const reviewItemsWithCycle = useMemo(() => {
    return reviewItems.map((item) => {
      const cycle = cyclesById.get(normalizeText(item.reviewCycleId));
      return {
        ...item,
        cycle,
        dueAt: cycle?.dueDate,
        launchedAt: cycle?.launchedAt || cycle?.startAt || cycle?.stagedAt,
        completedAt: item.remediatedAt || item.actionedAt,
        reviewerName: usersById.get(normalizeText(item.managerId))?.name || item.managerId,
        businessUnit: usersById.get(normalizeText(item.managerId))?.department || 'Unassigned'
      };
    });
  }, [reviewItems, cyclesById, usersById]);

  const accessByIdentitySystem = useMemo(() => {
    const grouped = new Map<string, number>();
    access.forEach((entry) => {
      const logicalId = normalizeText(entry.correlatedUserId || entry.userId || entry.id);
      const key = `${logicalId}::${normalizeText(entry.appId)}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    return grouped;
  }, [access]);

  const enrichedAccess = useMemo<EnrichedAccess[]>(() => {
    return access.map((entry) => {
      const application = applicationsById.get(normalizeText(entry.appId));
      const user = usersById.get(normalizeText(entry.correlatedUserId || entry.userId));
      const systemType = application?.appType || 'Application';
      const logicalIdentityId = normalizeText(entry.correlatedUserId || entry.userId || entry.id);
      const logicalIdentityName = normalizeText(user?.name || entry.userName || entry.email || entry.userId || entry.id);
      const orphan = toBool((entry as any).isOrphan);
      const orphanRisk = hasActiveOrphanRisk(entry, application);
      const privileged = toBool((entry as any).isPrivileged) || /admin|root|approver|priv/i.test(normalizeText(entry.entitlement));
      const shared = systemType === 'Shared Mailbox' || systemType === 'Shared Folder' || /shared|generic/i.test(`${entry.userName} ${entry.email}`);
      const lastUsedAt = parseLastUsedDate(entry as any);
      const lastUsedDate = toDate(lastUsedAt);
      const terminatedDormant = normalizeLower((entry as any).hrStatus) === 'terminated' && normalizeLower((entry as any).accountStatus) === 'active';
      const dormant = terminatedDormant || daysBetween(lastUsedDate) >= 90;
      const excessive = (accessByIdentitySystem.get(`${logicalIdentityId}::${normalizeText(entry.appId)}`) || 0) >= 4;
      const service = !orphan && !user && /svc|service|system|batch|daemon/i.test(`${entry.userName} ${entry.email || ''}`);
      const logicalIdentityType = orphan ? 'ORPHAN' : shared ? 'SHARED' : service ? 'SERVICE' : privileged ? 'PRIVILEGED' : 'HUMAN';

      const categories: EnrichedAccess['riskCategories'] = [];
      if (privileged) categories.push('PRIVILEGED');
      if (orphanRisk) categories.push('ORPHAN');
      if (dormant) categories.push('DORMANT');
      if (shared) categories.push('SHARED');
      if (toBool((entry as any).isSoDConflict)) categories.push('SOD');
      if (excessive) categories.push('EXCESSIVE');

      const weightedRisk = clamp(categories.reduce((sum, category) => {
        if (category === 'SOD') return sum + severityWeight('CRITICAL');
        if (category === 'ORPHAN' || category === 'DORMANT') return sum + severityWeight('HIGH');
        return sum + severityWeight('MEDIUM');
      }, 0), 0, 15);

      const detectedAt = reviewItemsWithCycle.find((item) => item.accessId === entry.id || (
        normalizeText(item.appId) === normalizeText(entry.appId)
        && normalizeText(item.appUserId) === normalizeText(entry.userId)
        && normalizeText(item.entitlement) === normalizeText(entry.entitlement)
      ))?.launchedAt;

      return {
        ...entry,
        systemName: application?.name || entry.appName || entry.appId,
        systemType,
        businessUnit: normalizeText(user?.department) || 'Unassigned',
        geography: normalizeText((user as any)?.city) || 'Unknown',
        logicalIdentityId,
        logicalIdentityName,
        logicalIdentityType,
        isPrivilegedDerived: privileged,
        isOrphanRiskDerived: orphanRisk,
        isDormantDerived: dormant,
        isSharedDerived: shared,
        isExcessiveDerived: excessive,
        riskCategories: categories,
        weightedRisk,
        lastUsedAt,
        detectedAt
      };
    });
  }, [access, applicationsById, usersById, accessByIdentitySystem, reviewItemsWithCycle]);

  const riskInventory = useMemo<SyntheticRisk[]>(() => {
    const risks: SyntheticRisk[] = [];
    enrichedAccess.forEach((entry) => {
      entry.riskCategories.forEach((category) => {
        const severity = category === 'SOD'
          ? 'CRITICAL'
          : category === 'ORPHAN' || category === 'DORMANT'
            ? 'HIGH'
            : 'MEDIUM';

        risks.push({
          id: `${entry.id}_${category}`,
          accessId: entry.id,
          identityId: entry.logicalIdentityId,
          identityName: entry.logicalIdentityName,
          systemId: normalizeText(entry.appId),
          systemName: entry.systemName,
          systemType: entry.systemType,
          category,
          severity,
          weight: severityWeight(severity),
          businessUnit: entry.businessUnit,
          geography: entry.geography,
          detectedAt: entry.detectedAt || entry.lastUsedAt,
          ageDays: daysBetween(toDate(entry.detectedAt || entry.lastUsedAt))
        });
      });
    });
    return risks;
  }, [enrichedAccess]);

  const remediationInventory = useMemo<SyntheticRemediation[]>(() => {
    return reviewItemsWithCycle
      .filter((item) => item.status === ActionStatus.REVOKED || item.status === ActionStatus.REMEDIATED)
      .map((item) => {
        const application = applicationsById.get(normalizeText(item.appId));
        const createdAt = item.actionedAt || item.launchedAt || item.cycle?.launchedAt || item.cycle?.stagedAt;
        const dueDate = item.cycle?.dueDate ? new Date(item.cycle.dueDate) : toDate(createdAt);
        if (dueDate && !item.cycle?.dueDate) dueDate.setDate(dueDate.getDate() + 14);
        return {
          id: `ACT_${item.id}`,
          reviewItemId: item.id,
          cycleId: item.reviewCycleId,
          systemId: normalizeText(item.appId),
          systemName: application?.name || item.appName,
          systemType: application?.appType || 'Application',
          ownerGroup: ownerGroupForSystemType(application?.appType || 'Application'),
          businessUnit: usersById.get(normalizeText(item.managerId))?.department || 'Unassigned',
          status: item.status === ActionStatus.REMEDIATED ? 'COMPLETED' : 'OPEN',
          createdAt: createdAt || undefined,
          dueAt: dueDate?.toISOString(),
          completedAt: item.remediatedAt || undefined,
          overdue: item.status === ActionStatus.REVOKED && !!dueDate && dueDate.getTime() < Date.now()
        };
      });
  }, [reviewItemsWithCycle, applicationsById, usersById]);

  const exceptionInventory = useMemo(() => {
    return auditLogs.filter((log) => /EXCEPTION|RISK_ACCEPT/i.test(log.action));
  }, [auditLogs]);

  const escalationEvents = useMemo(() => {
    return auditLogs.filter((log) => /ESCALATION|REMEDIATION_REMINDER|REMEDIATION_NOTIFICATION/i.test(log.action));
  }, [auditLogs]);

  const filteredAccess = useMemo(() => {
    const cutoff = periodCutoff(timeRange);
    return enrichedAccess.filter((entry) => {
      if (systemTypeFilter !== 'ALL' && entry.systemType !== systemTypeFilter) return false;
      if (departmentFilter !== 'ALL' && entry.businessUnit !== departmentFilter) return false;
      if (geographyFilter !== 'ALL' && entry.geography !== geographyFilter) return false;
      if (riskCategoryFilter !== 'ALL' && !entry.riskCategories.includes(riskCategoryFilter as any)) return false;
      if (!cutoff) return true;
      const referenceDate = toDate(entry.detectedAt || entry.lastUsedAt);
      return !referenceDate || referenceDate >= cutoff;
    });
  }, [enrichedAccess, timeRange, systemTypeFilter, departmentFilter, geographyFilter, riskCategoryFilter]);

  const filteredRisks = useMemo(() => {
    const cutoff = periodCutoff(timeRange);
    return riskInventory.filter((risk) => {
      if (systemTypeFilter !== 'ALL' && risk.systemType !== systemTypeFilter) return false;
      if (departmentFilter !== 'ALL' && risk.businessUnit !== departmentFilter) return false;
      if (geographyFilter !== 'ALL' && risk.geography !== geographyFilter) return false;
      if (riskCategoryFilter !== 'ALL' && risk.category !== riskCategoryFilter) return false;
      if (!cutoff) return true;
      const detectedDate = toDate(risk.detectedAt);
      return !detectedDate || detectedDate >= cutoff;
    });
  }, [riskInventory, timeRange, systemTypeFilter, departmentFilter, geographyFilter, riskCategoryFilter]);

  const filteredReviews = useMemo(() => {
    const cutoff = periodCutoff(timeRange);
    return reviewItemsWithCycle.filter((item) => {
      const application = applicationsById.get(normalizeText(item.appId));
      const reviewer = usersById.get(normalizeText(item.managerId));
      if (systemTypeFilter !== 'ALL' && (application?.appType || 'Application') !== systemTypeFilter) return false;
      if (departmentFilter !== 'ALL' && normalizeText(reviewer?.department || 'Unassigned') !== departmentFilter) return false;
      if (geographyFilter !== 'ALL' && normalizeText((reviewer as any)?.city || 'Unknown') !== geographyFilter) return false;
      if (!cutoff) return true;
      const referenceDate = toDate(item.actionedAt || item.remediatedAt || item.launchedAt || item.cycle?.dueDate);
      return !referenceDate || referenceDate >= cutoff;
    });
  }, [reviewItemsWithCycle, timeRange, systemTypeFilter, departmentFilter, geographyFilter, applicationsById, usersById]);

  const filteredRemediations = useMemo(() => {
    const cutoff = periodCutoff(timeRange);
    return remediationInventory.filter((item) => {
      if (systemTypeFilter !== 'ALL' && item.systemType !== systemTypeFilter) return false;
      if (departmentFilter !== 'ALL' && item.businessUnit !== departmentFilter) return false;
      if (!cutoff) return true;
      const createdAt = toDate(item.createdAt);
      return !createdAt || createdAt >= cutoff;
    });
  }, [remediationInventory, timeRange, systemTypeFilter, departmentFilter]);

  const departments = useMemo(() => Array.from(new Set(enrichedAccess.map((entry) => entry.businessUnit))).sort(), [enrichedAccess]);
  const geographies = useMemo(() => Array.from(new Set(enrichedAccess.map((entry) => entry.geography))).sort(), [enrichedAccess]);
  const systemTypes = useMemo(() => Array.from(new Set(enrichedAccess.map((entry) => entry.systemType))).sort(), [enrichedAccess]);

  const activeAccessCount = filteredAccess.length;
  const overallAccessRiskScore = useMemo(() => {
    if (activeAccessCount === 0) return 0;
    const total = filteredAccess.reduce((sum, entry) => sum + Math.min(15, entry.weightedRisk), 0);
    return Number(clamp((100 * total) / (activeAccessCount * 15), 0, 100).toFixed(1));
  }, [filteredAccess, activeAccessCount]);

  const privilegedExposure = filteredAccess.filter((entry) => entry.isPrivilegedDerived);
  const orphanExposure = filteredAccess.filter((entry) => entry.isOrphanRiskDerived);
  const dormantExposure = filteredAccess.filter((entry) => entry.isDormantDerived);
  const sharedExposure = filteredAccess.filter((entry) => entry.isSharedDerived);

  const reviewCompletionRate = useMemo(() => {
    const total = filteredReviews.length;
    if (total === 0) return 0;
    const completed = filteredReviews.filter((item) => item.status !== ActionStatus.PENDING).length;
    return Number(((completed / total) * 100).toFixed(1));
  }, [filteredReviews]);

  const overdueReviewCount = useMemo(() => {
    return filteredReviews.filter((item) => item.status === ActionStatus.PENDING && toDate(item.dueAt) && (toDate(item.dueAt) as Date).getTime() < Date.now()).length;
  }, [filteredReviews]);

  const slaMetRate = useMemo(() => {
    const completed = filteredReviews.filter((item) => item.status !== ActionStatus.PENDING && item.completedAt);
    if (completed.length === 0) return 0;
    const withinSla = completed.filter((item) => {
      const due = toDate(item.dueAt);
      const completedAt = toDate(item.completedAt);
      return due && completedAt ? completedAt <= due : false;
    }).length;
    return Number(((withinSla / completed.length) * 100).toFixed(1));
  }, [filteredReviews]);

  const riskByCategory = useMemo(() => {
    const categories: Record<Exclude<RiskCategoryKey, 'ALL'>, number> = {
      PRIVILEGED: 0,
      ORPHAN: 0,
      DORMANT: 0,
      SHARED: 0,
      SOD: 0,
      EXCESSIVE: 0
    };
    filteredRisks.forEach((risk) => {
      categories[risk.category] += risk.weight;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [filteredRisks]);

  const systemRiskHeatmap = useMemo(() => {
    const map = new Map<string, { systemId: string; systemName: string; systemType: string; score: number; identities: Set<string> }>();
    filteredRisks.forEach((risk) => {
      const current = map.get(risk.systemId) || { systemId: risk.systemId, systemName: risk.systemName, systemType: risk.systemType, score: 0, identities: new Set<string>() };
      current.score += risk.weight;
      current.identities.add(risk.identityId);
      map.set(risk.systemId, current);
    });
    return Array.from(map.values()).sort((a, b) => b.score - a.score);
  }, [filteredRisks]);

  const businessUnitRisk = useMemo(() => {
    const map = new Map<string, number>();
    filteredRisks.forEach((risk) => map.set(risk.businessUnit, (map.get(risk.businessUnit) || 0) + risk.weight));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredRisks]);

  const geographyRisk = useMemo(() => {
    const map = new Map<string, number>();
    filteredRisks.forEach((risk) => map.set(risk.geography, (map.get(risk.geography) || 0) + risk.weight));
    return Array.from(map.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredRisks]);

  const topRiskiestIdentities = useMemo(() => {
    const map = new Map<string, { identityId: string; name: string; type: string; score: number; risks: number; openRemediation: number; overdueReviews: number }>();
    filteredAccess.forEach((entry) => {
      const current = map.get(entry.logicalIdentityId) || {
        identityId: entry.logicalIdentityId,
        name: entry.logicalIdentityName,
        type: entry.logicalIdentityType,
        score: 0,
        risks: 0,
        openRemediation: 0,
        overdueReviews: 0
      };
      current.score += entry.weightedRisk;
      current.risks += entry.riskCategories.length;
      map.set(entry.logicalIdentityId, current);
    });

    filteredReviews.forEach((item) => {
      const matched = filteredAccess.find((entry) => normalizeText(entry.appId) === normalizeText(item.appId) && normalizeText(entry.userId) === normalizeText(item.appUserId));
      const identityId = matched?.logicalIdentityId || normalizeText(item.appUserId);
      const current = map.get(identityId);
      if (!current) return;
      if (item.status === ActionStatus.PENDING && toDate(item.dueAt) && (toDate(item.dueAt) as Date).getTime() < Date.now()) {
        current.score += 2;
        current.overdueReviews += 1;
      }
      if (item.status === ActionStatus.REVOKED) {
        current.score += 3;
        current.openRemediation += 1;
      }
    });

    return Array.from(map.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  }, [filteredAccess, filteredReviews]);

  const riskAging = useMemo(() => {
    const buckets = [
      { name: '0-30', min: 0, max: 30, value: 0 },
      { name: '31-60', min: 31, max: 60, value: 0 },
      { name: '61-90', min: 61, max: 90, value: 0 },
      { name: '91-180', min: 91, max: 180, value: 0 },
      { name: '180+', min: 181, max: Number.MAX_SAFE_INTEGER, value: 0 }
    ];
    filteredRisks.forEach((risk) => {
      const bucket = buckets.find((item) => risk.ageDays >= item.min && risk.ageDays <= item.max);
      if (bucket) bucket.value += 1;
    });
    return buckets;
  }, [filteredRisks]);

  const riskTrend = useMemo(() => {
    const map = new Map<string, { label: string; weightedRisk: number; reviewCompletion: number; items: number }>();
    filteredRisks.forEach((risk) => {
      const key = trendGranularity === 'MONTH' ? monthKey(risk.detectedAt) : quarterLabel(risk.detectedAt);
      const current = map.get(key) || { label: key, weightedRisk: 0, reviewCompletion: 0, items: 0 };
      current.weightedRisk += risk.weight;
      current.items += 1;
      map.set(key, current);
    });
    filteredReviews.forEach((item) => {
      const key = trendGranularity === 'MONTH' ? monthKey(item.launchedAt || item.dueAt) : quarterLabel(item.launchedAt || item.dueAt);
      const current = map.get(key) || { label: key, weightedRisk: 0, reviewCompletion: 0, items: 0 };
      if (item.status !== ActionStatus.PENDING) current.reviewCompletion += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label)).slice(-8);
  }, [filteredRisks, filteredReviews, trendGranularity]);

  const reviewCoverage = useMemo(() => {
    const reviewedSystems = new Set(filteredReviews.map((item) => normalizeText(item.appId)).filter(Boolean));
    const inScopeSystems = new Set(filteredAccess.map((entry) => normalizeText(entry.appId)).filter(Boolean));
    const reviewedIdentities = new Set(filteredReviews.map((item) => {
      const matched = filteredAccess.find((entry) => normalizeText(entry.appId) === normalizeText(item.appId) && normalizeText(entry.userId) === normalizeText(item.appUserId));
      return matched?.logicalIdentityId || normalizeText(item.appUserId);
    }).filter(Boolean));
    const inScopeIdentities = new Set(filteredAccess.map((entry) => entry.logicalIdentityId).filter(Boolean));
    return {
      systemCoverage: inScopeSystems.size === 0 ? 0 : Number(((reviewedSystems.size / inScopeSystems.size) * 100).toFixed(1)),
      identityCoverage: inScopeIdentities.size === 0 ? 0 : Number(((reviewedIdentities.size / inScopeIdentities.size) * 100).toFixed(1))
    };
  }, [filteredReviews, filteredAccess]);

  const decisionMix = useMemo(() => {
    const approved = filteredReviews.filter((item) => item.status === ActionStatus.APPROVED).length;
    const revoked = filteredReviews.filter((item) => item.status === ActionStatus.REVOKED || item.status === ActionStatus.REMEDIATED).length;
    const pending = filteredReviews.filter((item) => item.status === ActionStatus.PENDING).length;
    return [
      { name: 'Approved', value: approved, fill: '#10b981' },
      { name: 'Revoked', value: revoked, fill: '#f59e0b' },
      { name: 'Pending', value: pending, fill: '#94a3b8' }
    ].filter((item) => item.value > 0);
  }, [filteredReviews]);

  const rubberStampRate = useMemo(() => {
    const approved = filteredReviews.filter((item) => item.status === ActionStatus.APPROVED);
    if (approved.length === 0) return 0;
    const rubberStamped = approved.filter((item) => {
      const commentLength = normalizeText(item.comment).length;
      const launched = toDate(item.launchedAt);
      const actioned = toDate(item.actionedAt);
      const decisionHours = launched && actioned ? (actioned.getTime() - launched.getTime()) / 3600000 : 999;
      return commentLength === 0 && decisionHours <= 4;
    }).length;
    return Number(((rubberStamped / approved.length) * 100).toFixed(1));
  }, [filteredReviews]);

  const averageReviewCompletionHours = useMemo(() => {
    const completed = filteredReviews.filter((item) => item.status !== ActionStatus.PENDING && item.completedAt && item.launchedAt);
    if (completed.length === 0) return 0;
    const total = completed.reduce((sum, item) => {
      const launched = toDate(item.launchedAt);
      const completedAt = toDate(item.completedAt);
      if (!launched || !completedAt) return sum;
      return sum + (completedAt.getTime() - launched.getTime()) / 3600000;
    }, 0);
    return Number((total / completed.length).toFixed(1));
  }, [filteredReviews]);

  const reviewerAnalytics = useMemo(() => {
    const map = new Map<string, { reviewerId: string; reviewerName: string; assigned: number; approved: number; revoked: number; pending: number; rubberStamp: number; completionHours: number; completionSamples: number; reassigned: number }>();
    filteredReviews.forEach((item) => {
      const current = map.get(item.managerId) || {
        reviewerId: item.managerId,
        reviewerName: usersById.get(normalizeText(item.managerId))?.name || item.managerId,
        assigned: 0,
        approved: 0,
        revoked: 0,
        pending: 0,
        rubberStamp: 0,
        completionHours: 0,
        completionSamples: 0,
        reassigned: 0
      };

      current.assigned += 1;
      if (item.status === ActionStatus.APPROVED) current.approved += 1;
      if (item.status === ActionStatus.REVOKED || item.status === ActionStatus.REMEDIATED) current.revoked += 1;
      if (item.status === ActionStatus.PENDING) current.pending += 1;
      if (Number(item.reassignmentCount || 0) > 0) current.reassigned += 1;

      const launched = toDate(item.launchedAt);
      const actioned = toDate(item.actionedAt);
      if (launched && actioned) {
        current.completionHours += (actioned.getTime() - launched.getTime()) / 3600000;
        current.completionSamples += 1;
      }
      if (item.status === ActionStatus.APPROVED && normalizeText(item.comment).length === 0) current.rubberStamp += 1;

      map.set(item.managerId, current);
    });

    return Array.from(map.values()).map((item) => {
      const avgCompletion = item.completionSamples === 0 ? 0 : item.completionHours / item.completionSamples;
      const rubberStamp = item.assigned === 0 ? 0 : (item.rubberStamp / item.assigned) * 100;
      const reassignmentRate = item.assigned === 0 ? 0 : (item.reassigned / item.assigned) * 100;
      const overdueRate = item.assigned === 0 ? 0 : (item.pending / item.assigned) * 100;
      const qualityScore = clamp(100 - rubberStamp - reassignmentRate - overdueRate * 2, 0, 100);
      return {
        ...item,
        avgCompletion: Number(avgCompletion.toFixed(1)),
        rubberStampRate: Number(rubberStamp.toFixed(1)),
        reassignmentRate: Number(reassignmentRate.toFixed(1)),
        qualityScore: Number(qualityScore.toFixed(1))
      };
    }).sort((a, b) => a.qualityScore - b.qualityScore);
  }, [filteredReviews, usersById]);

  const privilegedTimeBoundSummary = useMemo(() => {
    const privileged = filteredAccess.filter((entry) => entry.isPrivilegedDerived);
    const timeBound = privileged.filter((entry: any) => toDate((entry as any).privilegeEndAt || (entry as any).customAttributes?.privilegeEndAt));
    return {
      standing: privileged.length - timeBound.length,
      timeBound: timeBound.length
    };
  }, [filteredAccess]);

  const privilegedUnused = useMemo(() => {
    return filteredAccess.filter((entry) => entry.isPrivilegedDerived && daysBetween(toDate(entry.lastUsedAt)) >= 30);
  }, [filteredAccess]);

  const remediationStats = useMemo(() => {
    const initiated = filteredRemediations.length;
    const completed = filteredRemediations.filter((item) => item.status === 'COMPLETED').length;
    const overdue = filteredRemediations.filter((item) => item.overdue).length;
    const slaMet = filteredRemediations.filter((item) => item.status === 'COMPLETED' && item.completedAt && item.dueAt && (toDate(item.completedAt) as Date) <= (toDate(item.dueAt) as Date)).length;
    const completedWithDueDate = filteredRemediations.filter((item) => item.status === 'COMPLETED' && item.completedAt && item.dueAt).length;
    return {
      initiated,
      completed,
      overdue,
      completionRatio: initiated === 0 ? 0 : Number(((completed / initiated) * 100).toFixed(1)),
      slaAdherence: completedWithDueDate === 0 ? 0 : Number(((slaMet / completedWithDueDate) * 100).toFixed(1))
    };
  }, [filteredRemediations]);

  const remediationByOwner = useMemo(() => {
    const map = new Map<string, { name: string; open: number; completed: number }>();
    filteredRemediations.forEach((item) => {
      const current = map.get(item.ownerGroup) || { name: item.ownerGroup, open: 0, completed: 0 };
      if (item.status === 'COMPLETED') current.completed += 1;
      else current.open += 1;
      map.set(item.ownerGroup, current);
    });
    return Array.from(map.values());
  }, [filteredRemediations]);

  const remediationAging = useMemo(() => {
    const buckets = [
      { name: '0-15', min: 0, max: 15, value: 0 },
      { name: '16-30', min: 16, max: 30, value: 0 },
      { name: '31-60', min: 31, max: 60, value: 0 },
      { name: '61-90', min: 61, max: 90, value: 0 },
      { name: '90+', min: 91, max: Number.MAX_SAFE_INTEGER, value: 0 }
    ];
    filteredRemediations.filter((item) => item.status === 'OPEN').forEach((item) => {
      const age = daysBetween(toDate(item.createdAt));
      const bucket = buckets.find((candidate) => age >= candidate.min && age <= candidate.max);
      if (bucket) bucket.value += 1;
    });
    return buckets;
  }, [filteredRemediations]);

  const selectedIdentityAccess = useMemo(() => filteredAccess.filter((entry) => entry.logicalIdentityId === selectedIdentityId), [filteredAccess, selectedIdentityId]);
  const selectedSystemAccess = useMemo(() => filteredAccess.filter((entry) => normalizeText(entry.appId) === normalizeText(selectedSystemId)), [filteredAccess, selectedSystemId]);
  const selectedPolicy = useMemo(() => sodPolicies.find((policy) => policy.id === selectedPolicyId) || null, [sodPolicies, selectedPolicyId]);

  const exportBoardReport = () => {
    exportCsv(
      `Quarterly_Access_Governance_Board_Report_${new Date().toISOString().split('T')[0]}.csv`,
      ['Metric', 'Value'],
      [
        ['Overall Access Risk Score', overallAccessRiskScore],
        ['Weighted Open Risks', filteredRisks.reduce((sum, item) => sum + item.weight, 0)],
        ['Privileged Active Access', privilegedExposure.length],
        ['Orphan Active Access', orphanExposure.length],
        ['Dormant Active Access', dormantExposure.length],
        ['Review Completion Rate', `${reviewCompletionRate}%`],
        ['Review SLA Met', `${slaMetRate}%`],
        ['Open Remediation Items', remediationStats.initiated - remediationStats.completed],
        ['Accepted Risk Exceptions', exceptionInventory.length]
      ]
    );
  };

  const exportPrivilegedReport = () => {
    exportCsv(
      `Privileged_Access_Oversight_Report_${new Date().toISOString().split('T')[0]}.csv`,
      ['System', 'Identity', 'Identity Type', 'Entitlement', 'Orphan', 'Dormant', 'Last Used'],
      privilegedExposure.map((entry) => [
        entry.systemName,
        entry.logicalIdentityName,
        entry.logicalIdentityType,
        entry.entitlement,
        entry.isOrphanRiskDerived ? 'Yes' : 'No',
        entry.isDormantDerived ? 'Yes' : 'No',
        entry.lastUsedAt || ''
      ])
    );
  };

  const exportAuditEvidenceReport = () => {
    exportCsv(
      `Audit_Evidence_Access_Reviews_${new Date().toISOString().split('T')[0]}.csv`,
      ['Campaign', 'System', 'User', 'Entitlement', 'Reviewer', 'Decision', 'Due Date', 'Completed At', 'Comment'],
      filteredReviews.map((item) => [
        item.cycle?.name || item.reviewCycleId,
        item.appName,
        item.userName,
        item.entitlement,
        item.reviewerName,
        item.status,
        item.dueAt || '',
        item.completedAt || '',
        item.comment || ''
      ])
    );
  };

  const exportOrphanDormantReport = () => {
    exportCsv(
      `Orphan_Dormant_Compliance_Report_${new Date().toISOString().split('T')[0]}.csv`,
      ['System', 'Identity', 'Identity Type', 'Entitlement', 'Orphan', 'Dormant', 'Privileged', 'Weighted Risk'],
      filteredAccess.filter((entry) => entry.isOrphanRiskDerived || entry.isDormantDerived).map((entry) => [
        entry.systemName,
        entry.logicalIdentityName,
        entry.logicalIdentityType,
        entry.entitlement,
        entry.isOrphanRiskDerived ? 'Yes' : 'No',
        entry.isDormantDerived ? 'Yes' : 'No',
        entry.isPrivilegedDerived ? 'Yes' : 'No',
        entry.weightedRisk
      ])
    );
  };

  const renderExecutiveDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Overall Access Risk Score" value={`${overallAccessRiskScore}`} tone={overallAccessRiskScore > 40 ? 'red' : overallAccessRiskScore > 20 ? 'amber' : 'green'} subtitle="Weighted open-risk index across active access" onClick={() => setActiveDashboard('RISK')} />
        <MetricCard title="Privileged Risk Summary" value={`${privilegedExposure.length}`} tone={privilegedExposure.length > 0 ? 'amber' : 'green'} subtitle={`${privilegedExposure.filter((entry) => entry.isOrphanRiskDerived).length} orphan privileged grants`} onClick={() => setActiveDashboard('PRIVILEGED')} />
        <MetricCard title="Orphan and Dormant Exposure" value={`${orphanExposure.length + dormantExposure.length}`} tone={orphanExposure.length + dormantExposure.length > 0 ? 'amber' : 'green'} subtitle={`${orphanExposure.length} orphan, ${dormantExposure.length} dormant`} onClick={() => setActiveDashboard('RISK')} />
        <MetricCard title="Review Completion and SLA" value={`${reviewCompletionRate}%`} tone={reviewCompletionRate < 85 ? 'red' : reviewCompletionRate < 95 ? 'amber' : 'green'} subtitle={`${overdueReviewCount} overdue reviews, ${slaMetRate}% SLA met`} onClick={() => setActiveDashboard('REVIEW')} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Privileged Access Risk Summary" subtitle="Human and non-human elevated access exposure">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard title="Total Privileged" value={`${privilegedExposure.length}`} tone="blue" />
            <MetricCard title="Orphan Privileged" value={`${privilegedExposure.filter((entry) => entry.isOrphanRiskDerived).length}`} tone="amber" />
            <MetricCard title="Unused 30+ Days" value={`${privilegedUnused.length}`} tone={privilegedUnused.length > 0 ? 'amber' : 'green'} />
          </div>
        </Panel>

        <Panel title="Orphan and Dormant Account Exposure" subtitle="High-risk populations outside normal identity correlation">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricCard title="Orphan Accounts" value={`${orphanExposure.length}`} tone={orphanExposure.length > 0 ? 'amber' : 'green'} />
            <MetricCard title="Dormant Accounts" value={`${dormantExposure.length}`} tone={dormantExposure.length > 0 ? 'amber' : 'green'} />
            <MetricCard title="Shared Accounts" value={`${sharedExposure.length}`} tone={sharedExposure.length > 0 ? 'blue' : 'slate'} />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="High-Risk Systems" subtitle="Systems ranked by weighted open risks">
          <div className="space-y-3">
            {systemRiskHeatmap.slice(0, 8).map((item) => {
              const tone = item.score > 40 ? 'bg-red-50 border-red-200' : item.score > 15 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200';
              return (
                <button key={item.systemId} type="button" onClick={() => setSelectedSystemId(item.systemId)} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left ${tone}`}>
                  <div>
                    <p className="font-bold text-slate-900">{item.systemName}</p>
                    <p className="text-xs text-slate-500">{item.systemType}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-black text-slate-900">{item.score}</p>
                    <p className="text-xs text-slate-500">{item.identities.size} identities</p>
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Enterprise Risk Trend"
          subtitle="Weighted risk and review throughput over time"
          action={
            <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 text-xs font-bold">
              <button type="button" onClick={() => setTrendGranularity('MONTH')} className={`rounded-lg px-3 py-1 ${trendGranularity === 'MONTH' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Monthly</button>
              <button type="button" onClick={() => setTrendGranularity('QUARTER')} className={`rounded-lg px-3 py-1 ${trendGranularity === 'QUARTER' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Quarterly</button>
            </div>
          }
        >
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={riskTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="weightedRisk" name="Weighted Risk" stroke="#dc2626" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="reviewCompletion" name="Completed Reviews" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </div>
  );

  const renderRiskDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Risk by Category" subtitle="Weighted concentration across enterprise risk types">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskByCategory} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={90} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                  {riskByCategory.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Risk Aging" subtitle="How long risk findings remain unresolved">
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskAging}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Bar dataKey="value" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Risk Heatmap by System" subtitle="System concentration sorted by weighted risk">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {systemRiskHeatmap.slice(0, 10).map((item) => {
              const bg = item.score > 40 ? 'bg-red-100 border-red-200' : item.score > 20 ? 'bg-amber-100 border-amber-200' : 'bg-emerald-100 border-emerald-200';
              return (
                <button key={item.systemId} type="button" onClick={() => setSelectedSystemId(item.systemId)} className={`rounded-2xl border p-4 text-left ${bg}`}>
                  <p className="text-sm font-bold text-slate-900">{item.systemName}</p>
                  <p className="mt-1 text-xs text-slate-600">{item.systemType}</p>
                  <p className="mt-4 text-2xl font-black text-slate-900">{item.score}</p>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Risk by Business Unit and Geography" subtitle="Weighted risk distribution by organization and location">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Business Unit</p>
              <div className="space-y-2">
                {businessUnitRisk.slice(0, 6).map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                    <span className="text-sm font-black text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Geography</p>
              <div className="space-y-2">
                {geographyRisk.slice(0, 6).map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-700">{item.name}</span>
                    <span className="text-sm font-black text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Top 10 Riskiest Identities" subtitle="Prioritized by weighted risk, overdue review items, and open remediation">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Identity</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Risk Score</th>
                <th className="px-4 py-3">Open Risks</th>
                <th className="px-4 py-3">Overdue Reviews</th>
                <th className="px-4 py-3">Open Remediation</th>
              </tr>
            </thead>
            <tbody>
              {topRiskiestIdentities.map((item) => (
                <tr key={item.identityId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => setSelectedIdentityId(item.identityId)} className="font-bold text-blue-700 hover:underline">{item.name}</button>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.type}</td>
                  <td className="px-4 py-3 font-black text-slate-900">{item.score}</td>
                  <td className="px-4 py-3">{item.risks}</td>
                  <td className="px-4 py-3">{item.overdueReviews}</td>
                  <td className="px-4 py-3">{item.openRemediation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const renderReviewDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="System Coverage" value={`${reviewCoverage.systemCoverage}%`} tone={reviewCoverage.systemCoverage < 85 ? 'red' : reviewCoverage.systemCoverage < 95 ? 'amber' : 'green'} />
        <MetricCard title="Identity Coverage" value={`${reviewCoverage.identityCoverage}%`} tone={reviewCoverage.identityCoverage < 85 ? 'red' : reviewCoverage.identityCoverage < 95 ? 'amber' : 'green'} />
        <MetricCard title="Completion vs Overdue" value={`${reviewCompletionRate}%`} tone={overdueReviewCount > 10 ? 'red' : overdueReviewCount > 0 ? 'amber' : 'green'} subtitle={`${overdueReviewCount} overdue`} />
        <MetricCard title="Approval vs Revoke" value={`${decisionMix.find((item) => item.name === 'Approved')?.value || 0}:${decisionMix.find((item) => item.name === 'Revoked')?.value || 0}`} tone="blue" />
        <MetricCard title="Rubber-Stamp Rate" value={`${rubberStampRate}%`} tone={rubberStampRate > 20 ? 'red' : rubberStampRate > 10 ? 'amber' : 'green'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Decision Mix" subtitle="Approved, revoked, and pending review items">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={decisionMix} innerRadius={70} outerRadius={110} dataKey="value" nameKey="name" paddingAngle={4}>
                  {decisionMix.map((item) => <Cell key={item.name} fill={item.fill} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Average Review Completion Time" subtitle="Average time from campaign launch to reviewer decision">
          <div className="flex h-80 items-center justify-center">
            <div className="text-center">
              <p className="text-6xl font-black text-slate-900">{averageReviewCompletionHours}</p>
              <p className="mt-2 text-sm font-semibold uppercase tracking-widest text-slate-500">Hours</p>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Reviewer Behavior Analytics" subtitle="Reviewer quality, throughput, and outlier detection">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">Reviewer</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Approved</th>
                <th className="px-4 py-3">Revoked</th>
                <th className="px-4 py-3">Pending</th>
                <th className="px-4 py-3">Avg Completion (hrs)</th>
                <th className="px-4 py-3">Rubber-Stamp %</th>
                <th className="px-4 py-3">Quality Score</th>
              </tr>
            </thead>
            <tbody>
              {reviewerAnalytics.map((item) => (
                <tr key={item.reviewerId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{item.reviewerName}</td>
                  <td className="px-4 py-3">{item.assigned}</td>
                  <td className="px-4 py-3">{item.approved}</td>
                  <td className="px-4 py-3">{item.revoked}</td>
                  <td className="px-4 py-3">{item.pending}</td>
                  <td className="px-4 py-3">{item.avgCompletion}</td>
                  <td className="px-4 py-3">{item.rubberStampRate}%</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.qualityScore < 60 ? 'bg-red-100 text-red-700' : item.qualityScore < 80 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      {item.qualityScore}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const renderPrivilegedDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Total Privileged Accounts" value={`${privilegedExposure.length}`} tone="blue" />
        <MetricCard title="Orphan Privileged IDs" value={`${privilegedExposure.filter((entry) => entry.isOrphanRiskDerived).length}`} tone={privilegedExposure.some((entry) => entry.isOrphanRiskDerived) ? 'amber' : 'green'} />
        <MetricCard title="Standing Access" value={`${privilegedTimeBoundSummary.standing}`} tone="slate" />
        <MetricCard title="Time-Bound Access" value={`${privilegedTimeBoundSummary.timeBound}`} tone="green" />
        <MetricCard title="Without Recent Usage" value={`${privilegedUnused.length}`} tone={privilegedUnused.length > 0 ? 'amber' : 'green'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Privileged Risk Trend" subtitle="Weighted privileged risk exposure over time">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={riskTrend.map((row) => ({ ...row, privilegedRisk: filteredRisks.filter((risk) => (trendGranularity === 'MONTH' ? monthKey(risk.detectedAt) : quarterLabel(risk.detectedAt)) === row.label && risk.category === 'PRIVILEGED').reduce((sum, risk) => sum + risk.weight, 0) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Line type="monotone" dataKey="privilegedRisk" stroke="#7c3aed" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Top Privileged Systems" subtitle="Systems with the highest privileged risk concentration">
          <div className="space-y-3">
            {systemRiskHeatmap.filter((item) => privilegedExposure.some((entry) => normalizeText(entry.appId) === item.systemId)).slice(0, 8).map((item) => (
              <button key={item.systemId} type="button" onClick={() => setSelectedSystemId(item.systemId)} className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-left hover:border-violet-300 hover:bg-violet-50/50">
                <div>
                  <p className="font-bold text-slate-900">{item.systemName}</p>
                  <p className="text-xs text-slate-500">{item.systemType}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-400" />
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Privileged Inventory" subtitle="Human and non-human elevated access inventory">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">System</th>
                <th className="px-4 py-3">Identity</th>
                <th className="px-4 py-3">Identity Type</th>
                <th className="px-4 py-3">Entitlement</th>
                <th className="px-4 py-3">Orphan</th>
                <th className="px-4 py-3">Dormant</th>
                <th className="px-4 py-3">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {privilegedExposure.slice(0, 25).map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{entry.systemName}</td>
                  <td className="px-4 py-3">{entry.logicalIdentityName}</td>
                  <td className="px-4 py-3">{entry.logicalIdentityType}</td>
                  <td className="px-4 py-3">{entry.entitlement}</td>
                  <td className="px-4 py-3">{entry.isOrphanRiskDerived ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">{entry.isDormantDerived ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3">{entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleDateString() : 'No usage'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const renderRemediationDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Revoke Actions Initiated" value={`${remediationStats.initiated}`} tone="blue" />
        <MetricCard title="Completed" value={`${remediationStats.completed}`} tone="green" />
        <MetricCard title="Action SLA Adherence" value={`${remediationStats.slaAdherence}%`} tone={remediationStats.slaAdherence < 85 ? 'red' : remediationStats.slaAdherence < 95 ? 'amber' : 'green'} />
        <MetricCard title="Open Remediation" value={`${remediationStats.initiated - remediationStats.completed}`} tone={remediationStats.initiated - remediationStats.completed > 0 ? 'amber' : 'green'} />
        <MetricCard title="Escalations Triggered" value={`${escalationEvents.length}`} tone={escalationEvents.length > 0 ? 'amber' : 'green'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Ownership Breakdown" subtitle="Remediation work split by operating team">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={remediationByOwner}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="open" stackId="a" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                <Bar dataKey="completed" stackId="a" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Remediation Aging Backlog" subtitle="Open remediation items by aging bucket">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={remediationAging}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Bar dataKey="value" fill="#dc2626" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Open Remediation Items" subtitle="Current action backlog awaiting closure">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-4 py-3">System</th>
                <th className="px-4 py-3">Owner Group</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRemediations.filter((item) => item.status === 'OPEN').slice(0, 25).map((item) => (
                <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{item.systemName}</td>
                  <td className="px-4 py-3">{item.ownerGroup}</td>
                  <td className="px-4 py-3">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</td>
                  <td className="px-4 py-3">{item.dueAt ? new Date(item.dueAt).toLocaleDateString() : ''}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${item.overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {item.overdue ? 'Overdue' : 'Open'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );

  const renderExceptionDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Active Risk Exceptions" value={`${exceptionInventory.length}`} tone={exceptionInventory.length > 0 ? 'amber' : 'green'} />
        <MetricCard title="Expiring 30 Days" value="0" tone="green" />
        <MetricCard title="Repeated Exceptions by System" value="0" tone="green" />
        <MetricCard title="Risk Acceptance Approvers" value="0" tone="slate" />
        <MetricCard title="Accepted Risk Exposure" value="0" tone="green" />
      </div>

      {exceptionInventory.length === 0 ? (
        <EmptyPanel title="No exception data model is active" description="The dashboard shell is implemented, but the current product does not yet persist first-class exception and risk acceptance records. Add an exception entity and approval workflow to activate these widgets." />
      ) : (
        <Panel title="Exception Activity" subtitle="Audit events currently tagged as exceptions or risk acceptance">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {exceptionInventory.map((log) => (
                  <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">{new Date(log.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-3">{log.userName}</td>
                    <td className="px-4 py-3">{log.action}</td>
                    <td className="px-4 py-3">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );

  const renderReportsDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Board and Audit Report Exports" subtitle="Generate current-state CSV outputs from the governance module">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button type="button" onClick={exportBoardReport} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left hover:border-blue-300 hover:bg-blue-50">
              <p className="font-bold text-slate-900">Quarterly Access Governance Board Report</p>
              <p className="mt-1 text-sm text-slate-500">Executive posture, top risks, completion, remediation.</p>
            </button>
            <button type="button" onClick={exportPrivilegedReport} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left hover:border-blue-300 hover:bg-blue-50">
              <p className="font-bold text-slate-900">Privileged Access Oversight Report</p>
              <p className="mt-1 text-sm text-slate-500">Privileged inventory, orphaned privilege, inactivity.</p>
            </button>
            <button type="button" onClick={exportAuditEvidenceReport} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left hover:border-blue-300 hover:bg-blue-50">
              <p className="font-bold text-slate-900">Audit Evidence Report</p>
              <p className="mt-1 text-sm text-slate-500">Review coverage, decision evidence, completion trail.</p>
            </button>
            <button type="button" onClick={exportOrphanDormantReport} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left hover:border-blue-300 hover:bg-blue-50">
              <p className="font-bold text-slate-900">Orphan and Dormant Compliance Report</p>
              <p className="mt-1 text-sm text-slate-500">High-risk orphan and dormant population evidence.</p>
            </button>
          </div>
        </Panel>

        <Panel title="Current Analytics Coverage" subtitle="What the current release can calculate from live product data">
          <div className="space-y-3">
            {[
              'Executive posture, risk concentration, and trend views are powered from access, reviews, and remediation status.',
              'Privileged, orphan, dormant, shared, and SoD-based risk signals are calculated directly from current records.',
              'Remediation governance uses revoked and remediated review outcomes plus escalation audit events.',
              'Exception governance is implemented as a shell and will activate once a dedicated exception entity is added.'
            ].map((line) => (
              <div key={line} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">{line}</div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900">Governance Module</h1>
          <p className="mt-1 text-sm text-slate-500">Executive, risk, review, privileged, remediation, and reporting oversight from live platform data.</p>
        </div>
        <button
          type="button"
          onClick={exportBoardReport}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
        >
          <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Export Board Report
        </button>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {DASHBOARD_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveDashboard(tab.id)}
                className={`rounded-2xl px-4 py-2 text-sm font-bold ${activeDashboard === tab.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-5 xl:w-[980px]">
            <div className="rounded-2xl border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Time</p>
              <select value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRangeKey)} className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none">
                <option value="30D">Last 30 days</option>
                <option value="90D">Last 90 days</option>
                <option value="365D">Last 12 months</option>
                <option value="ALL">All time</option>
              </select>
            </div>
            <div className="rounded-2xl border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">System Type</p>
              <select value={systemTypeFilter} onChange={(event) => setSystemTypeFilter(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none">
                <option value="ALL">All</option>
                {systemTypes.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="rounded-2xl border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Risk Type</p>
              <select value={riskCategoryFilter} onChange={(event) => setRiskCategoryFilter(event.target.value as RiskCategoryKey)} className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none">
                <option value="ALL">All</option>
                <option value="PRIVILEGED">Privileged</option>
                <option value="ORPHAN">Orphan</option>
                <option value="DORMANT">Dormant</option>
                <option value="SHARED">Shared</option>
                <option value="SOD">SoD</option>
                <option value="EXCESSIVE">Excessive</option>
              </select>
            </div>
            <div className="rounded-2xl border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Business Unit</p>
              <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none">
                <option value="ALL">All</option>
                {departments.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="rounded-2xl border border-slate-200 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Geography</p>
              <select value={geographyFilter} onChange={(event) => setGeographyFilter(event.target.value)} className="mt-1 w-full bg-transparent text-sm font-semibold text-slate-700 outline-none">
                <option value="ALL">All</option>
                {geographies.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
          </div>
        </div>
      </section>

      {activeDashboard === 'EXECUTIVE' && renderExecutiveDashboard()}
      {activeDashboard === 'RISK' && renderRiskDashboard()}
      {activeDashboard === 'REVIEW' && renderReviewDashboard()}
      {activeDashboard === 'PRIVILEGED' && renderPrivilegedDashboard()}
      {activeDashboard === 'REMEDIATION' && renderRemediationDashboard()}
      {activeDashboard === 'EXCEPTIONS' && renderExceptionDashboard()}
      {activeDashboard === 'REPORTS' && renderReportsDashboard()}

      {selectedIdentityId && (
        <ModalShell overlayClassName="z-[999]" panelClassName="max-w-5xl max-h-[85vh] overflow-hidden p-0">
          <div className="flex items-center justify-between border-b bg-slate-50 px-6 py-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900">Identity Detail</h3>
              <p className="text-sm text-slate-500">{selectedIdentityAccess[0]?.logicalIdentityName || selectedIdentityId}</p>
            </div>
            <button type="button" onClick={() => setSelectedIdentityId(null)} className="rounded-full p-2 hover:bg-slate-200">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MetricCard title="Access Grants" value={`${selectedIdentityAccess.length}`} />
              <MetricCard title="Weighted Risk" value={`${selectedIdentityAccess.reduce((sum, entry) => sum + entry.weightedRisk, 0)}`} tone="amber" />
              <MetricCard title="Open Risk Factors" value={`${selectedIdentityAccess.reduce((sum, entry) => sum + entry.riskCategories.length, 0)}`} tone="red" />
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">System</th>
                    <th className="px-4 py-3">Entitlement</th>
                    <th className="px-4 py-3">Risk Factors</th>
                    <th className="px-4 py-3">Last Used</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedIdentityAccess.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100">
                      <td className="px-4 py-3 font-semibold text-slate-900">{entry.systemName}</td>
                      <td className="px-4 py-3">{entry.entitlement}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {entry.riskCategories.length === 0 ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">None</span> : null}
                          {entry.riskCategories.map((category) => (
                            <span key={`${entry.id}_${category}`} className={`rounded-full px-2 py-1 text-xs font-bold ${category === 'SOD' ? 'bg-red-100 text-red-700' : category === 'ORPHAN' || category === 'DORMANT' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                              {category}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">{entry.lastUsedAt ? new Date(entry.lastUsedAt).toLocaleDateString() : 'No usage'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ModalShell>
      )}

      {selectedSystemId && (
        <ModalShell overlayClassName="z-[999]" panelClassName="max-w-6xl max-h-[85vh] overflow-hidden p-0">
          <div className="flex items-center justify-between border-b bg-slate-50 px-6 py-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900">System Detail</h3>
              <p className="text-sm text-slate-500">{selectedSystemAccess[0]?.systemName || selectedSystemId}</p>
            </div>
            <button type="button" onClick={() => setSelectedSystemId(null)} className="rounded-full p-2 hover:bg-slate-200">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <MetricCard title="Access Grants" value={`${selectedSystemAccess.length}`} />
              <MetricCard title="Privileged" value={`${selectedSystemAccess.filter((entry) => entry.isPrivilegedDerived).length}`} tone="blue" />
              <MetricCard title="Orphan" value={`${selectedSystemAccess.filter((entry) => entry.isOrphanRiskDerived).length}`} tone="amber" />
              <MetricCard title="SoD Conflicts" value={`${selectedSystemAccess.filter((entry) => entry.riskCategories.includes('SOD')).length}`} tone="red" />
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs font-bold uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Identity</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Entitlement</th>
                    <th className="px-4 py-3">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSystemAccess.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100">
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setSelectedIdentityId(entry.logicalIdentityId)} className="font-semibold text-blue-700 hover:underline">{entry.logicalIdentityName}</button>
                      </td>
                      <td className="px-4 py-3">{entry.logicalIdentityType}</td>
                      <td className="px-4 py-3">{entry.entitlement}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {entry.riskCategories.map((category) => (
                            <button key={`${entry.id}_${category}`} type="button" onClick={() => category === 'SOD' && entry.violatedPolicyIds?.[0] ? setSelectedPolicyId(entry.violatedPolicyIds[0]) : undefined} className={`rounded-full px-2 py-1 text-xs font-bold ${category === 'SOD' ? 'bg-red-100 text-red-700' : category === 'ORPHAN' || category === 'DORMANT' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                              {category}
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
        </ModalShell>
      )}

      {selectedPolicy && (
        <ModalShell overlayClassName="z-[999]" panelClassName="max-w-lg p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b bg-slate-50 px-6 py-4">
            <div>
              <h3 className="text-xl font-bold text-slate-900">SoD Policy Detail</h3>
              <p className="text-sm text-slate-500">{selectedPolicy.policyName}</p>
            </div>
            <button type="button" onClick={() => setSelectedPolicyId(null)} className="rounded-full p-2 hover:bg-slate-200">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
          <div className="space-y-4 p-6">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-red-600">Policy Severity</p>
              <p className="mt-2 text-lg font-black text-red-900">{selectedPolicy.riskLevel}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Conflict A</p>
              <p className="mt-2 font-semibold text-slate-900">{selectedPolicy.appId1} / {selectedPolicy.entitlement1}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Conflict B</p>
              <p className="mt-2 font-semibold text-slate-900">{selectedPolicy.appId2} / {selectedPolicy.entitlement2}</p>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

export default Governance;