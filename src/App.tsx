import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import ManagerPortal from './components/ManagerPortal';
import Governance from './components/Governance';
import MyAccess from './components/MyAccess';
import MyTeamAccess from './components/MyTeamAccess';
import { UserRole, ReviewCycle, ReviewStatus, ReviewItem, ActionStatus, AuditLog, User, ApplicationAccess, Application, EntitlementDefinition, SoDPolicy, AppCustomization, CertificationType, OrphanReviewerMode } from './types';
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
  reassignReviewItemsBulk,
  confirmManager,
  cancelCycle,
  sendReviewNotifications,
  loginUser,
  bootstrapFirstUser,
  changePassword,
  resetUserPassword,
  setUserRole,
  setUserRolesBulk,
  getAppCustomization,
  saveAppCustomization
} from "./services/api";
import { useReviewCycles } from './features/reviews/queries';
import { useAccountsByApp } from './features/accounts/queries';
import { APP_TYPE_SCHEMA_TEMPLATES, buildDefaultAccountSchema, buildDefaultHrFeedSchema } from './constants';

const SESSION_STORAGE_KEY = 'accessguard.session.v1';
const CUSTOMIZATION_STORAGE_KEY = 'accessguard.customization.v1';
const DEFAULT_IDLE_TIMEOUT_MINUTES = 8 * 60;
const SESSION_TOUCH_THROTTLE_MS = 30 * 1000;

const DEFAULT_EMAIL_TEMPLATES = {
  reviewAssignment: {
    subject: '[AccessGuard] Review items assigned ({{appName}})',
    body: 'Hello {{reviewerName}},\n\nYou have {{pendingCount}} review item(s) assigned for campaign "{{cycleName}}" ({{appName}}).\nDue date: {{dueDate}}\n{{portalLine}}\n\nPlease review and submit your decisions.'
  },
  reviewReminder: {
    subject: '[AccessGuard] Reminder: {{pendingCount}} review item(s) pending',
    body: 'Hello {{reviewerName}},\n\nYou have {{pendingCount}} pending review item(s).\nApplications: {{appLabel}}\nCampaign(s): {{cycleLabel}}\nOldest pending assigned: {{oldestAssigned}}\n{{portalLine}}\n\nPlease review and submit your decisions.'
  },
  reviewEscalation: {
    subject: '[AccessGuard] Escalation: reviewer has {{pendingCount}} pending item(s)',
    body: 'Hello {{lineManagerName}},\n\nEscalation for reviewer {{reviewerName}} ({{reviewerId}}).\nPending review items: {{pendingCount}}\nApplications: {{appLabel}}\nCampaign(s): {{cycleLabel}}\nCampaign due date: {{dueDate}}\nOldest pending assigned: {{oldestAssigned}}\n{{portalLine}}\n\nPlease follow up to ensure review completion.'
  },
  reviewConfirmationReminder: {
    subject: '[AccessGuard] Reminder: confirmation pending for {{cycleLabel}}',
    body: 'Hello {{reviewerName}},\n\nAll your review decisions are captured, but your final confirmation is still pending.\nCampaign(s): {{cycleLabel}}\nApplications: {{appLabel}}\n{{portalLine}}\n\nPlease lock and close your review submission.'
  },
  reviewConfirmationEscalation: {
    subject: '[AccessGuard] Escalation: confirmation pending for reviewer {{reviewerName}}',
    body: 'Hello {{lineManagerName}},\n\nEscalation for reviewer {{reviewerName}} ({{reviewerId}}) who has not locked and closed the campaign.\nCampaign(s): {{cycleLabel}}\nApplications: {{appLabel}}\nCampaign due date: {{dueDate}}\n{{portalLine}}\n\nPlease follow up to ensure final confirmation is submitted.'
  },
  remediationNotify: {
    subject: '[AccessGuard] {{subjectPrefix}}: {{pendingCount}} remediation item(s) pending',
    body: 'Hello,\n\n{{pendingCount}} item(s) are pending remediation for campaign {{cycleId}}.\nApplication: {{appName}}\nDue date: {{dueDate}}\n\nAttached CSV contains all open remediation items.'
  },
  reviewReassigned: {
    subject: '[AccessGuard] Review item reassigned to you ({{appName}})',
    body: 'Hello {{reviewerName}},\n\nA review item has been reassigned to you.\nItem ID: {{itemId}}\nApplication: {{appName}}\nEntitlement: {{entitlement}}\nReviewed user: {{reviewedUser}}\n{{portalLine}}\n\nPlease review and take action.'
  },
  reviewReassignedBulk: {
    subject: '[AccessGuard] {{itemCount}} review item(s) reassigned to you',
    body: 'Hello {{reviewerName}},\n\n{{itemCount}} review item(s) have been reassigned to you.\n\nItems:\n{{itemSummary}}\n{{portalLine}}\n\nPlease review and take action.'
  }
};

const DEFAULT_CUSTOMIZATION: AppCustomization = {
  platformName: 'AccessGuard',
  primaryColor: '#2563eb',
  environmentLabel: 'Development',
  loginSubtitle: 'Sign in with emailId and password.',
  supportEmail: '',
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  hrFeedSchema: buildDefaultHrFeedSchema(),
  emailTemplates: DEFAULT_EMAIL_TEMPLATES
};

function normalizeStringArray(input: unknown, fallback: string[]) {
  if (!Array.isArray(input)) return [...fallback];
  const values = input.map((value) => String(value || '').trim()).filter(Boolean);
  return values.length > 0 ? values : [...fallback];
}

type PersistedSession = {
  user: { name: string; id: string; role: UserRole };
  activeTab: string;
  expiresAt: number;
};

function readPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed?.user?.id || !parsed?.expiresAt) return null;
    if (Date.now() >= Number(parsed.expiresAt)) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedSession(user: { name: string; id: string; role: UserRole }, activeTab: string, ttlMs: number) {
  const payload: PersistedSession = {
    user,
    activeTab,
    expiresAt: Date.now() + ttlMs
  };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function clearPersistedSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function readCustomization(): AppCustomization {
  try {
    const raw = localStorage.getItem(CUSTOMIZATION_STORAGE_KEY);
    if (!raw) return DEFAULT_CUSTOMIZATION;
    const parsed = JSON.parse(raw) as Partial<AppCustomization>;
    return normalizeCustomization(parsed);
  } catch {
    return DEFAULT_CUSTOMIZATION;
  }
}

function writeCustomization(customization: AppCustomization) {
  localStorage.setItem(CUSTOMIZATION_STORAGE_KEY, JSON.stringify(customization));
}

function normalizeHexColor(input: unknown, fallback: string) {
  const value = String(input || '').trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return value;
  return fallback;
}

function normalizeIdleTimeoutMinutes(input: unknown, fallback: number) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(24 * 60, Math.max(5, Math.round(parsed)));
}

function normalizeTemplate(input: unknown, fallback: { subject: string; body: string }) {
  const template = (input || {}) as { subject?: unknown; body?: unknown };
  const subject = String(template.subject || '').trim();
  const body = String(template.body || '');
  return {
    subject: subject || fallback.subject,
    body: body.length > 0 ? body : fallback.body
  };
}

