
import React, { useState, useMemo, useEffect } from 'react';
import { ReviewCycle, ReviewStatus, Application, ReviewItem, ActionStatus, User, SoDPolicy, ApplicationAccess, CertificationType, OrphanReviewerMode } from '../types';
import { Calendar, CheckCircle, Clock, Play, FileDown, MoreVertical, X, Boxes, Eye, Search, UserCheck, AlertCircle, ShieldCheck, History, Shield, AlertTriangle, ChevronRight, ShieldAlert, Filter, Activity, Lock, Archive, CheckCircle2, FileSpreadsheet, Send, CheckSquare, Square } from 'lucide-react';
import { useReviewCycleDetail } from '../features/reviews/queries';
import { APP_TYPE_SCHEMA_TEMPLATES } from '../constants';
import ModalShell from './ModalShell';

interface DashboardProps {
  cycles: ReviewCycle[];
  applications: Application[];
  access: ApplicationAccess[];
  onLaunch: (
    appId: string,
    dueDate?: string,
    certificationType?: CertificationType,
    riskScope?: 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY',
    orphanReviewerMode?: OrphanReviewerMode,
    customOrphanReviewerId?: string
  ) => void;
  reviewItems: ReviewItem[];
  users: User[];
  sodPolicies: SoDPolicy[];
  isAdmin?: boolean;
  onReassign?: (itemId: string, fromManagerId: string, toManagerId: string, comment?: string) => void;
  onBulkReassign?: (itemsToReassign: Array<{ itemId: string; fromManagerId: string }>, toManagerId: string, comment?: string) => void;
  onSendNotifications?: (payload: { mode: 'REMINDER' | 'ESCALATE' | 'REMEDIATION_NOTIFY' | 'REMEDIATION_REMINDER'; cycleId?: string; appId?: string; managerId?: string; selectedRecipientEmail?: string; dryRun?: boolean }) => Promise<any>;
  onCancelCampaign?: (cycleId: string, reason: string) => Promise<void> | void;
}