function normalizeCustomization(input?: Partial<AppCustomization> | null): AppCustomization {
  const fallbackHrFeedSchema = buildDefaultHrFeedSchema();
  return {
    platformName: String(input?.platformName || DEFAULT_CUSTOMIZATION.platformName),
    primaryColor: normalizeHexColor(input?.primaryColor, DEFAULT_CUSTOMIZATION.primaryColor),
    environmentLabel: String(input?.environmentLabel || DEFAULT_CUSTOMIZATION.environmentLabel),
    loginSubtitle: String(input?.loginSubtitle || DEFAULT_CUSTOMIZATION.loginSubtitle),
    supportEmail: String(input?.supportEmail || DEFAULT_CUSTOMIZATION.supportEmail),
    idleTimeoutMinutes: normalizeIdleTimeoutMinutes(input?.idleTimeoutMinutes, DEFAULT_CUSTOMIZATION.idleTimeoutMinutes),
    hrFeedSchema: {
      mappings: Object.fromEntries(
        Object.entries(fallbackHrFeedSchema.mappings).map(([key, value]) => [key, String(input?.hrFeedSchema?.mappings?.[key] || value).trim() || value])
      ),
      ignoreColumns: Array.isArray(input?.hrFeedSchema?.ignoreColumns)
        ? input!.hrFeedSchema!.ignoreColumns.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [],
      customColumns: Array.isArray(input?.hrFeedSchema?.customColumns)
        ? input!.hrFeedSchema!.customColumns!.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [],
      statusRules: {
        activeValues: normalizeStringArray(input?.hrFeedSchema?.statusRules?.activeValues, fallbackHrFeedSchema.statusRules.activeValues),
        inactiveValues: normalizeStringArray(input?.hrFeedSchema?.statusRules?.inactiveValues, fallbackHrFeedSchema.statusRules.inactiveValues)
      }
    },
    emailTemplates: {
      reviewAssignment: normalizeTemplate(input?.emailTemplates?.reviewAssignment, DEFAULT_EMAIL_TEMPLATES.reviewAssignment),
      reviewReminder: normalizeTemplate(input?.emailTemplates?.reviewReminder, DEFAULT_EMAIL_TEMPLATES.reviewReminder),
      reviewEscalation: normalizeTemplate(input?.emailTemplates?.reviewEscalation, DEFAULT_EMAIL_TEMPLATES.reviewEscalation),
      reviewConfirmationReminder: normalizeTemplate(input?.emailTemplates?.reviewConfirmationReminder, DEFAULT_EMAIL_TEMPLATES.reviewConfirmationReminder),
      reviewConfirmationEscalation: normalizeTemplate(input?.emailTemplates?.reviewConfirmationEscalation, DEFAULT_EMAIL_TEMPLATES.reviewConfirmationEscalation),
      remediationNotify: normalizeTemplate(input?.emailTemplates?.remediationNotify, DEFAULT_EMAIL_TEMPLATES.remediationNotify),
      reviewReassigned: normalizeTemplate(input?.emailTemplates?.reviewReassigned, DEFAULT_EMAIL_TEMPLATES.reviewReassigned),
      reviewReassignedBulk: normalizeTemplate(input?.emailTemplates?.reviewReassignedBulk, DEFAULT_EMAIL_TEMPLATES.reviewReassignedBulk)
    }
  };
}

function getOnPrimaryTextColor(input: unknown, fallback: string) {
  const hex = normalizeHexColor(input, fallback);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#0f172a' : '#ffffff';
}



const App: React.FC = () => {
  const queryClient = useQueryClient();
  const lastSessionTouchRef = useRef(0);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState({ name: 'Admin User', id: 'ADM001', role: UserRole.ADMIN });
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [customization, setCustomization] = useState<AppCustomization>(DEFAULT_CUSTOMIZATION);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [showFirstUserSetup, setShowFirstUserSetup] = useState(false);
  const [setupUserId, setSetupUserId] = useState('ADM001');
  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSuccess, setSetupSuccess] = useState<string | null>(null);
  const [settingUpFirstUser, setSettingUpFirstUser] = useState(false);
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
  const cyclesQuery = useReviewCycles({ top: 200, enabled: isAuthenticated });
  const accountsQuery = useAccountsByApp({ appId: selectedAppId || undefined, top: 200 });
  const invalidateReviewQueries = async (cycleId?: string) => {
    await queryClient.invalidateQueries({ queryKey: ['review-cycles'] });
    if (cycleId) {
      await queryClient.invalidateQueries({ queryKey: ['review-cycle-detail'] });
    }
  };

  const getApplicationId = (app: any): string => String(app?.appId ?? app?.id ?? '');
  const getApplicationById = (appId?: string | null): Application | undefined => {
    if (!appId) return undefined;
    const target = String(appId);
    return applications.find((app: any) => {
      const id = String(app?.id ?? '');
      const appCode = String(app?.appId ?? '');
      return id === target || appCode === target;
    });
  };
  const getApplicationNameById = (appId?: string | null): string => {
    const app = getApplicationById(appId);
    return app?.name || String(appId || 'Unknown App');
  };
  const normalizeApplicationType = (value: any): NonNullable<Application['appType']> => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'database') return 'Database';
    if (raw === 'server' || raw === 'servers') return 'Servers';
    if (raw === 'shared mailbox' || raw === 'shared_mailbox' || raw === 'shared-mailbox') return 'Shared Mailbox';
    if (raw === 'shared folder' || raw === 'shared_folder' || raw === 'shared-folder') return 'Shared Folder';
    return 'Application';
  };
  const parseDelimitedValues = (value: any): string[] => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    return String(value || '')
      .split(/[;,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  };
  const normalizeAccountSchema = (app: any) => {
    const appType = normalizeApplicationType(app?.appType);
    const template = APP_TYPE_SCHEMA_TEMPLATES[appType] || APP_TYPE_SCHEMA_TEMPLATES.Application;
    const fallback = buildDefaultAccountSchema(appType);
    const current = app?.accountSchema || {};

    return {
      schemaAppType: appType,
      mappings: {
        ...fallback.mappings,
        ...(current?.mappings || {})
      },
      ignoreColumns: Array.isArray(current?.ignoreColumns)
        ? current.ignoreColumns.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [],
      customColumns: Array.isArray(current?.customColumns)
        ? current.customColumns.map((value: any) => String(value || '').trim()).filter(Boolean)
        : [],
      statusRules: {
        activeValues: Array.isArray(current?.statusRules?.activeValues)
          ? current.statusRules.activeValues.map((value: any) => String(value || '').trim().toLowerCase()).filter(Boolean)
          : [...template.statusRules.activeValues],
        inactiveValues: Array.isArray(current?.statusRules?.inactiveValues)
          ? current.statusRules.inactiveValues.map((value: any) => String(value || '').trim().toLowerCase()).filter(Boolean)
          : [...template.statusRules.inactiveValues]
      }
    };
  };
  const normalizeApplicationRecord = (app: any): Application => ({
    ...app,
    appType: normalizeApplicationType(app?.appType),
    ownerId: String(app?.ownerId ?? '').trim(),
    ownerAdminId: String(app?.ownerAdminId ?? '').trim(),
    ownerAdminIds: Array.from(new Set([
      ...parseDelimitedValues(app?.ownerAdminIds),
      ...parseDelimitedValues(app?.ownerAdminId)
    ])),
    ownerAdminTeams: Array.from(new Set(parseDelimitedValues(app?.ownerAdminTeams))),
    description: String(app?.description ?? ''),
    serverHost: String(app?.serverHost ?? '').trim(),
    serverHostName: String(app?.serverHostName ?? '').trim(),
    serverEnvironment: String(app?.serverEnvironment ?? '').trim() as any,
    accountSchema: normalizeAccountSchema(app)
  });
  const normalizeCycle = (cycle: any): ReviewCycle => ({
    ...cycle,
    appId: String(cycle?.appId ?? cycle?.applicationId ?? ''),
    appName: cycle?.appName || getApplicationNameById(cycle?.appId),
    cancelledAt: cycle?.cancelledAt || undefined,
    cancelReason: typeof cycle?.cancelReason === 'string' ? cycle.cancelReason : undefined,
    pendingRemediationItems: typeof cycle?.pendingRemediationItems === 'number' ? cycle.pendingRemediationItems : 0,
    confirmedManagers: Array.isArray(cycle?.confirmedManagers) ? cycle.confirmedManagers : [],
    certificationType: cycle?.certificationType === 'APPLICATION_OWNER'
      ? 'APPLICATION_OWNER'
      : cycle?.certificationType === 'APPLICATION_ADMIN'
        ? 'APPLICATION_ADMIN'
        : 'MANAGER',
    riskScope: cycle?.riskScope === 'SOD_ONLY'
      ? 'SOD_ONLY'
      : cycle?.riskScope === 'PRIVILEGED_ONLY'
        ? 'PRIVILEGED_ONLY'
        : cycle?.riskScope === 'ORPHAN_ONLY'
          ? 'ORPHAN_ONLY'
          : 'ALL_ACCESS',
    orphanReviewerMode: cycle?.orphanReviewerMode === 'APPLICATION_ADMIN'
      ? 'APPLICATION_ADMIN'
      : cycle?.orphanReviewerMode === 'CUSTOM'
        ? 'CUSTOM'
        : 'APPLICATION_OWNER',
    orphanReviewerId: String(cycle?.orphanReviewerId ?? '').trim() || undefined
  });

  const normalizeReviewItems = (items: any[]): ReviewItem[] =>
    items.map((item: any) => ({
      ...item,
      appId: String(item?.appId ?? item?.applicationId ?? ''),
      violatedPolicyIds: Array.isArray(item?.violatedPolicyIds) ? item.violatedPolicyIds : [],
      violatedPolicyNames: Array.isArray(item?.violatedPolicyNames) ? item.violatedPolicyNames : [],
      confirmedManagers: Array.isArray(item?.confirmedManagers) ? item.confirmedManagers : undefined
    }));

  const normalizeAuditLogs = (items: any[]): AuditLog[] =>
    (items || []).map((log: any, index: number) => ({
      id: String(log?.id || `LOG_FALLBACK_${index}_${Date.now()}`),
      timestamp: String(log?.timestamp || log?.createdAt || new Date().toISOString()),
      userId: String(log?.userId || log?.actorId || 'SYSTEM'),
      userName: String(log?.userName || log?.actorName || log?.userId || 'System'),
      action: String(log?.action || log?.type || 'UNKNOWN'),
      details: String(log?.details || log?.message || '')
    }));

  const loadAuditLogs = async (forceRevalidate = false) => {
    if (!isAuthenticated) return;
    try {
      const res: any = await getAuditLogs({ top: 500, forceRevalidate } as any);
      const items = Array.isArray(res?.items) ? normalizeAuditLogs(res.items) : [];
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setAuditLogs(items);
    } catch (e) {
      console.error('Failed to load audit logs:', e);
    }
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
  const sessionTtlMs = useMemo(
    () => normalizeIdleTimeoutMinutes(customization.idleTimeoutMinutes, DEFAULT_CUSTOMIZATION.idleTimeoutMinutes) * 60 * 1000,
    [customization.idleTimeoutMinutes]
  );

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
      const loggedInUser = {
        name: String(res?.user?.name || res?.user?.userId || 'User'),
        id: String(res?.user?.id || res?.user?.userId || ''),
        role
      };
      const nextTab = role === UserRole.USER ? 'my-team-access' : 'dashboard';
      setCurrentUser(loggedInUser);
      setActiveTab(nextTab);
      setIsAuthenticated(true);
      writePersistedSession(loggedInUser, nextTab, sessionTtlMs);
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
    setUsers([]);
    setApplications([]);
    setAccess([]);
    setEntitlements([]);
    setSodPolicies([]);
    setCycles([]);
    setReviewItems([]);
    setSelectedAppId(null);
    clearPersistedSession();
    queryClient.clear();
  };

  useEffect(() => {
    const persisted = readPersistedSession();
    setCustomization(readCustomization());
    if (persisted) {
      setCurrentUser(persisted.user);
      const persistedTab = persisted.activeTab === 'my-access' ? 'my-team-access' : persisted.activeTab;
      setActiveTab(persistedTab || (persisted.user.role === UserRole.USER ? 'my-team-access' : 'dashboard'));
      setIsAuthenticated(true);
    }

    (async () => {
      try {
        const res: any = await getAppCustomization();
        const remote = res?.customization;
        if (!remote) return;
        const normalized: AppCustomization = normalizeCustomization(remote);
        setCustomization(normalized);
        writeCustomization(normalized);
      } catch (err) {
        console.warn('Failed to load global customization, using local/default fallback.', err);
      }
    })();

    setSessionHydrated(true);
  }, []);

  const handleSaveCustomization = async (nextCustomization: AppCustomization) => {
    if (currentUser.role !== UserRole.ADMIN) {
      alert('Only Admin can customize platform settings.');
      return;
    }
    const normalized: AppCustomization = normalizeCustomization({
      ...nextCustomization,
      platformName: String(nextCustomization.platformName || '').trim() || DEFAULT_CUSTOMIZATION.platformName,
      environmentLabel: String(nextCustomization.environmentLabel || '').trim() || DEFAULT_CUSTOMIZATION.environmentLabel,
      loginSubtitle: String(nextCustomization.loginSubtitle || '').trim() || DEFAULT_CUSTOMIZATION.loginSubtitle,
      supportEmail: String(nextCustomization.supportEmail || '').trim()
    });

    setCustomization(normalized);
    writeCustomization(normalized);

    try {
      const res: any = await saveAppCustomization({
        customization: normalized,
        actor: {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role
        }
      });
      const saved = res?.customization;
      if (saved) {
        const normalizedSaved: AppCustomization = normalizeCustomization(saved);
        setCustomization(normalizedSaved);
        writeCustomization(normalizedSaved);
      }
    } catch (err: any) {
      alert(`Customization save failed: ${err?.message || 'Unknown error'}`);
    }
  };

  useEffect(() => {
    const primary = customization.primaryColor || DEFAULT_CUSTOMIZATION.primaryColor;
    document.documentElement.style.setProperty('--ag-primary', primary);
    document.documentElement.style.setProperty('--ag-on-primary', getOnPrimaryTextColor(primary, DEFAULT_CUSTOMIZATION.primaryColor));
  }, [customization.primaryColor]);

  useEffect(() => {
    if (!sessionHydrated || !isAuthenticated) return;
    writePersistedSession(currentUser, activeTab, sessionTtlMs);
  }, [sessionHydrated, isAuthenticated, currentUser, activeTab, sessionTtlMs]);

  useEffect(() => {
    if (!sessionHydrated || !isAuthenticated) return;

    const touchSession = () => {
      const now = Date.now();
      if (now - lastSessionTouchRef.current < SESSION_TOUCH_THROTTLE_MS) return;
      lastSessionTouchRef.current = now;
      writePersistedSession(currentUser, activeTab, sessionTtlMs);
    };

    const onUserActivity = () => touchSession();
    const activityEvents: Array<keyof WindowEventMap> = ['click', 'keydown', 'mousemove', 'scroll', 'focus'];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, onUserActivity, { passive: true }));

    const intervalId = window.setInterval(() => {
      const session = readPersistedSession();
      if (!session || Date.now() >= Number(session.expiresAt || 0)) {
        handleLogout();
      }
    }, 60 * 1000);

    touchSession();

    return () => {
      window.clearInterval(intervalId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, onUserActivity));
    };
  }, [sessionHydrated, isAuthenticated, currentUser, activeTab, sessionTtlMs]);

  const handleBootstrapFirstUser = async () => {
    setSetupError(null);
    setSetupSuccess(null);

    const userId = setupUserId.trim().toUpperCase();
    const name = setupName.trim();
    const email = setupEmail.trim().toLowerCase();
    const password = setupPassword;

    if (!userId || !name || !email || !password || !setupConfirmPassword) {
      setSetupError('Fill all first-user setup fields.');
      return;
    }
    if (password.length < 8) {
      setSetupError('Password must be at least 8 characters.');
      return;
    }
    if (password !== setupConfirmPassword) {
      setSetupError('Password and confirm password must match.');
      return;
    }

    setSettingUpFirstUser(true);
    try {
      await bootstrapFirstUser({ userId, name, email, password });
      setSetupSuccess('First admin user created. You can sign in now.');
      setLoginEmail(email);
      setLoginPassword('');
      setShowFirstUserSetup(false);
      setSetupPassword('');
      setSetupConfirmPassword('');
      setLoginError(null);
    } catch (err: any) {
      setSetupError(err?.message || 'Failed to create first user.');
    } finally {
      setSettingUpFirstUser(false);
    }
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
  if (!isAuthenticated) return;
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
      setApplications((res.items || []).map(normalizeApplicationRecord));
    } catch (e) {
      // optional: surface a toast/log
      console.error("Failed to load applications:", e);
    }
  }

  loadApps();
  return () => { isMounted = false; };
}, [isAuthenticated]); // load only after auth