const Dashboard: React.FC<DashboardProps> = ({ cycles, applications, access, onLaunch, reviewItems, users, sodPolicies, isAdmin = false, onReassign, onBulkReassign, onSendNotifications, onCancelCampaign }) => {
  const [showLaunchModal, setShowLaunchModal] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [launchDueDate, setLaunchDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split('T')[0];
  });
  const [launchSelectedAppType, setLaunchSelectedAppType] = useState<'ALL' | NonNullable<Application['appType']>>('ALL');
  const [launchCertificationType, setLaunchCertificationType] = useState<CertificationType>('MANAGER');
  const [launchSelectedAppName, setLaunchSelectedAppName] = useState('');
  const [launchRiskScope, setLaunchRiskScope] = useState<'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY'>('ALL_ACCESS');
  const [launchOrphanReviewerMode, setLaunchOrphanReviewerMode] = useState<OrphanReviewerMode>('APPLICATION_OWNER');
  const [launchCustomOrphanReviewerId, setLaunchCustomOrphanReviewerId] = useState('');

  const [dashboardAppFilter, setDashboardAppFilter] = useState('ALL');
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState('ALL');
  const [dashboardRiskScopeFilter, setDashboardRiskScopeFilter] = useState<'ALL' | 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY'>('ALL');

  // Campaign Detail Filters (Modal)
  const [campaignUserFilter, setCampaignUserFilter] = useState('ALL');
  const [campaignEntitlementFilter, setCampaignEntitlementFilter] = useState('ALL');
  const [campaignStatusFilter, setCampaignStatusFilter] = useState('ALL');
  const [campaignRemediationFilter, setCampaignRemediationFilter] = useState('ALL');
  const [campaignRiskFilter, setCampaignRiskFilter] = useState('ALL');
  const [campaignRiskFactorFilter, setCampaignRiskFactorFilter] = useState('ALL');

  const isTerminatedRisk = (entry: { isTerminated?: boolean; hrStatus?: string }) => {
    return entry.isTerminated === true || String(entry.hrStatus || '').trim().toUpperCase() === 'TERMINATED';
  };
  
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);
  const [reassignModal, setReassignModal] = useState<{ itemId: string; fromManagerId: string; appUserId: string } | null>(null);
  const [reassignSearch, setReassignSearch] = useState('');
  const [reassignToManagerId, setReassignToManagerId] = useState('');
  const [reassignComment, setReassignComment] = useState('');
  const [selectedCampaignItems, setSelectedCampaignItems] = useState<string[]>([]);
  const [showBulkReassignModal, setShowBulkReassignModal] = useState(false);
  const [bulkReassignSearch, setBulkReassignSearch] = useState('');
  const [bulkReassignToManagerId, setBulkReassignToManagerId] = useState('');
  const [bulkReassignComment, setBulkReassignComment] = useState('');
  const [sendingNotificationMode, setSendingNotificationMode] = useState<null | 'REMINDER' | 'ESCALATE' | 'REMEDIATION_NOTIFY' | 'REMEDIATION_REMINDER'>(null);
  const [selectedRemediationRecipientId, setSelectedRemediationRecipientId] = useState('');
  const [cancellingCampaignId, setCancellingCampaignId] = useState<string | null>(null);
  const [viewingAccountItemId, setViewingAccountItemId] = useState<string | null>(null);
  const maxReassignments = Math.max(Number(import.meta.env.VITE_MAX_REASSIGNMENTS || 3), 1);
  const cycleDetailQuery = useReviewCycleDetail({ cycleId: selectedCampaignId || '', top: 500 });

  useEffect(() => {
    setSelectedCampaignItems([]);
  }, [selectedCampaignId]);

  const isClosedCycle = (status?: ReviewStatus) => status === ReviewStatus.COMPLETED || status === ReviewStatus.CANCELLED;

  const activeCyclesList = useMemo(() => {
    return cycles.filter(c => !isClosedCycle(c.status))
      .filter(c => dashboardAppFilter === 'ALL' || c.appId === dashboardAppFilter)
      .filter(c => dashboardRiskScopeFilter === 'ALL' || (c.riskScope || 'ALL_ACCESS') === dashboardRiskScopeFilter)
      .filter(c => dashboardStatusFilter === 'ALL' || c.status === dashboardStatusFilter);
  }, [cycles, dashboardAppFilter, dashboardRiskScopeFilter, dashboardStatusFilter]);

  const archivedCyclesList = useMemo(() => {
    return cycles.filter(c => isClosedCycle(c.status))
      .filter(c => dashboardAppFilter === 'ALL' || c.appId === dashboardAppFilter)
      .filter(c => dashboardRiskScopeFilter === 'ALL' || (c.riskScope || 'ALL_ACCESS') === dashboardRiskScopeFilter);
  }, [cycles, dashboardAppFilter, dashboardRiskScopeFilter]);

  const launchApplicationsSorted = useMemo(() => {
    return [...applications].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [applications]);

  const launchApplicationTypeOptions = useMemo(() => {
    return ['Application', 'Database', 'Servers', 'Shared Mailbox', 'Shared Folder'] as Array<NonNullable<Application['appType']>>;
  }, []);

  const launchApplicationsFiltered = useMemo(() => {
    return launchApplicationsSorted.filter((app) => launchSelectedAppType === 'ALL' || (app.appType || 'Application') === launchSelectedAppType);
  }, [launchApplicationsSorted, launchSelectedAppType]);

  const viewingItems = useMemo(() => {
    if (!selectedCampaignId) return [];
    const serverItems = Array.isArray(cycleDetailQuery.data?.items) ? cycleDetailQuery.data.items : [];
    if (serverItems.length > 0) return serverItems as ReviewItem[];
    return reviewItems.filter(i => i.reviewCycleId === selectedCampaignId);
  }, [reviewItems, selectedCampaignId, cycleDetailQuery.data]);

  const uniqueUsersInCampaign = useMemo(() => Array.from(new Set(viewingItems.map(i => i.userName))).sort(), [viewingItems]);
  const uniqueEntsInCampaign = useMemo(() => Array.from(new Set(viewingItems.map(i => i.entitlement))).sort(), [viewingItems]);

  const getRiskScopeLabel = (riskScope?: ReviewCycle['riskScope']) => {
    if (riskScope === 'SOD_ONLY') return 'SoD Conflicts Only';
    if (riskScope === 'PRIVILEGED_ONLY') return 'Privileged Access Only';
    if (riskScope === 'ORPHAN_ONLY') return 'Orphan Accounts Only';
    return 'All Access';
  };

  const getRiskLevel = (item: ReviewItem) => {
    if (item.isSoDConflict) return 'CRITICAL';
    if (item.isOrphan || isTerminatedRisk(item)) return 'HIGH';
    if (item.isPrivileged) return 'MEDIUM';
    return 'LOW';
  };

  const filteredViewingItems = useMemo(() => {
    return viewingItems.filter(i => {
      const matchesUser = campaignUserFilter === 'ALL' || i.userName === campaignUserFilter;
      const matchesEnt = campaignEntitlementFilter === 'ALL' || i.entitlement === campaignEntitlementFilter;
      const matchesStatus = campaignStatusFilter === 'ALL' || i.status === campaignStatusFilter;
      const remStatus = i.status === ActionStatus.REMEDIATED ? 'VERIFIED' : i.status === ActionStatus.REVOKED ? 'PENDING' : 'N/A';
      const matchesRem = campaignRemediationFilter === 'ALL' || remStatus === campaignRemediationFilter;
      const level = getRiskLevel(i);
      const matchesRisk = campaignRiskFilter === 'ALL' || level === campaignRiskFilter;
      const hasAnyRiskFactor = i.isSoDConflict || i.isPrivileged || i.isOrphan || isTerminatedRisk(i);
      const matchesRiskFactor = campaignRiskFactorFilter === 'ALL' ||
        (campaignRiskFactorFilter === 'SOD' && i.isSoDConflict) ||
        (campaignRiskFactorFilter === 'PRIVILEGED' && i.isPrivileged) ||
        (campaignRiskFactorFilter === 'ORPHAN' && i.isOrphan) ||
        (campaignRiskFactorFilter === 'TERMINATED' && isTerminatedRisk(i)) ||
        (campaignRiskFactorFilter === 'NONE' && !hasAnyRiskFactor);
      return matchesUser && matchesEnt && matchesStatus && matchesRem && matchesRisk && matchesRiskFactor;
    });
  }, [viewingItems, campaignUserFilter, campaignEntitlementFilter, campaignStatusFilter, campaignRemediationFilter, campaignRiskFilter, campaignRiskFactorFilter]);

  const selectedCampaign = cycles.find(c => c.id === selectedCampaignId);
  const viewingAccountItem = useMemo(() => {
    if (!viewingAccountItemId) return null;
    return filteredViewingItems.find((item) => item.id === viewingAccountItemId) || viewingItems.find((item) => item.id === viewingAccountItemId) || null;
  }, [filteredViewingItems, viewingItems, viewingAccountItemId]);
  const viewingAccountEntries = useMemo(() => {
    if (!viewingAccountItem) return [] as ApplicationAccess[];
    const targetAppIds = new Set([
      String(viewingAccountItem.appId || '').trim(),
      String(selectedCampaign?.appId || '').trim()
    ].filter(Boolean));
    return access.filter((entry) => {
      const entryAppId = String(entry.appId || '').trim();
      if (targetAppIds.size > 0 && !targetAppIds.has(entryAppId)) return false;
      return String(entry.userId || '').trim() === String(viewingAccountItem.appUserId || '').trim();
    });
  }, [access, viewingAccountItem, selectedCampaign]);
  const viewingAccountApp = useMemo(() => {
    const targetAppIds = [String(viewingAccountItem?.appId || '').trim(), String(selectedCampaign?.appId || '').trim()].filter(Boolean);
    return applications.find((app) => targetAppIds.includes(String((app as any).appId || app.id || '').trim()));
  }, [applications, viewingAccountItem, selectedCampaign]);
  const pendingConfirmationReviewerIds = useMemo(() => {
    if (!selectedCampaign) return [] as string[];
    const confirmed = new Set((selectedCampaign.confirmedManagers || []).map(id => String(id)));
    const allManagers = Array.from(new Set(viewingItems.map(item => String(item.managerId || '').trim()).filter(Boolean)));
    return allManagers.filter(managerId => !confirmed.has(managerId));
  }, [selectedCampaign, viewingItems]);
  const pendingConfirmationReviewers = useMemo(() => {
    return pendingConfirmationReviewerIds.map((managerId) => {
      const user = users.find((entry) => entry.id === managerId);
      return {
        managerId,
        name: user?.name || managerId,
        email: user?.email || ''
      };
    });
  }, [pendingConfirmationReviewerIds, users]);
  const pendingReviewItemCount = useMemo(() => viewingItems.filter((item) => item.status === ActionStatus.PENDING).length, [viewingItems]);
  const isConfirmationPending = useMemo(() => {
    if (!selectedCampaign) return false;
    if (isClosedCycle(selectedCampaign.status)) return false;
    return pendingReviewItemCount === 0 && pendingConfirmationReviewers.length > 0;
  }, [selectedCampaign, pendingReviewItemCount, pendingConfirmationReviewers.length]);

  const reassignmentCandidates = useMemo(() => {
    if (!reassignModal) return [];
    const term = reassignSearch.trim().toLowerCase();
    return users
      .filter(user => user.id !== reassignModal.appUserId)
      .filter(user => {
        if (!term) return true;
        const blob = `${user.id} ${user.name} ${user.email}`.toLowerCase();
        return blob.includes(term);
      });
  }, [users, reassignModal, reassignSearch]);

  const submitReassignment = () => {
    if (!reassignModal || !onReassign) return;
    const targetManagerId = String(reassignToManagerId || '').trim();
    if (!targetManagerId) {
      alert('Select a reviewer to reassign.');
      return;
    }
    if (targetManagerId === reassignModal.appUserId) {
      alert('Reviewer cannot be the same user whose access is being reviewed.');
      return;
    }
    onReassign(reassignModal.itemId, reassignModal.fromManagerId, targetManagerId, reassignComment.trim());
    setReassignModal(null);
    setReassignSearch('');
    setReassignToManagerId('');
    setReassignComment('');
  };

  const bulkReassignmentCandidates = useMemo(() => {
    if (!showBulkReassignModal) return [];
    const term = bulkReassignSearch.trim().toLowerCase();
    return users.filter(user => {
      if (!term) return true;
      const blob = `${user.id} ${user.name} ${user.email}`.toLowerCase();
      return blob.includes(term);
    });
  }, [users, showBulkReassignModal, bulkReassignSearch]);

  const selectableCampaignItems = useMemo(() => {
    if (!isAdmin || !onBulkReassign) return [];
    if (isClosedCycle(selectedCampaign?.status)) return [];
    return filteredViewingItems.filter(item => item.status === ActionStatus.PENDING && Number(item.reassignmentCount || 0) < maxReassignments);
  }, [filteredViewingItems, isAdmin, onBulkReassign, selectedCampaign, maxReassignments]);

  const selectedCampaignItemObjects = useMemo(() => {
    return selectedCampaignItems
      .map(itemId => filteredViewingItems.find(i => i.id === itemId))
      .filter(Boolean) as ReviewItem[];
  }, [selectedCampaignItems, filteredViewingItems]);

  const selectedSkippedByLimitCount = useMemo(() => {
    return selectedCampaignItemObjects.filter(i => Number(i.reassignmentCount || 0) >= maxReassignments).length;
  }, [selectedCampaignItemObjects, maxReassignments]);

  const submitBulkReassignment = () => {
    if (!onBulkReassign) return;
    const targetManagerId = String(bulkReassignToManagerId || '').trim();
    if (!targetManagerId) {
      alert('Select a reviewer to reassign.');
      return;
    }
    if (selectedCampaignItemObjects.length === 0) {
      alert('Select items to reassign.');
      return;
    }

    const selfReviewConflicts = selectedCampaignItemObjects.filter(i => String(i.appUserId).trim() === targetManagerId).length;
    if (selfReviewConflicts > 0) {
      alert(`Cannot bulk reassign. ${selfReviewConflicts} selected item(s) would assign reviewer to the same user being reviewed.`);
      return;
    }

    onBulkReassign(
      selectedCampaignItemObjects.map(item => ({ itemId: item.id, fromManagerId: item.managerId })),
      targetManagerId,
      bulkReassignComment.trim()
    );

    if (selectedSkippedByLimitCount > 0) {
      alert(`Submitted reassignment for ${selectedCampaignItemObjects.length - selectedSkippedByLimitCount} item(s). Skipped ${selectedSkippedByLimitCount} item(s) because max reassignment limit (${maxReassignments}) is reached.`);
    }

    setShowBulkReassignModal(false);
    setBulkReassignSearch('');
    setBulkReassignToManagerId('');
    setBulkReassignComment('');
    setSelectedCampaignItems([]);
  };

  const exportCampaignDetail = () => {
    if (!selectedCampaign) return;
    const confirmedManagerIds = new Set((selectedCampaign.confirmedManagers || []).map((id) => String(id)));
    const headers = ['User', 'Account ID', 'Entitlement', 'Reviewer', 'Reviewer ID', 'Reviewer Confirmation', 'Pending With Reviewer', 'Reassigned By', 'Reassigned At', 'Reassign Count', 'Decision', 'Decision Date', 'Remediation Date', 'Justification', 'Risks'];
    const csvContent = [
      headers.join(','),
      ...viewingItems.map(i => {
        const reviewer = users.find(u => u.id === i.managerId)?.name || i.managerId;
        const reviewerId = String(i.managerId || '');
        const isReviewerConfirmed = confirmedManagerIds.has(reviewerId);
        const reviewerConfirmation = isReviewerConfirmed ? 'Confirmed' : 'Pending Confirmation';
        const pendingWithReviewer = isReviewerConfirmed ? '' : `${reviewer} (${reviewerId})`;
        const reassignedBy = i.reassignedBy ? (users.find(u => u.id === i.reassignedBy)?.name || i.reassignedBy) : '';
        const risks = [
          i.isSoDConflict ? `SoD Conflict (${(i.violatedPolicyNames || []).join(';')})` : '',
          i.isOrphan ? 'Orphan Account' : '',
          isTerminatedRisk(i) ? 'Dormant Account' : '',
          i.isPrivileged ? 'Privileged Access' : ''
        ].filter(Boolean).join('; ');
        return [
          `"${i.userName}"`,
          `"${i.appUserId}"`,
          `"${i.entitlement}"`,
          `"${reviewer}"`,
          `"${reviewerId}"`,
          `"${reviewerConfirmation}"`,
          `"${pendingWithReviewer}"`,
          `"${reassignedBy}"`,
          `"${i.reassignedAt || ''}"`,
          `"${i.reassignmentCount || ''}"`,
          `"${i.status}"`,
          `"${i.actionedAt || ''}"`,
          `"${i.remediatedAt || ''}"`,
          `"${(i.comment || '').replace(/"/g, '""')}"`,
          `"${risks}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Campaign_Detail_${selectedCampaign.name.replace(/\s/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendNotifications = async (mode: 'REMINDER' | 'ESCALATE' | 'REMEDIATION_NOTIFY' | 'REMEDIATION_REMINDER') => {
    if (!onSendNotifications || !selectedCampaign) return;
    setSendingNotificationMode(mode);
    try {
      const selectedRecipientEmail = users.find(u => u.id === selectedRemediationRecipientId)?.email || undefined;
      const result: any = await onSendNotifications({ mode, cycleId: selectedCampaign.id, appId: selectedCampaign.appId, selectedRecipientEmail });
      const modeLabel = mode === 'REMINDER'
        ? 'Reminder'
        : mode === 'ESCALATE'
          ? 'Escalation'
          : mode === 'REMEDIATION_NOTIFY'
            ? 'Remediation notification'
            : 'Remediation reminder';
      alert(`${modeLabel} completed. Sent: ${result?.sent ?? 0}, Skipped: ${result?.skipped ?? 0}`);
    } catch (error: any) {
      const modeLabel = mode === 'REMINDER'
        ? 'reminders'
        : mode === 'ESCALATE'
          ? 'escalations'
          : mode === 'REMEDIATION_NOTIFY'
            ? 'remediation notifications'
            : 'remediation reminders';
      alert(`Failed to send ${modeLabel}: ${error?.message || 'Unknown error'}`);
    } finally {
      setSendingNotificationMode(null);
    }
  };

  const getAccountDetailPairs = (entry: Record<string, any>, app?: Application | null) => {
    const hiddenKeys = new Set([
      'id',
      '_rid',
      '_self',
      '_etag',
      '_attachments',
      '_ts',
      'type',
      'appId',
      'appName',
      'userId',
      'userName',
      'managerId',
      'entitlement',
      'isOrphan',
      'isPrivileged',
      'isSoDConflict',
      'violatedPolicyIds',
      'violatedPolicyNames',
      'reviewCycleId',
      'status',
      'comment',
      'createdAt',
      'actionedAt',
      'remediatedAt',
      'reassignedBy',
      'reassignedAt',
      'reassignmentCount',
      'appUserId',
      'updatedAt',
      'correlation',
      'sod',
      'customAttributes'
    ]);
    const normalizedEntry = { ...(entry || {}) } as Record<string, any>;
    const customAttributes = (normalizedEntry.customAttributes && typeof normalizedEntry.customAttributes === 'object')
      ? normalizedEntry.customAttributes as Record<string, any>
      : {};

    const formatAccountDetailLabel = (key: string): string => {
      const explicitLabels: Record<string, string> = {
        appId: 'App ID',
        userId: 'User ID',
        userName: 'User Name',
        appUserId: 'App User ID',
        correlatedUserId: 'Correlated User ID',
        isOrphan: 'Is Orphan',
        isPrivileged: 'Is Privileged',
        isSoDConflict: 'SoD Conflict',
        isTerminated: 'Dormant Account Risk',
        hrStatus: 'HR Status',
        violatedPolicyIds: 'SoD Policy IDs',
        violatedPolicyNames: 'SoD Policies',
        createdAt: 'Created At',
        updatedAt: 'Updated At',
        accountStatus: 'Account Status',
        lastLoginDetails: 'Last Login Details',
        createDate: 'Create Date',
        userType: 'User Type',
        displayName: 'Display Name'
      };
      if (explicitLabels[key]) return explicitLabels[key];

      return key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((part) => {
          const upper = part.toUpperCase();
          if (upper === 'ID' || upper === 'SOD' || upper === 'HR') return upper;
          return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
        })
        .join(' ');
    };

    const formatAccountDetailValue = (value: any): string => {
      if (value === undefined || value === null) return '';
      if (Array.isArray(value)) {
        return value
          .map((item) => formatAccountDetailValue(item))
          .filter(Boolean)
          .join(', ');
      }
      if (typeof value === 'object') {
        return Object.entries(value)
          .map(([nestedKey, nestedValue]) => {
            const formatted = formatAccountDetailValue(nestedValue);
            return formatted ? `${formatAccountDetailLabel(nestedKey)}: ${formatted}` : '';
          })
          .filter(Boolean)
          .join(' | ');
      }
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      return String(value).trim();
    };

    const normalizeDetailToken = (value: string): string => {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[_\s-]+/g, '');
    };

    const schemaAppType = app?.accountSchema?.schemaAppType || app?.appType || 'Application';
    const template = APP_TYPE_SCHEMA_TEMPLATES[schemaAppType] || APP_TYPE_SCHEMA_TEMPLATES.Application;
    const mappings = app?.accountSchema?.mappings || {};
    const configuredFieldKeysToHide = new Set([
      'loginId',
      'role',
      'accountOwnerName',
      'loginName',
      'dbRole',
      'userDetails',
      'userId',
      'userName',
      'privilegeLevel',
      'ids',
      'displayName',
      'mailboxAccess',
      'folderAccess'
    ]);
    const storageKeyByField: Record<string, string> = {
      email: 'email',
      employeeId: 'employeeId',
      lastLoginAt: 'lastLoginDetails',
      accountStatus: 'accountStatus',
      userType: 'userType',
      createDate: 'createDate',
      displayName: 'displayName'
    };
    const fieldPriority: Record<string, number> = {
      email: 10,
      employeeId: 20,
      userType: 30,
      accountStatus: 40,
      lastLoginAt: 50,
      createDate: 60
    };
    const fallbackLabelPriority: Record<string, number> = {
      'Email': 10,
      'E-mail ID': 10,
      'Email Id': 10,
      'Employee ID': 20,
      'User Type': 30,
      'Account Status': 40,
      'Last Login Details': 50,
      'Create Date': 60,
      'Created At': 70,
      'Updated At': 80
    };

    const resolveConfiguredFieldValue = (fieldKey: string) => {
      const configuredColumn = String(mappings[fieldKey] || '').trim();
      const storageKey = storageKeyByField[fieldKey] || fieldKey;

      const candidates = [
        normalizedEntry[storageKey],
        normalizedEntry[fieldKey],
        configuredColumn ? normalizedEntry[configuredColumn] : undefined,
        configuredColumn ? customAttributes[configuredColumn] : undefined,
        customAttributes[storageKey],
        customAttributes[fieldKey]
      ];

      const match = candidates.find((value) => formatAccountDetailValue(value) !== '');
      return formatAccountDetailValue(match);
    };

    const mappedColumns = new Set(
      Object.values(mappings)
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const configuredStorageKeys = new Set(
      template.fields.flatMap((field) => {
        const configuredColumn = String(mappings[field.key] || '').trim();
        const storageKey = storageKeyByField[field.key] || field.key;
        return [field.key, storageKey, configuredColumn].filter(Boolean);
      })
    );

    const configuredPairs = template.fields
      .filter((field) => !configuredFieldKeysToHide.has(field.key))
      .map((field) => {
        const configuredLabel = String(mappings[field.key] || '').trim();
        const label = configuredLabel || field.label;
        const value = resolveConfiguredFieldValue(field.key);
        return value ? ({ label, value, priority: fieldPriority[field.key] ?? 999, sortKey: label.toLowerCase() }) : null;
      })
      .filter((pair): pair is { label: string; value: string; priority: number; sortKey: string } => Boolean(pair))
      .sort((a, b) => a.priority - b.priority || a.sortKey.localeCompare(b.sortKey))
      .map((pair) => [pair.label, pair.value] as [string, string]);

    const customColumns = Array.isArray(app?.accountSchema?.customColumns)
      ? app!.accountSchema!.customColumns!.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    const usedNormalizedLabels = new Set(configuredPairs.map(([label]) => normalizeDetailToken(label)));

    const customPairs = customColumns
      .map((column) => {
        if (mappedColumns.has(column) || usedNormalizedLabels.has(normalizeDetailToken(column))) return null;
        const value = formatAccountDetailValue(customAttributes[column] ?? normalizedEntry[column]);
        return value ? [column, value] as [string, string] : null;
      })
      .filter((pair): pair is [string, string] => Boolean(pair))
      .sort(([a], [b]) => a.localeCompare(b));

    const usedLabels = new Set([...configuredPairs, ...customPairs].map(([label]) => label));
    const usedNormalizedFallbackLabels = new Set([...configuredPairs, ...customPairs].map(([label]) => normalizeDetailToken(label)));

    const fallbackPairs = Object.entries(normalizedEntry)
      .filter(([key, value]) => {
        if (hiddenKeys.has(key)) return false;
        if (configuredStorageKeys.has(key)) return false;
        if (mappedColumns.has(key)) return false;
        return formatAccountDetailValue(value) !== '';
      })
      .map(([key, value]) => [formatAccountDetailLabel(key), formatAccountDetailValue(value)] as [string, string])
      .filter(([label]) => !usedLabels.has(label) && !usedNormalizedFallbackLabels.has(normalizeDetailToken(label)))
      .sort(([a], [b]) => {
        const priorityA = fallbackLabelPriority[a] ?? 999;
        const priorityB = fallbackLabelPriority[b] ?? 999;
        return priorityA - priorityB || a.localeCompare(b);
      });

    return [...configuredPairs, ...customPairs, ...fallbackPairs];
  };

  const CampaignTable = ({ cycleList, title, icon: Icon }: { cycleList: ReviewCycle[], title: string, icon: any }) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-8">
      <div className="px-8 py-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          <Icon className="w-4 h-4 text-blue-600" />
          {title}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wider font-semibold">
            <tr>
              <th className="px-8 py-3">Campaign / App</th>
              <th className="px-8 py-3">App Owner / Reviewer</th>
              <th className="px-8 py-3">Stage</th>
              <th className="px-8 py-3">Review Progress</th>
              <th className="px-8 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cycleList.length === 0 ? (
              <tr><td colSpan={5} className="px-8 py-10 text-center text-slate-400 italic">No campaigns found.</td></tr>
            ) : (
              cycleList.map((cycle) => {
                const isCancelled = cycle.status === ReviewStatus.CANCELLED;
                const isCompleted = cycle.status === ReviewStatus.COMPLETED;
                const app = applications.find(a => a.id === cycle.appId);
                const owner = users.find(u => u.id === app?.ownerId);
                const dueDateLabel = cycle.dueDate
                  ? new Date(cycle.dueDate).toLocaleDateString()
                  : '—';
                const progressPercent = cycle.totalItems > 0 ? Math.round(((cycle.totalItems - cycle.pendingItems) / cycle.totalItems) * 100) : 0;
                return (
                  <tr key={cycle.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-8 py-5">
                      <div className="font-bold text-slate-800">{cycle.name}</div>
                      <div className="text-xs text-blue-600 font-medium">{cycle.appName}</div>
                      <div className="mt-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          {getRiskScopeLabel(cycle.riskScope)}
                        </span>
                      </div>
                      {isCancelled && cycle.cancelReason && (
                        <div className="mt-1 text-[10px] text-slate-500">Cancel reason: {cycle.cancelReason}</div>
                      )}
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                        <Calendar className="w-3 h-3" /> Due: {dueDateLabel}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-medium text-slate-700">{owner?.name || '---'}</div>
                      <div className="text-[10px] text-slate-400 uppercase">App Owner</div>
                    </td>
                    <td className="px-8 py-5">
                       <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase w-fit ${
                          cycle.status === ReviewStatus.ACTIVE ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                          (cycle.status === ReviewStatus.REMEDIATION || cycle.status === ReviewStatus.PENDING_VERIFICATION) ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                          cycle.status === ReviewStatus.CANCELLED ? 'bg-slate-100 text-slate-600 border border-slate-200' :
                          'bg-green-50 text-green-600 border border-green-100'
                        }`}>
                          {cycle.status.replace('_', ' ')}
                        </span>
                    </td>
                    <td className="px-8 py-5">
                      {isCancelled ? (
                        <span className="text-xs font-bold text-slate-500">N/A</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-slate-100 h-2 rounded-full overflow-hidden max-w-[100px]">
                            <div className={`h-full rounded-full ${isCompleted ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${progressPercent}%` }}></div>
                          </div>
                          <span className="text-xs font-medium text-slate-600">{progressPercent}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right">
                      <button onClick={() => setSelectedCampaignId(cycle.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg text-xs font-bold transition-all ml-auto">
                        <Eye className="w-3.5 h-3.5" /> View Details
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
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Review Campaigns</h1>
          <p className="text-slate-500">Monitor and manage access review workflows.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              setLaunchSelectedAppType('ALL');
              setLaunchSelectedAppName('');
              setLaunchRiskScope('ALL_ACCESS');
              setLaunchCertificationType('MANAGER');
              setLaunchOrphanReviewerMode('APPLICATION_OWNER');
              setLaunchCustomOrphanReviewerId('');
              setShowLaunchModal(true);
            }}
            className="flex items-center gap-2 px-6 py-3 text-white rounded-xl font-semibold shadow-lg hover:opacity-90 transition-all"
            style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
          >
            <Play className="w-4 h-4 fill-current" /> Launch Campaign
          </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <select value={dashboardAppFilter} onChange={e => setDashboardAppFilter(e.target.value)} className="px-4 py-2 bg-white border rounded-xl text-xs font-bold text-slate-600 shadow-sm outline-none">
          <option value="ALL">All Applications</option>
          {applications.map(app => <option key={app.id} value={app.id}>{app.name}</option>)}
        </select>
        <select value={dashboardRiskScopeFilter} onChange={e => setDashboardRiskScopeFilter(e.target.value as 'ALL' | 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY')} className="px-4 py-2 bg-white border rounded-xl text-xs font-bold text-slate-600 shadow-sm outline-none">
          <option value="ALL">All Risk Scopes</option>
          <option value="ALL_ACCESS">All Access</option>
          <option value="SOD_ONLY">SoD Conflicts Only</option>
          <option value="PRIVILEGED_ONLY">Privileged Access Only</option>
          <option value="ORPHAN_ONLY">Orphan Accounts Only</option>
        </select>
        <select value={dashboardStatusFilter} onChange={e => setDashboardStatusFilter(e.target.value)} className="px-4 py-2 bg-white border rounded-xl text-xs font-bold text-slate-600 shadow-sm outline-none">
          <option value="ALL">All Active Stages</option>
          <option value={ReviewStatus.ACTIVE}>In Review</option>
          <option value={ReviewStatus.PENDING_VERIFICATION}>Pending Verification</option>
          <option value={ReviewStatus.REMEDIATION}>Remediation</option>
        </select>
      </div>

      <CampaignTable cycleList={activeCyclesList} title="Active Campaigns" icon={Activity} />
      <CampaignTable cycleList={archivedCyclesList} title="Archived Campaigns" icon={Archive} />

      {selectedCampaignId && (
        <ModalShell overlayClassName="z-50 bg-slate-900/50" panelClassName="max-w-7xl max-h-[90vh] flex flex-col overflow-hidden p-0">
            <div className="p-6 border-b flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-3">
                <Boxes className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="text-xl font-bold text-slate-900">{selectedCampaign?.name}</h3>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-slate-500">
                    <Calendar className="w-3.5 h-3.5" /> Due: {selectedCampaign?.dueDate ? new Date(selectedCampaign.dueDate).toLocaleDateString() : '—'}
                  </div>
                  <div className="mt-1">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                      Risk Scope: {getRiskScopeLabel(selectedCampaign?.riskScope)}
                    </span>
                  </div>
                  {selectedCampaign?.status === ReviewStatus.CANCELLED && selectedCampaign?.cancelReason && (
                    <div className="mt-1 text-[11px] text-slate-600 font-medium">Cancel reason: {selectedCampaign.cancelReason}</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {isAdmin && onSendNotifications && !isClosedCycle(selectedCampaign?.status) && (
                  <>
                    {selectedCampaign?.status === ReviewStatus.REMEDIATION ? (
                      <>
                        <select
                          value={selectedRemediationRecipientId}
                          onChange={(e) => setSelectedRemediationRecipientId(e.target.value)}
                          disabled={sendingNotificationMode !== null}
                          className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 shadow-sm outline-none disabled:opacity-60"
                        >
                          <option value="">Optional recipient</option>
                          {users.filter(u => Boolean(u.email)).map(u => (
                            <option key={u.id} value={u.id}>{u.name} ({u.id})</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSendNotifications('REMEDIATION_NOTIFY')}
                          disabled={sendingNotificationMode !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold shadow-sm hover:bg-amber-100 transition-all disabled:opacity-60"
                        >
                          <Clock className="w-4 h-4" /> {sendingNotificationMode === 'REMEDIATION_NOTIFY' ? 'Sending...' : 'Notify Remediation'}
                        </button>
                        <button
                          onClick={() => handleSendNotifications('REMEDIATION_REMINDER')}
                          disabled={sendingNotificationMode !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold shadow-sm hover:bg-red-100 transition-all disabled:opacity-60"
                        >
                          <AlertCircle className="w-4 h-4" /> {sendingNotificationMode === 'REMEDIATION_REMINDER' ? 'Sending...' : 'Remediation Reminder'}
                        </button>
                      </>
                    ) : isConfirmationPending ? (
                      <>
                        <button
                          onClick={() => handleSendNotifications('REMINDER')}
                          disabled={sendingNotificationMode !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold shadow-sm hover:bg-amber-100 transition-all disabled:opacity-60"
                        >
                          <Clock className="w-4 h-4" /> {sendingNotificationMode === 'REMINDER' ? 'Sending...' : 'Reminder to Confirm'}
                        </button>
                        <button
                          onClick={() => handleSendNotifications('ESCALATE')}
                          disabled={sendingNotificationMode !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold shadow-sm hover:bg-red-100 transition-all disabled:opacity-60"
                        >
                          <AlertCircle className="w-4 h-4" /> {sendingNotificationMode === 'ESCALATE' ? 'Escalating...' : 'Escalate Confirmation'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSendNotifications('REMINDER')}
                          disabled={sendingNotificationMode !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold shadow-sm hover:bg-amber-100 transition-all disabled:opacity-60"
                        >
                          <Clock className="w-4 h-4" /> {sendingNotificationMode === 'REMINDER' ? 'Sending...' : 'Send Reminder'}
                        </button>
                        <button
                          onClick={() => handleSendNotifications('ESCALATE')}
                          disabled={sendingNotificationMode !== null}
                          className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold shadow-sm hover:bg-red-100 transition-all disabled:opacity-60"
                        >
                          <AlertCircle className="w-4 h-4" /> {sendingNotificationMode === 'ESCALATE' ? 'Escalating...' : 'Escalate Pending'}
                        </button>
                      </>
                    )}
                  </>
                )}
                {isAdmin && onCancelCampaign && selectedCampaign && !isClosedCycle(selectedCampaign.status) && (
                  <button
                    onClick={async () => {
                      if (!selectedCampaign) return;
                      const confirmed = window.confirm(`Cancel campaign '${selectedCampaign.name}'? This will mark campaign and all items as CANCELLED and archive it.`);
                      if (!confirmed) return;
                      const reasonInput = window.prompt('Enter cancel reason (mandatory):', '');
                      if (reasonInput === null) return;
                      const reason = String(reasonInput || '').trim();
                      if (!reason) {
                        alert('Cancel reason is required.');
                        return;
                      }
                      setCancellingCampaignId(selectedCampaign.id);
                      try {
                        await onCancelCampaign(selectedCampaign.id, reason);
                      } finally {
                        setCancellingCampaignId(null);
                      }
                    }}
                    disabled={cancellingCampaignId === selectedCampaign.id}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-900 text-white rounded-xl text-xs font-bold shadow-sm hover:bg-slate-700 transition-all disabled:opacity-60"
                  >
                    <X className="w-4 h-4" /> {cancellingCampaignId === selectedCampaign.id ? 'Cancelling...' : 'Cancel Campaign'}
                  </button>
                )}
                {isAdmin && onBulkReassign && !isClosedCycle(selectedCampaign?.status) && (
                  <button
                    onClick={() => {
                      if (selectedCampaignItems.length === 0) return;
                      setShowBulkReassignModal(true);
                      setBulkReassignSearch('');
                      setBulkReassignToManagerId('');
                      setBulkReassignComment('');
                    }}
                    disabled={selectedCampaignItems.length === 0}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ${selectedCampaignItems.length > 0 ? 'text-white hover:opacity-90' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                    style={selectedCampaignItems.length > 0 ? { backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' } : undefined}
                  >
                    <Send className="w-4 h-4" /> Bulk Reassign ({selectedCampaignItems.length})
                  </button>
                )}
                <button 
                  onClick={exportCampaignDetail}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-50 transition-all"
                >
                  <FileDown className="w-4 h-4 text-blue-600" /> Export Campaign
                </button>
                <button onClick={() => setSelectedCampaignId(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
              </div>
            </div>
            
            <div className="p-6 bg-white border-b space-y-6">
              <div className="flex flex-wrap gap-4 items-center">
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">User</span>
                    <select value={campaignUserFilter} onChange={e => setCampaignUserFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
                        <option value="ALL">All Users</option>
                        {uniqueUsersInCampaign.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Entitlement</span>
                    <select value={campaignEntitlementFilter} onChange={e => setCampaignEntitlementFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
                        <option value="ALL">All Entitlements</option>
                        {uniqueEntsInCampaign.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Decision</span>
                    <select value={campaignStatusFilter} onChange={e => setCampaignStatusFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
                        <option value="ALL">All Decisions</option>
                        <option value={ActionStatus.PENDING}>Pending</option>
                        <option value={ActionStatus.APPROVED}>Approved</option>
                        <option value={ActionStatus.REVOKED}>Revoked</option>
                    </select>
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Remediation Status</span>
                    <select value={campaignRemediationFilter} onChange={e => setCampaignRemediationFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
                        <option value="ALL">All Remediation</option>
                        <option value="VERIFIED">Verified removed</option>
                        <option value="PENDING">Pending Verification</option>
                    </select>
                 </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Risk</span>
                    <select value={campaignRiskFilter} onChange={e => setCampaignRiskFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
                      <option value="ALL">All Levels</option>
                      <option value="CRITICAL">Critical</option>
                      <option value="HIGH">High</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="LOW">Low</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Risk Factor</span>
                    <select value={campaignRiskFactorFilter} onChange={e => setCampaignRiskFactorFilter(e.target.value)} className="px-3 py-1.5 bg-slate-50 border rounded-lg text-xs font-bold text-slate-600 outline-none">
                      <option value="ALL">All Factors</option>
                      <option value="PRIVILEGED">Privileged</option>
                      <option value="SOD">SoD Conflict</option>
                      <option value="ORPHAN">Orphan</option>
                      <option value="TERMINATED">Dormant Account</option>
                      <option value="NONE">None</option>
                    </select>
                  </div>
              </div>
              
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                 {(() => {
                   const approved = viewingItems.filter(i => i.status === ActionStatus.APPROVED).length;
                   const pendingReviews = viewingItems.filter(i => i.status === ActionStatus.PENDING).length;
                   const remediated = viewingItems.filter(i => i.status === ActionStatus.REMEDIATED).length;
                   const pendingVerify = viewingItems.filter(i => i.status === ActionStatus.REVOKED).length;
                   const revoked = remediated + pendingVerify;
                   return (
                     <>
                      <div className="p-3 bg-slate-50 rounded-2xl border shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Total Items</p>
                        <p className="text-xl font-black">{viewingItems.length}</p>
                      </div>
                      <div className="p-3 bg-blue-50 rounded-2xl border border-blue-100 shadow-sm">
                        <p className="text-[10px] font-bold text-blue-600 uppercase">Pending Reviews</p>
                        <p className="text-xl font-black text-blue-700">{pendingReviews}</p>
                      </div>
                      <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-100 shadow-sm">
                        <p className="text-[10px] font-bold text-emerald-600 uppercase">Approved</p>
                        <p className="text-xl font-black text-emerald-700">{approved}</p>
                      </div>
                      <div className="p-3 bg-red-50 rounded-2xl border border-red-100 shadow-sm">
                        <p className="text-[10px] font-bold text-red-600 uppercase">Revoked</p>
                        <p className="text-xl font-black text-red-700">{revoked}</p>
                      </div>
                      <div className="p-3 bg-orange-50 rounded-2xl border border-orange-100 shadow-sm">
                        <p className="text-[10px] font-bold text-orange-600 uppercase">Remediation</p>
                        <div className="flex items-baseline gap-1">
                          <p className="text-xl font-black text-orange-700">{remediated}</p>
                          <span className="text-[10px] text-orange-400 font-bold">/ {revoked} Verified</span>
                        </div>
                      </div>
                     </>
                   );
                 })()}
              </div>

              {isConfirmationPending && (
                <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50">
                  <p className="text-[11px] font-black uppercase tracking-wider text-amber-700">Awaiting Lock & Close Confirmation</p>
                  <p className="mt-1 text-xs text-amber-700">
                    Decisions are completed, but campaign closure is blocked until these reviewer(s) confirm.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pendingConfirmationReviewers.length === 0 ? (
                      <span className="text-xs text-amber-700">No pending reviewers found.</span>
                    ) : pendingConfirmationReviewers.map((reviewer) => (
                      <span key={reviewer.managerId} className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white border border-amber-200 text-amber-800">
                        {reviewer.name} ({reviewer.managerId})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold sticky top-0 border-b z-10">
                  <tr>
                    {isAdmin && onBulkReassign && !isClosedCycle(selectedCampaign?.status) && (
                      <th className="px-6 py-3 w-12">
                        <button onClick={() => setSelectedCampaignItems(selectedCampaignItems.length === selectableCampaignItems.length ? [] : selectableCampaignItems.map(i => i.id))}>
                          {selectedCampaignItems.length > 0 && selectedCampaignItems.length === selectableCampaignItems.length ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4" />}
                        </button>
                      </th>
                    )}
                    <th className="px-6 py-3">User / Account</th>
                    <th className="px-6 py-3">Entitlement</th>
                    <th className="px-6 py-3">Risk Factors</th>
                    <th className="px-6 py-3">Reviewer</th>
                    <th className="px-6 py-3">Decision Detail</th>
                    <th className="px-6 py-3">Remediation</th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {filteredViewingItems.length === 0 ? (
                    <tr><td colSpan={isAdmin && onBulkReassign && !isClosedCycle(selectedCampaign?.status) ? 7 : 6} className="px-6 py-20 text-center text-slate-400 italic">No results found matching current filters.</td></tr>
                  ) : (
                    filteredViewingItems.map(item => {
                        const reviewer = users.find(u => u.id === item.managerId);
                      const level = getRiskLevel(item);
                        const canSelectForBulk = !isClosedCycle(selectedCampaign?.status) && item.status === ActionStatus.PENDING && Number(item.reassignmentCount || 0) < maxReassignments;
                        return (
                        <tr key={item.id} className="hover:bg-slate-50">
                            {isAdmin && onBulkReassign && !isClosedCycle(selectedCampaign?.status) && (
                              <td className="px-6 py-4">
                                {canSelectForBulk ? (
                                  <button onClick={() => setSelectedCampaignItems(prev => prev.includes(item.id) ? prev.filter(i => i !== item.id) : [...prev, item.id])}>
                                    {selectedCampaignItems.includes(item.id) ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                                  </button>
                                ) : (
                                  <Square className="w-4 h-4 text-slate-200" />
                                )}
                              </td>
                            )}
                            <td className="px-6 py-4">
                                <div className="font-bold">{item.userName}</div>
                                <div className="text-[10px] text-slate-400 font-mono">ID: {item.appUserId}</div>
                                <button onClick={() => setViewingAccountItemId(item.id)} className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-blue-600 hover:text-blue-700">
                                  <Eye className="w-3 h-3" /> View Account
                                </button>
                            </td>
                            <td className="px-6 py-4">
                                <div className="font-mono text-xs flex items-center gap-2">
                                  {item.entitlement}
                                  {/* Fix: Lucide icons do not always expose the title prop correctly in some TypeScript environments. Wrapping in span is safer for tooltips. */}
                                  {item.isPrivileged && <span title="Privileged Entitlement"><ShieldCheck className="w-3 h-3 text-indigo-500 fill-indigo-50" /></span>}
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex flex-col gap-1">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase w-fit ${level === 'CRITICAL' ? 'bg-red-600 text-white' : level === 'HIGH' ? 'bg-orange-500 text-white' : level === 'MEDIUM' ? 'bg-indigo-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                      {level} RISK
                                    </span>
                                </div>
                                <div className="flex flex-wrap gap-1 mt-1.5">
                                    {item.isSoDConflict && (
                                      <div className="flex flex-col gap-0.5 w-full">
                                        <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[8px] font-black border border-red-100 uppercase w-fit flex items-center gap-1">
                                          <ShieldAlert className="w-2.5 h-2.5" /> SoD Conflict
                                        </span>
                                        {item.violatedPolicyNames?.map((name, idx) => (
                                          <button 
                                            key={idx}
                                            onClick={() => item.violatedPolicyIds?.[idx] && setViewingPolicyId(item.violatedPolicyIds[idx])}
                                            className="text-[8px] text-blue-500 font-bold uppercase hover:underline text-left truncate max-w-[180px]"
                                          >
                                            Policy: {name}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                    {item.isPrivileged && <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-[8px] font-black border border-indigo-100 uppercase w-fit flex items-center gap-1"><ShieldCheck className="w-2.5 h-2.5" /> Privileged</span>}
                                    {item.isOrphan && <span className="bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded text-[8px] font-black border border-orange-100 uppercase w-fit flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Orphan</span>}
                                    {isTerminatedRisk(item) && <span className="bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded text-[8px] font-black border border-orange-100 uppercase w-fit flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> Dormant</span>}
                                    {!item.isSoDConflict && !item.isPrivileged && !item.isOrphan && !isTerminatedRisk(item) && (
                                      <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[8px] font-black border border-slate-200 uppercase w-fit">Low Risk</span>
                                    )}
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <div className="text-xs font-bold">{reviewer?.name || item.managerId}</div>
                                <div className="text-[10px] text-slate-400 uppercase">Reviewing Manager</div>
                                {item.reassignedBy && (
                                  <div className="mt-1 text-[10px] text-slate-500 leading-tight">
                                    <div className="font-semibold">Reassigned by: {users.find(u => u.id === item.reassignedBy)?.name || item.reassignedBy}</div>
                                    {item.reassignedAt && <div className="text-[9px] text-slate-400 font-mono">{new Date(item.reassignedAt).toLocaleString()}</div>}
                                    <div className="text-[9px] text-slate-400 uppercase">Count: {item.reassignmentCount || 1}</div>
                                  </div>
                                )}
                                {isAdmin && onReassign && (
                                  <button
                                    onClick={() => {
                                      if (isClosedCycle(selectedCampaign?.status)) return;
                                      if (item.status !== ActionStatus.PENDING) return;
                                      if (Number(item.reassignmentCount || 0) >= maxReassignments) return;
                                      setReassignModal({ itemId: item.id, fromManagerId: item.managerId, appUserId: item.appUserId });
                                      setReassignSearch('');
                                      setReassignToManagerId('');
                                      setReassignComment('');
                                    }}
                                    disabled={isClosedCycle(selectedCampaign?.status) || item.status !== ActionStatus.PENDING || Number(item.reassignmentCount || 0) >= maxReassignments}
                                    className={`mt-2 px-2.5 py-1 rounded text-[10px] font-bold uppercase inline-flex items-center gap-1 ${isClosedCycle(selectedCampaign?.status) || item.status !== ActionStatus.PENDING || Number(item.reassignmentCount || 0) >= maxReassignments ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-blue-50 text-blue-700 border border-blue-100 hover:bg-blue-100'}`}
                                  >
                                    <Send className="w-3 h-3" /> Reassign
                                  </button>
                                )}
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                    item.status === ActionStatus.PENDING ? 'bg-blue-50 text-blue-600 border' :
                                    item.status === ActionStatus.APPROVED ? 'bg-green-50 text-green-600 border' : 'bg-red-50 text-red-600 border'
                                    }`}>
                                    {item.status === ActionStatus.REMEDIATED ? 'REVOKED' : item.status}
                                    </span>
                                    {item.actionedAt && <span className="text-[9px] text-slate-400 font-mono italic">{new Date(item.actionedAt).toLocaleString()}</span>}
                                </div>
                                {item.comment && <div className="text-[10px] text-slate-500 italic max-w-xs leading-tight">"{item.comment}"</div>}
                            </td>
                            <td className="px-6 py-4">
                                {item.status === ActionStatus.REMEDIATED ? (
                                    <div className="flex flex-col">
                                        <span className="text-emerald-600 font-bold text-[10px] uppercase flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Verified Removed</span>
                                        {item.remediatedAt && <span className="text-[9px] text-slate-400 font-mono italic">{new Date(item.remediatedAt).toLocaleString()}</span>}
                                    </div>
                                ) : item.status === ActionStatus.REVOKED ? (
                                    <span className="text-orange-500 font-bold text-[10px] uppercase flex items-center gap-1"><Clock className="w-3 h-3" /> Awaiting De-Provisioning</span>
                                ) : '---'}
                            </td>
                        </tr>
                        );
                    })
                  )}
                </tbody>
              </table>
            </div>
        </ModalShell>
      )}

      {/* Policy Details Modal */}
      {reassignModal && (
        <ModalShell overlayClassName="z-[120]" panelClassName="max-w-2xl max-h-[85vh] p-8">
            <h3 className="text-xl font-bold text-slate-900 mb-4">Reassign Certification Item</h3>
            <p className="text-sm text-slate-500 mb-4">Select a different HR user as reviewer. The access owner cannot be assigned as reviewer.</p>

            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Search Reviewer</label>
              <input
                type="text"
                value={reassignSearch}
                onChange={(e) => setReassignSearch(e.target.value)}
                placeholder="Search by ID, name, email"
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="mb-4 max-h-60 overflow-y-auto border border-slate-200 rounded-xl">
              {reassignmentCandidates.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No users found.</p>
              ) : (
                reassignmentCandidates.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setReassignToManagerId(user.id)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${reassignToManagerId === user.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="font-semibold text-slate-800">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.id} • {user.email}</div>
                  </button>
                ))
              )}
            </div>

            <div className="mb-6">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Comment (optional)</label>
              <textarea
                value={reassignComment}
                onChange={(e) => setReassignComment(e.target.value)}
                rows={3}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Reason for reassignment"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setReassignModal(null);
                  setReassignSearch('');
                  setReassignToManagerId('');
                  setReassignComment('');
                }}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReassignment}
                className="px-4 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                Reassign
              </button>
            </div>
        </ModalShell>
      )}

      {showBulkReassignModal && (
        <ModalShell overlayClassName="z-[125]" panelClassName="max-w-2xl max-h-[85vh] p-8">
            <h3 className="text-xl font-bold text-slate-900 mb-4">Bulk Reassign Certification Items</h3>
            <p className="text-sm text-slate-500 mb-1">Selected items: {selectedCampaignItemObjects.length}</p>
            <p className="text-sm text-slate-500 mb-4">Skipped due to max limit: {selectedSkippedByLimitCount}</p>

            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Search Reviewer</label>
              <input
                type="text"
                value={bulkReassignSearch}
                onChange={(e) => setBulkReassignSearch(e.target.value)}
                placeholder="Search by ID, name, email"
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="mb-4 max-h-60 overflow-y-auto border border-slate-200 rounded-xl">
              {bulkReassignmentCandidates.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">No users found.</p>
              ) : (
                bulkReassignmentCandidates.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setBulkReassignToManagerId(user.id)}
                    className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${bulkReassignToManagerId === user.id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="font-semibold text-slate-800">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.id} • {user.email}</div>
                  </button>
                ))
              )}
            </div>

            <div className="mb-6">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Comment (optional)</label>
              <textarea
                value={bulkReassignComment}
                onChange={(e) => setBulkReassignComment(e.target.value)}
                rows={3}
                className="mt-1 w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/20"
                placeholder="Reason for bulk reassignment"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowBulkReassignModal(false);
                  setBulkReassignSearch('');
                  setBulkReassignToManagerId('');
                  setBulkReassignComment('');
                }}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitBulkReassignment}
                disabled={selectedCampaignItemObjects.length === 0}
                className="px-4 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed"
                style={selectedCampaignItemObjects.length === 0 ? undefined : { backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                Reassign Selected
              </button>
            </div>
        </ModalShell>
      )}

      {/* Policy Details Modal */}
      {viewingPolicyId && (
        <ModalShell overlayClassName="z-[110]" panelClassName="max-w-md p-8">
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
        </ModalShell>
      )}

      {showLaunchModal && isAdmin && (
        <ModalShell overlayClassName="z-50 bg-slate-900/50" panelClassName="max-w-md max-h-[90vh] p-8">
            <h3 className="text-xl font-bold mb-6">Launch New Campaign</h3>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Application Type</label>
              <select
                value={launchSelectedAppType}
                onChange={e => {
                  setLaunchSelectedAppType(e.target.value as 'ALL' | NonNullable<Application['appType']>);
                  setLaunchSelectedAppName('');
                }}
                className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-semibold text-slate-700"
              >
                <option value="ALL">All Types</option>
                {launchApplicationTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Application</label>
              <select
                value={launchSelectedAppName}
                onChange={e => setLaunchSelectedAppName(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-semibold text-slate-700"
              >
                <option value="">Select application...</option>
                {launchApplicationsFiltered.map(app => {
                  const appId = String((app as any).appId || app.id || '').trim();
                  const appName = String(app.name || '').trim();
                  return (
                    <option key={appId || appName} value={appId}>{appName}</option>
                  );
                })}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">Choose an application from the selected type.</p>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Review Completion Due Date</label>
              <input type="date" value={launchDueDate} onChange={e => setLaunchDueDate(e.target.value)} className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10" />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Certification Type</label>
              <select
                value={launchCertificationType}
                onChange={e => setLaunchCertificationType(e.target.value as CertificationType)}
                className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-semibold text-slate-700"
              >
                <option value="MANAGER">Manager Certification</option>
                <option value="APPLICATION_OWNER">Application Owner Certification</option>
                <option value="APPLICATION_ADMIN">Application Admin Certification</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Risk Scope</label>
              <select
                value={launchRiskScope}
                onChange={e => setLaunchRiskScope(e.target.value as 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY')}
                className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-semibold text-slate-700"
              >
                <option value="ALL_ACCESS">All Access</option>
                <option value="SOD_ONLY">SoD Conflicts Only</option>
                <option value="PRIVILEGED_ONLY">Privileged Access Only</option>
                <option value="ORPHAN_ONLY">Orphan Accounts Only</option>
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Orphan Account Reviewer</label>
              <select
                value={launchOrphanReviewerMode}
                onChange={e => setLaunchOrphanReviewerMode(e.target.value as OrphanReviewerMode)}
                className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-semibold text-slate-700"
              >
                <option value="APPLICATION_OWNER">Route to Application Owner</option>
                <option value="APPLICATION_ADMIN">Route to Application Admin</option>
                <option value="CUSTOM">Route to Specific Reviewer</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">Use this when HR correlation is missing and the account is treated as orphaned.</p>
            </div>
            {launchOrphanReviewerMode === 'CUSTOM' && (
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2 tracking-widest px-1">Specific Orphan Reviewer</label>
                <select
                  value={launchCustomOrphanReviewerId}
                  onChange={e => setLaunchCustomOrphanReviewerId(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-semibold text-slate-700"
                >
                  <option value="">Select reviewer...</option>
                  {users.map(user => <option key={user.id} value={user.id}>{user.name} ({user.id})</option>)}
                </select>
              </div>
            )}
            <button
              onClick={() => {
                const selectedId = String(launchSelectedAppName || '').trim();
                if (!selectedId) {
                  alert('Select an application to launch campaign.');
                  return;
                }
                if (launchOrphanReviewerMode === 'CUSTOM' && !String(launchCustomOrphanReviewerId || '').trim()) {
                  alert('Select a specific orphan reviewer.');
                  return;
                }
                const selectedApp = launchApplicationsFiltered.find(app => String((app as any)?.appId || app?.id || '').trim() === selectedId);
                if (!selectedApp) {
                  alert('Selected application is invalid. Please choose from the dropdown list.');
                  return;
                }
                onLaunch(selectedId, launchDueDate, launchCertificationType, launchRiskScope, launchOrphanReviewerMode, launchCustomOrphanReviewerId);
                setShowLaunchModal(false);
              }}
              className="w-full py-3 rounded-xl font-bold text-white hover:opacity-90 transition-all inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
            >
              <Play className="w-4 h-4 fill-current" /> Launch Campaign
            </button>
            <button onClick={() => setShowLaunchModal(false)} className="w-full mt-6 py-3 border rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
        </ModalShell>
      )}

      {viewingAccountItem && (
        <ModalShell overlayClassName="z-[110]" panelClassName="max-w-4xl max-h-[90vh] p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Account Details</h3>
                <p className="text-sm text-slate-500 mt-1">{viewingAccountItem.userName} · {viewingAccountItem.appUserId}</p>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-2">{viewingAccountApp?.name || viewingAccountItem.appName}</p>
              </div>
              <button onClick={() => setViewingAccountItemId(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reviewer</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{users.find((user) => user.id === viewingAccountItem.managerId)?.name || viewingAccountItem.managerId}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Entitlement</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{viewingAccountItem.entitlement}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Risk Flags</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {viewingAccountItem.isSoDConflict && <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-100">SoD Conflict</span>}
                  {viewingAccountItem.isPrivileged && <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">Privileged</span>}
                  {viewingAccountItem.isOrphan && <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Orphan</span>}
                  {isTerminatedRisk(viewingAccountItem) && <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-100">Dormant Account</span>}
                  {!viewingAccountItem.isSoDConflict && !viewingAccountItem.isPrivileged && !viewingAccountItem.isOrphan && !isTerminatedRisk(viewingAccountItem) && <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">No Elevated Flags</span>}
                </div>
              </div>
            </div>

            {viewingAccountEntries.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
                No matching account record was found in the loaded inventory. The campaign row details are still shown above.
              </div>
            ) : (
              <div className="space-y-4">
                {viewingAccountEntries.map((entry, index) => (
                  <div key={`${entry.appId}-${entry.userId}-${entry.entitlement}-${index}`} className="rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{entry.userName || viewingAccountItem.userName}</p>
                        <p className="text-[11px] font-mono text-slate-500">{entry.userId || viewingAccountItem.appUserId}</p>
                      </div>
                      <div className="text-xs font-semibold text-slate-500">{entry.entitlement}</div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                      {getAccountDetailPairs(entry as Record<string, any>, viewingAccountApp).map(([key, value]) => (
                        <div key={key} className="px-5 py-4 border-b border-slate-100 md:border-r even:md:border-r-0">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{key}</p>
                          <p className="mt-1 text-sm text-slate-800 break-words">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </ModalShell>
      )}
    </div>
  );
};

export default Dashboard;