useEffect(() => {
  if (!isAuthenticated) return;
  if (!selectedAppId && applications.length > 0) {
    setSelectedAppId(getApplicationId(applications[0]));
  }
}, [isAuthenticated, applications, selectedAppId]);

useEffect(() => {
  if (!isAuthenticated) return;
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
  if (!isAuthenticated) return;
  if (!selectedAppId) {
    setAccess([]);
    return;
  }

  const raw = Array.isArray((accountsQuery.data as any)?.items) ? (accountsQuery.data as any).items : [];
  const enriched: ApplicationAccess[] = raw.map((acc: any) => ({
    ...acc,
    ...correlateAccount(acc, users),
    userName: acc.userName || acc.name || ''
  }));

  setAccess(prev => {
    const other = prev.filter(a => a.appId !== selectedAppId);
    return [...other, ...enriched];
  });
}, [isAuthenticated, selectedAppId, accountsQuery.data, users]);

useEffect(() => {
  if (!isAuthenticated) return;
  let alive = true;
  (async () => {
    setUsersLoading(true);
    setUsersError(null);
    try {
      const items = await loadAllHrUsers();
      if (!alive) return;
      setUsers(items);
    } catch (e: any) {
      if (!alive) return;
      setUsersError(e?.message || "Failed to load HR users.");
      setUsers([]);
    } finally {
      if (alive) setUsersLoading(false);
    }
  })();
  return () => { alive = false; };
}, [isAuthenticated]);

useEffect(() => {
  if (!isAuthenticated || applications.length === 0) return;
  let alive = true;

  const loadAllAccountsForGovernance = async () => {
    try {
      const fetchAppAccounts = async (appId: string) => {
        let continuationToken: string | undefined = undefined;
        const items: any[] = [];
        do {
          const res: any = await getAccounts(appId, undefined, undefined, 500, continuationToken);
          const chunk = Array.isArray(res?.items) ? res.items : [];
          items.push(...chunk);
          continuationToken = res?.continuationToken || undefined;
        } while (continuationToken);
        return items;
      };

      const appIds = applications.map((app: any) => getApplicationId(app)).filter(Boolean);
      const accountResults = await Promise.all(appIds.map((appId) => fetchAppAccounts(appId)));
      if (!alive) return;

      const flattened = accountResults.flat();
      const enriched: ApplicationAccess[] = flattened.map((acc: any) => ({
        ...acc,
        ...correlateAccount(acc, users),
        userName: acc.userName || acc.name || ''
      }));

      setAccess(recalculateSoD(enriched, sodPolicies));
    } catch (e) {
      console.error('Failed to load all accounts for governance:', e);
    }
  };

  loadAllAccountsForGovernance();
  return () => { alive = false; };
}, [isAuthenticated, applications, users, sodPolicies]);

useEffect(() => {
  if (!isAuthenticated) {
    setAuditLogs([]);
    return;
  }
  loadAuditLogs(true);
}, [isAuthenticated]);

useEffect(() => {
  if (!isAuthenticated || activeTab !== 'audit') return;

  loadAuditLogs(true);
  const intervalId = window.setInterval(() => {
    loadAuditLogs(true);
  }, 30000);

  return () => window.clearInterval(intervalId);
}, [isAuthenticated, activeTab]);

useEffect(() => {
  if (!isAuthenticated) return;
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
}, [isAuthenticated]);

useEffect(() => {
  if (!isAuthenticated) {
    setCycles([]);
    setUarLoading(false);
    setUarError(null);
    return;
  }
  const qCycles = Array.isArray((cyclesQuery.data as any)?.cycles) ? (cyclesQuery.data as any).cycles : [];
  setCycles(qCycles.map(normalizeCycle));
  setUarLoading(cyclesQuery.isLoading);
  if (cyclesQuery.error) {
    const err = cyclesQuery.error as any;
    setUarError(err?.message || 'Failed to load review campaigns.');
  } else {
    setUarError(null);
  }
}, [isAuthenticated, cyclesQuery.data, cyclesQuery.error, cyclesQuery.isLoading]);

useEffect(() => {
  if (!isAuthenticated) return;
  let alive = true;
  (async () => {
    try {
      const itemsRes = await getReviewItems({ top: 500 });
      if (!alive) return;
      setReviewItems(Array.isArray(itemsRes?.items)
        ? normalizeReviewItems(itemsRes.items)
        : []);
    } catch (e) {
      console.error("Failed to load UAR data:", e);
      if (alive) {
        setUarError(e?.message || "Failed to load review campaigns and items.");
        setReviewItems([]);
      }
    }
  })();
  return () => { alive = false; };
}, [isAuthenticated]);

  const normalizeHrStatus = (raw: any): string => {
    const value = String(raw || '').trim();
    if (!value) return '';
    const lowered = value.toLowerCase();
    if (lowered.includes('active') || lowered.includes('onroll') || lowered.includes('enabled') || lowered.includes('current')) return 'ACTIVE';
    if (lowered.includes('terminat') || lowered.includes('inactive') || lowered.includes('separat') || lowered.includes('offboard') || lowered.includes('exit') || lowered.includes('left') || lowered.includes('former') || lowered.includes('disable')) return 'TERMINATED';
    return value.toUpperCase();
  };

  const loadAllHrUsers = async (): Promise<User[]> => {
    const items: User[] = [];
    let continuationToken: string | undefined = undefined;

    do {
      const res = await getHrUsers({ top: 200, ct: continuationToken });
      if (!res?.ok && res?.status) {
        throw new Error(res.message || 'Failed to load HR users.');
      }

      const chunk = Array.isArray(res?.items) ? res.items : [];
      items.push(...chunk.map((user: any) => ({
        ...user,
        status: normalizeHrStatus(user?.status || user?.employeeStatus || user?.employmentStatus || user?.enabled)
      })));
      continuationToken = res?.continuationToken || undefined;
    } while (continuationToken);

    return items;
  };

  const correlateAccount = (acc: any, identityList: User[]): Partial<ApplicationAccess> => {
    // Prefer matching by email first. If email matches, use it and skip id checks.
    const accEmails = [acc.email, acc.userEmail, acc.accountEmail].filter(Boolean).map((s: string) => s.toLowerCase());
    let match: User | undefined;
    if (accEmails.length > 0) {
      match = identityList.find(u => u.email && accEmails.includes(u.email.toLowerCase()));
      const hrStatus = normalizeHrStatus(match?.status);
      if (match) {
        return {
          correlatedUserId: match.id,
          isOrphan: false,
          hrStatus,
          isTerminated: hrStatus === 'TERMINATED',
          email: match.email,
          userName: match.name || acc.userName || acc.name || ''
        };
      }
    }

    // If email didn't match, try various id fields (employee id, account id, etc.)
    const possibleIds = [acc.userId, acc.accountId, acc.employeeId, acc.account_id, acc.id].filter(Boolean);
    if (possibleIds.length > 0) {
      match = identityList.find(u => {
        const userCandidates = [u.id, (u as any).employeeId, (u as any).accountId, (u as any).userId]
          .filter(Boolean)
          .map((value: any) => String(value).trim());
        return possibleIds.some((candidate: any) => userCandidates.includes(String(candidate).trim()));
      });
      const hrStatus = normalizeHrStatus(match?.status);
      if (match) {
        return {
          correlatedUserId: match.id,
          isOrphan: false,
          hrStatus,
          isTerminated: hrStatus === 'TERMINATED',
          email: acc.email || match.email,
          userName: match.name || acc.userName || acc.name || ''
        };
      }
    }

    // No match -> orphan
    return {
      correlatedUserId: undefined,
      isOrphan: true,
      hrStatus: '',
      isTerminated: false,
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
      await invalidateReviewQueries(cycleId);

      // Refresh cycles from backend
      const cyclesRes = await getReviewCycles({ top: 200 });
      setCycles(Array.isArray(cyclesRes?.cycles) ? cyclesRes.cycles.map(normalizeCycle) : []);

      // Also refresh items in case cycle status changed to COMPLETED and items need refresh
      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? normalizeReviewItems(itemsRes.items) : []);

      await addAuditLog('MANAGER_CONFIRM', `Manager ${managerId} locked decisions for campaign: ${cycleId}.`);
      alert('✓ Review finalized successfully!');
    } catch (e: any) {
      console.error('Failed to confirm review:', e);
      alert(`Failed to finalize review: ${e?.message || 'Unknown error'}`);
    } finally {
      setConfirmingReview(null);
    }
  };

  const handleSendReviewNotifications = async (payload: { mode: 'REMINDER' | 'ESCALATE' | 'REMEDIATION_NOTIFY' | 'REMEDIATION_REMINDER'; cycleId?: string; appId?: string; managerId?: string; selectedRecipientEmail?: string; dryRun?: boolean }) => {
    const response = await sendReviewNotifications(payload);
    const auditAction = payload.mode === 'ESCALATE'
      ? 'REVIEW_ESCALATION_TRIGGER'
      : payload.mode === 'REMEDIATION_NOTIFY'
        ? 'REMEDIATION_NOTIFICATION_TRIGGER'
        : payload.mode === 'REMEDIATION_REMINDER'
          ? 'REMEDIATION_REMINDER_TRIGGER'
          : 'REVIEW_REMINDER_TRIGGER';
    await addAuditLog(
      auditAction,
      `mode=${payload.mode}; cycleId=${payload.cycleId || 'ALL'}; appId=${payload.appId || 'ALL'}; sent=${response?.sent ?? 0}; skipped=${response?.skipped ?? 0}`
    );
    return response;
  };

  const handleCancelCampaign = async (cycleId: string, reason: string) => {
    try {
      const cycle = cycles.find(c => c.id === cycleId);
      if (!cycle) throw new Error('Review cycle not found');

      await cancelCycle({ cycleId, appId: cycle.appId, reason });
      await invalidateReviewQueries(cycleId);

      const cyclesRes = await getReviewCycles({ top: 200 });
      setCycles(Array.isArray(cyclesRes?.cycles) ? cyclesRes.cycles.map(normalizeCycle) : []);

      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? normalizeReviewItems(itemsRes.items) : []);

      await addAuditLog('CAMPAIGN_CANCEL', `Cancelled review campaign: ${cycleId}. Reason: ${reason}`);
      alert('Campaign cancelled successfully.');
    } catch (error: any) {
      console.error('Failed to cancel campaign:', error);
      alert(`Failed to cancel campaign: ${error?.message || 'Unknown error'}`);
    }
  };
  const handleDataImport = async (
  type: 'HR' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD' | 'APPLICATIONS',
  data: any[],
  appId?: string
) => {
  try {
    if (type === 'HR') {
      const normalized = data.map((r: any) => {
        const userId = String(r.userId || r.accountId || r.employeeId || r.id || '').trim();
        const name = String(r.name || [r.givenName, r.surname].filter(Boolean).join(' ') || '').trim();
        const email = String(r.email || '').trim().toLowerCase();
        const enabled = String(r.enabled ?? '').trim().toLowerCase();
        const derivedStatus = r.status || r.employeeStatus || (enabled === 'false' || enabled === '0' || enabled === 'no' ? 'Inactive' : enabled === 'true' || enabled === '1' || enabled === 'yes' ? 'Active' : '');
        return {
          ...r,
          id: userId,
          userId,
          name,
          email,
          managerId: r.managerId ?? '',
          department: r.department ?? '',
          title: r.title ?? '',
          status: derivedStatus || 'Active',
          type: 'hr-user'
        };
      });

      const importResult: any = await importHrUsers(normalized, { replaceAll: true, debug: true, resetPasswords: false, returnCredentials: true });
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
      const items = await loadAllHrUsers();
      setUsers(items);
      setAccess(prev => recalculateSoD(prev, sodPolicies));
      return;
    } else if (type === 'APPLICATIONS') {
      const normalizedRows = (Array.isArray(data) ? data : []).map((entry: any) => ({
        ...entry,
        appId: String(entry?.appId ?? entry?.id ?? '').trim(),
        name: String(entry?.name ?? '').trim(),
        appType: normalizeApplicationType(entry?.appType),
        ownerId: String(entry?.ownerId ?? '').trim(),
        ownerAdminId: String(entry?.ownerAdminId ?? '').trim(),
        description: String(entry?.description ?? '')
      }));

      const existingNameToAppId = new Map(
        applications
          .map(app => [String(app.name || '').trim().toLowerCase(), String((app as any).appId || app.id || '').trim()] as const)
          .filter(([nameKey, appKey]) => Boolean(nameKey) && Boolean(appKey))
      );

      const payloadNameToAppId = new Map<string, string>();
      const duplicateErrors: string[] = [];

      normalizedRows.forEach((entry) => {
        const appId = String(entry.appId || '').trim();
        const name = String(entry.name || '').trim();
        const nameKey = name.toLowerCase();
        if (!appId || !nameKey) return;

        const existingAppId = existingNameToAppId.get(nameKey);
        if (existingAppId && existingAppId !== appId) {
          duplicateErrors.push(`'${name}' already exists for appId '${existingAppId}'`);
        }

        const payloadAppId = payloadNameToAppId.get(nameKey);
        if (payloadAppId && payloadAppId !== appId) {
          duplicateErrors.push(`'${name}' is duplicated in import for appIds '${payloadAppId}' and '${appId}'`);
        }

        payloadNameToAppId.set(nameKey, appId);
      });

      if (duplicateErrors.length > 0) {
        alert(`Application Name must be unique.\n${Array.from(new Set(duplicateErrors)).join('\n')}`);
        return;
      }

      await importApplications(normalizedRows);
      const res = await getApplications(100);
      setApplications((res.items ?? []).map(normalizeApplicationRecord));
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

      // Auto-sync entitlement catalog from uploaded accounts (no separate entitlement upload needed).
      const entitlementMap = new Map<string, { entitlement: string; isPrivileged: boolean }>();
      newAccessList.forEach(acc => {
        const key = String(acc.entitlement || '').trim().toUpperCase();
        if (!key) return;
        const current = entitlementMap.get(key);
        entitlementMap.set(key, {
          entitlement: String(acc.entitlement || '').trim(),
          isPrivileged: Boolean((acc as any).isPrivileged) || /admin|root/i.test(String(acc.entitlement || '')) || Boolean(current?.isPrivileged)
        });
      });

      const entitlementPayload = Array.from(entitlementMap.values()).map(item => ({
        entitlement: item.entitlement,
        description: '',
        isPrivileged: item.isPrivileged,
        risk: 'LOW',
        riskScore: '0'
      }));

      if (entitlementPayload.length > 0) {
        await importEntitlements(appId!, entitlementPayload);
      }

      // Reload app entitlement catalog from backend to reflect persisted values.
      const entRes: any = await getEntitlements(appId!, undefined, 500);
      setEntitlements(prev => {
        const otherAppEnts = prev.filter(e => e.appId !== appId);
        return [...otherAppEnts, ...(entRes?.items || [])];
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
              remediatedAt: remediationTimestamp,
              etag: (item as any)?._etag
            })
          )
        );
      }

      const refreshedItemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(refreshedItemsRes?.items)
        ? normalizeReviewItems(refreshedItemsRes.items)
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
        return { ...item, appId: appId!, isPrivileged: isPriv, risk: item.risk || 'LOW', riskScore: item.riskScore || '0' };
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

  const handleLaunchReview = async (
    appId: string,
    dueDateStr?: string,
    certificationType: CertificationType = 'MANAGER',
    riskScope: 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY' = 'ALL_ACCESS',
    orphanReviewerMode: OrphanReviewerMode = 'APPLICATION_OWNER',
    customOrphanReviewerId?: string
  ) => {
    if (currentUser.role !== UserRole.ADMIN) {
      alert('Only Admin can launch certifications.');
      return;
    }
    const targetApp = getApplicationById(appId);
    if (!targetApp) return;
    const normalizedAppId = getApplicationId(targetApp);
    const candidateAppIds = new Set(
      [normalizedAppId, String((targetApp as any)?.appId || ''), String((targetApp as any)?.id || '')]
        .map(v => String(v || '').trim())
        .filter(Boolean)
    );
    const existingActive = cycles.find(c => candidateAppIds.has(String(c.appId || '').trim()) && c.status !== ReviewStatus.COMPLETED && c.status !== ReviewStatus.CANCELLED);
    if (existingActive) { alert(`A campaign for ${targetApp.name} is already running.`); return; }
    const appAccess = access.filter(a => candidateAppIds.has(String(a.appId || '').trim()));
    let hasAccounts = appAccess.length > 0;
    if (!hasAccounts) {
      const backendChecks = await Promise.all(
        Array.from(candidateAppIds).map(async (candidateId) => {
          try {
            const res: any = await getAccounts(candidateId, undefined, undefined, 1);
            return Array.isArray(res?.items) && res.items.length > 0;
          } catch {
            return false;
          }
        })
      );
      hasAccounts = backendChecks.some(Boolean);
    }
    if (!hasAccounts) { alert(`No accounts found for ${targetApp.name}.`); return; }

    setLaunchingReview(true);
    try {
      const now = new Date();
      const dueDate = dueDateStr ? new Date(dueDateStr) : new Date();
      if (!dueDateStr) dueDate.setDate(dueDate.getDate() + 14);

      // Call backend to launch review
      if (!normalizedAppId || typeof normalizedAppId !== 'string' || normalizedAppId.trim().length === 0) {
        throw new Error('No valid appId provided for UAR launch');
      }
      const response = await launchReview(
        {
          appId: normalizedAppId.trim(),
          name: targetApp.name,
          dueDate: dueDate.toISOString(),
          certificationType,
          riskScope,
          orphanReviewerMode,
          customOrphanReviewerId: customOrphanReviewerId ? customOrphanReviewerId.trim() : undefined
        },
        {
          id: currentUser.id,
          name: currentUser.name,
          role: currentUser.role
        }
      );
      await invalidateReviewQueries(response?.cycleId);

      // Refresh cycles and items from backend
      const cyclesRes = await getReviewCycles({ top: 200 });
      const itemsRes = await getReviewItems({ top: 500 });
      console.debug('UAR: cycles after launch', cyclesRes);
      console.debug('UAR: items after launch', itemsRes);
      setCycles(Array.isArray(cyclesRes?.cycles) ? cyclesRes.cycles.map(normalizeCycle) : []);
      setReviewItems(Array.isArray(itemsRes?.items) ? normalizeReviewItems(itemsRes.items) : []);

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
        managerId: item.managerId || currentUser.id,
        status,
        comment,
        etag: (item as any)?._etag
      });
      await invalidateReviewQueries(item.reviewCycleId);
      console.log('[handleAction] actOnItem complete');

      // Refresh items from backend
      console.log('[handleAction] Fetching review items from backend');
      const itemsRes = await getReviewItems({ top: 500 });
      console.log('[handleAction] itemsRes:', itemsRes);
      const mappedItems = Array.isArray(itemsRes?.items)
        ? normalizeReviewItems(itemsRes.items)
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
          {
            const target = reviewItems.find(i => i.id === itemId);
            return actOnItem({
              itemId,
              managerId: target?.managerId || currentUser.id,
              status,
              comment,
              etag: (target as any)?._etag
            });
          }
        )
      );
      const impactedCycleId = reviewItems.find(i => itemIds.includes(i.id))?.reviewCycleId;
      await invalidateReviewQueries(impactedCycleId);

      // Refresh items from backend
      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items)
        ? normalizeReviewItems(itemsRes.items)
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
      const target = reviewItems.find(item => item.id === itemId && item.managerId === fromManagerId);
      await reassignReviewItem({ itemId, managerId: fromManagerId, reassignToManagerId: toManagerId, comment, etag: (target as any)?._etag });
      await invalidateReviewQueries(target?.reviewCycleId);
      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? normalizeReviewItems(itemsRes.items) : []);
      await addAuditLog('ITEM_REASSIGN', `Reassigned review item ${itemId} from ${fromManagerId} to ${toManagerId}`);
    } catch (e: any) {
      console.error('Failed to reassign review item:', e);
      alert(`Failed to reassign item: ${e?.message || 'Unknown error'}`);
    }
  };

  const handleBulkReassignReviewItems = async (itemsToReassign: Array<{ itemId: string; fromManagerId: string }>, toManagerId: string, comment?: string) => {
    try {
      const payload = {
        items: itemsToReassign.map(item => {
          const target = reviewItems.find(existing => existing.id === item.itemId && existing.managerId === item.fromManagerId);
          return {
            itemId: item.itemId,
            managerId: item.fromManagerId,
            etag: (target as any)?._etag
          };
        }),
        reassignToManagerId: toManagerId,
        comment
      };
      const bulkResult: any = await reassignReviewItemsBulk(payload);
      const impactedCycleId = reviewItems.find(existing => itemsToReassign.some(x => x.itemId === existing.id))?.reviewCycleId;
      await invalidateReviewQueries(impactedCycleId);

      const successCount = Number(bulkResult?.successCount || 0);
      const failedCount = Number(bulkResult?.failedCount || 0);

      const itemsRes = await getReviewItems({ top: 500 });
      setReviewItems(Array.isArray(itemsRes?.items) ? normalizeReviewItems(itemsRes.items) : []);

      await addAuditLog('ITEM_REASSIGN_BULK', `Bulk reassigned ${successCount}/${itemsToReassign.length} items to ${toManagerId}`);

      if (failedCount > 0) {
        const firstFailure = bulkResult?.results?.find((result: any) => !result?.ok)?.error || 'Unknown error';
        alert(`Bulk reassignment completed with partial failures. Success: ${successCount}, Failed: ${failedCount}. First error: ${firstFailure}`);
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
    const parseDetailValue = (details: string, key: string): string => {
      const safe = String(details || '');
      const pattern = new RegExp(`${key}=([^;]+)`);
      const match = safe.match(pattern);
      return match?.[1]?.trim() || '';
    };

    const headers = ['Timestamp', 'User Name', 'User ID', 'Action', 'Details', 'Cycle ID', 'Pending Confirmation Count', 'Pending Confirmation Reviewers'];
    const csvContent = [
      headers.join(','),
      ...filteredAuditLogs.map(l => {
        const cycleId = parseDetailValue(l.details, 'cycleId');
        const appId = parseDetailValue(l.details, 'appId');

        let pendingConfirmationReviewers = '';
        let pendingConfirmationCount = 0;

        if (cycleId) {
          const matchedCycle = cycles.find(cycle => cycle.id === cycleId || cycle.cycleId === cycleId);
          const managersInCycle = Array.from(new Set(
            reviewItems
              .filter(item => item.reviewCycleId === cycleId && (!appId || item.appId === appId))
              .map(item => String(item.managerId || '').trim())
              .filter(Boolean)
          ));
          const confirmedManagers = new Set((matchedCycle?.confirmedManagers || []).map(id => String(id)));
          const pendingManagers = managersInCycle.filter(managerId => !confirmedManagers.has(managerId));

          pendingConfirmationCount = pendingManagers.length;
          pendingConfirmationReviewers = pendingManagers
            .map(managerId => {
              const user = users.find(u => u.id === managerId);
              return `${user?.name || managerId} (${managerId})`;
            })
            .join('; ');
        }

        return [
          `"${new Date(l.timestamp).toLocaleString()}"`,
          `"${l.userName}"`,
          `"${l.userId}"`,
          `"${l.action}"`,
          `"${l.details.replace(/"/g, '""')}"`,
          `"${cycleId}"`,
          `"${pendingConfirmationCount}"`,
          `"${pendingConfirmationReviewers.replace(/"/g, '""')}"`
        ].join(',');
      })
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
      const items = await loadAllHrUsers();
      setUsers(items);
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
      const payload = {
        ...app,
        appType: normalizeApplicationType(app.appType),
        ownerAdminIds: Array.from(new Set(parseDelimitedValues(app.ownerAdminIds).concat(parseDelimitedValues(app.ownerAdminId)))),
        ownerAdminTeams: Array.from(new Set(parseDelimitedValues(app.ownerAdminTeams))),
        ownerAdminId: String(app.ownerAdminId || parseDelimitedValues(app.ownerAdminIds)[0] || '').trim(),
        accountSchema: app.accountSchema || buildDefaultAccountSchema(normalizeApplicationType(app.appType))
      };
      const res = await importApplications([payload]);
      if (!res?.ok) {
        console.error('Create application failed:', res);
        window.alert(res?.error || 'Failed to create application. See console for details.');
        return;
      }
      const refreshed = await getApplications(100);
      setApplications((refreshed.items ?? []).map(normalizeApplicationRecord));
      await addAuditLog('APP_CREATE', `Created application ${app.name} (${app.id})`);
    } catch (err: any) {
      console.error('Create application error:', err);
      window.alert(err?.message || 'Failed to create application. See console for details.');
    }
  };

  const updateApplication = async (app: Application) => {
    try {
      const existing = applications.find((candidate: any) => {
        const candidateId = String(candidate?.id ?? '').trim();
        const candidateAppId = String(candidate?.appId ?? '').trim();
        const targetId = String(app?.id ?? '').trim();
        const targetAppId = String((app as any)?.appId ?? '').trim();
        return candidateId === targetId || candidateAppId === targetId || (targetAppId && candidateId === targetAppId) || (targetAppId && candidateAppId === targetAppId);
      });

      const payload = {
        ...app,
        appType: normalizeApplicationType(app.appType),
        ownerAdminIds: Array.from(new Set(parseDelimitedValues(app.ownerAdminIds).concat(parseDelimitedValues(app.ownerAdminId)))),
        ownerAdminTeams: Array.from(new Set(parseDelimitedValues(app.ownerAdminTeams))),
        ownerAdminId: String(app.ownerAdminId || parseDelimitedValues(app.ownerAdminIds)[0] || '').trim(),
        accountSchema: app.accountSchema || buildDefaultAccountSchema(normalizeApplicationType(app.appType))
      };
      const res = await importApplications([payload]);
      if (!res?.ok) {
        console.error('Update application failed:', res);
        window.alert(res?.error || 'Failed to update application configuration.');
        return;
      }
      const refreshed = await getApplications(100);
      setApplications((refreshed.items ?? []).map(normalizeApplicationRecord));

      const beforeAfterPairs: Array<[string, any, any]> = [
        ['name', existing?.name, payload.name],
        ['description', existing?.description, payload.description],
        ['appType', existing?.appType, payload.appType],
        ['ownerId', existing?.ownerId, payload.ownerId],
        ['ownerAdminId', (existing as any)?.ownerAdminId, (payload as any)?.ownerAdminId],
        ['ownerAdminIds', (existing as any)?.ownerAdminIds, (payload as any)?.ownerAdminIds],
        ['ownerAdminTeams', (existing as any)?.ownerAdminTeams, (payload as any)?.ownerAdminTeams],
        ['serverHost', (existing as any)?.serverHost, (payload as any)?.serverHost],
        ['serverHostName', (existing as any)?.serverHostName, (payload as any)?.serverHostName],
        ['serverEnvironment', (existing as any)?.serverEnvironment, (payload as any)?.serverEnvironment]
      ];

      const changes = beforeAfterPairs
        .filter(([, before, after]) => String(before ?? '').trim() !== String(after ?? '').trim())
        .map(([field, before, after]) => `${field}: '${String(before ?? '').trim() || '-'}' -> '${String(after ?? '').trim() || '-'}'`);

      const detail = changes.length > 0
        ? `Updated application ${payload.name} (${payload.id}). ${changes.join('; ')}`
        : `Updated application ${payload.name} (${payload.id}). No field-level changes detected.`;

      await addAuditLog('APP_UPDATE', detail);
    } catch (err: any) {
      console.error('Update application error:', err);
      window.alert(err?.message || 'Failed to update application configuration.');
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

  if (!sessionHydrated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <p className="text-sm text-slate-500">Loading session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{customization.platformName} Login</h1>
            <p className="text-sm text-slate-500 mt-1">{customization.loginSubtitle}</p>
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
              style={{
                backgroundColor: customization.primaryColor,
                color: getOnPrimaryTextColor(customization.primaryColor, DEFAULT_CUSTOMIZATION.primaryColor)
              }}
              className="w-full px-4 py-2.5 rounded-lg text-white font-semibold transition-colors"
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

            <button
              type="button"
              onClick={() => {
                setShowFirstUserSetup(prev => !prev);
                setSetupError(null);
                setSetupSuccess(null);
                if (!setupEmail) setSetupEmail(loginEmail.trim().toLowerCase());
              }}
              className="w-full text-sm text-slate-700 hover:text-slate-900 font-semibold"
            >
              {showFirstUserSetup ? 'Hide First-Time Setup' : 'First-Time Setup: Create Admin User'}
            </button>

            {showFirstUserSetup && (
              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                <p className="text-xs text-slate-600">
                  Use this only once to create the first admin user when no users exist.
                </p>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">User Id</label>
                  <input
                    type="text"
                    value={setupUserId}
                    onChange={(event) => setSetupUserId(event.target.value)}
                    placeholder="ADM001"
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Name</label>
                  <input
                    type="text"
                    value={setupName}
                    onChange={(event) => setSetupName(event.target.value)}
                    placeholder="Admin User"
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Email Id</label>
                  <input
                    type="email"
                    value={setupEmail}
                    onChange={(event) => setSetupEmail(event.target.value)}
                    placeholder="name@company.com"
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Password</label>
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">Confirm Password</label>
                  <input
                    type="password"
                    value={setupConfirmPassword}
                    onChange={(event) => setSetupConfirmPassword(event.target.value)}
                    placeholder="Re-enter password"
                    className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                {setupError && <p className="text-sm text-red-600">{setupError}</p>}
                {setupSuccess && <p className="text-sm text-emerald-600">{setupSuccess}</p>}

                <button
                  type="button"
                  onClick={handleBootstrapFirstUser}
                  disabled={settingUpFirstUser}
                  className="w-full px-4 py-2.5 rounded-lg bg-slate-800 text-white font-semibold hover:bg-slate-900 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed"
                >
                  {settingUpFirstUser ? 'Creating Admin User...' : 'Create First Admin User'}
                </button>
              </div>
            )}
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
    <Layout
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      currentUser={currentUser}
      onLogout={handleLogout}
      customization={customization}
      onSaveCustomization={handleSaveCustomization}
    >
      {activeTab === 'dashboard' && <Dashboard cycles={cycles} applications={applications} access={access} onLaunch={handleLaunchReview} reviewItems={reviewItems} users={users} sodPolicies={sodPolicies} isAdmin={currentUser.role === UserRole.ADMIN} onReassign={handleReassignReviewItem} onBulkReassign={handleBulkReassignReviewItems} onSendNotifications={handleSendReviewNotifications} onCancelCampaign={handleCancelCampaign} />}
      {activeTab === 'my-team-access' && <MyTeamAccess currentManagerId={currentUser.id} users={users} access={access} applications={applications} entitlements={entitlements} sodPolicies={sodPolicies} />}
      {activeTab === 'inventory' && (
  <Inventory
    users={users}
    access={access}
    applications={applications}
    entitlements={entitlements}
    sodPolicies={sodPolicies}
    customization={customization}
    onSetUserRole={handleSetUserRole}
    onBulkSetUserRole={handleBulkSetUserRole}
    onResetUserPassword={handleResetUserPassword}
    onSelectApp={setSelectedAppId}         // <-- add this if Inventory can drive selection
    onDataImport={handleDataImport}
    onAddApp={app => { createApplication(app); }}
    onUpdateApp={app => { updateApplication(app); }}
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
            return cycle?.status !== ReviewStatus.COMPLETED && cycle?.status !== ReviewStatus.CANCELLED;
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