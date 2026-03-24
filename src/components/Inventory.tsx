import React, { useState, useRef, useMemo, useEffect } from 'react';
import { getAccounts, getAccountsByUser, getEntitlements, importSodPolicies } from '../services/api';
import { Upload, Database, FileText, CheckCircle2, AlertCircle, Download, FileSpreadsheet, Plus, Settings2, Link, Link2Off, Trash2, ShieldAlert, ListChecks, Users2, Eye, Shield, UserMinus, UserCheck, X, ShieldCheck, Zap, Edit2, Info, ArrowRight, ChevronRight, AlertTriangle, Package, KeyRound, Copy } from 'lucide-react';
import { ApplicationAccess, User, Application, EntitlementDefinition, SoDPolicy } from '../types';
import {
  APP_TYPE_SCHEMA_TEMPLATES,
  buildDefaultAccountSchema,
  getTemplateHeadersForAppType,
  HR_TEMPLATE_HEADERS,
  ENTITLEMENT_TEMPLATE_HEADERS,
  SOD_POLICY_TEMPLATE_HEADERS
} from '../constants';

interface InventoryProps {
  users: User[];
  access: ApplicationAccess[];
  applications: Application[];
  entitlements: EntitlementDefinition[];
  sodPolicies: SoDPolicy[];
  onDataImport: (type: 'HR' | 'APPLICATIONS' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD', data: any[], appId?: string) => void;
  onAddApp: (app: Application) => void;
  onUpdateApp: (app: Application) => void;
  onRemoveApp: (appId: string) => void;
  onUpdateEntitlement: (ent: EntitlementDefinition) => void;
  onUpdateSoD: (policies: SoDPolicy[]) => void;
  onSetUserRole: (userId: string, role: 'ADMIN' | 'AUDITOR' | 'USER') => Promise<void>;
  onBulkSetUserRole: (userIds: string[], role: 'ADMIN' | 'AUDITOR' | 'USER') => Promise<void>;
  onResetUserPassword: (userId: string) => Promise<{ temporaryPassword: string; user?: any }>;
  onSelectApp?: (appId: string) => void;
}

const Inventory: React.FC<InventoryProps> = ({ users, access, applications, entitlements, sodPolicies, onDataImport, onAddApp, onUpdateApp, onRemoveApp, onUpdateEntitlement, onUpdateSoD, onSetUserRole, onBulkSetUserRole, onResetUserPassword, onSelectApp }) => {
  const APPLICATION_TYPE_OPTIONS: Array<NonNullable<Application['appType']>> = ['Application', 'Database', 'Servers', 'Shared Mailbox'];

  const getOwnerLabels = (appType?: Application['appType']) => {
    if (appType === 'Database') return { primary: 'Database Owner', secondary: 'Database Admin' };
    if (appType === 'Servers') return { primary: 'Server Owner', secondary: 'Server Admin / Team' };
    if (appType === 'Shared Mailbox') return { primary: 'Mailbox Owner', secondary: 'Mailbox Admin / Team' };
    return { primary: 'Application Owner', secondary: 'Application Admin / Team' };
  };

  const parseDelimitedValues = (value: any): string[] => {
    if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    return String(value || '')
      .split(/[;,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  };

  const getAdminReviewerIds = (app?: Partial<Application> | null) => {
    return Array.from(new Set([
      ...parseDelimitedValues(app?.ownerAdminIds),
      ...parseDelimitedValues(app?.ownerAdminId)
    ]));
  };

  const getAdminTeamLabels = (app?: Partial<Application> | null) => {
    return Array.from(new Set(parseDelimitedValues(app?.ownerAdminTeams)));
  };

  const getAdminDisplayText = (app?: Partial<Application> | null) => {
    const reviewerNames = getAdminReviewerIds(app)
      .map((id) => users.find((user) => user.id === id)?.name || id)
      .filter(Boolean);
    const teamNames = getAdminTeamLabels(app);
    const combined = [...reviewerNames, ...teamNames];
    return combined.length > 0 ? combined.join(', ') : 'Unknown';
  };

  const [activeSubTab, setActiveSubTab] = useState<'identities' | 'applications' | 'sod'>('identities');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [collapsedAppTypeGroups, setCollapsedAppTypeGroups] = useState<Record<string, boolean>>({});
  const [appManagementTab, setAppManagementTab] = useState<'accounts' | 'definitions'>('accounts');
  const [showAddApp, setShowAddApp] = useState(false);
  const [editingAppConfig, setEditingAppConfig] = useState<Application | null>(null);
  const [newApp, setNewApp] = useState({
    name: '',
    appType: 'Application' as NonNullable<Application['appType']>,
    ownerId: '',
    ownerAdminId: '',
    ownerAdminIds: [] as string[],
    ownerAdminTeamsText: '',
    description: '',
    serverHost: '',
    serverHostName: '',
    serverEnvironment: '' as 'UAT' | 'PROD' | ''
  });
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [groupInApp, setGroupInApp] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [userAllAccess, setUserAllAccess] = useState<ApplicationAccess[] | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkRole, setBulkRole] = useState<'ADMIN' | 'AUDITOR' | 'USER'>('USER');
  const [bulkUpdatingRole, setBulkUpdatingRole] = useState(false);
  const [showBulkRoleModal, setShowBulkRoleModal] = useState(false);
  const [resetResult, setResetResult] = useState<{ userId: string; name: string; temporaryPassword: string } | null>(null);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [showSchemaConfig, setShowSchemaConfig] = useState(false);
  const [schemaDraft, setSchemaDraft] = useState<Application['accountSchema'] | null>(null);
  const [showUploadMapper, setShowUploadMapper] = useState(false);
  const [uploadSchemaDraft, setUploadSchemaDraft] = useState<Application['accountSchema'] | null>(null);
  const [saveUploadMappingForApp, setSaveUploadMappingForApp] = useState(true);
  const [pendingAccountUpload, setPendingAccountUpload] = useState<{
    appId: string;
    headers: string[];
    rows: any[];
    fileName: string;
  } | null>(null);
  
  // Editing state for Entitlements
  const [editingEnt, setEditingEnt] = useState<EntitlementDefinition | null>(null);

  // SoD Violation View - NOW USING POLICY ID
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);

  // New Global SoD state
  const [showAddSod, setShowAddSod] = useState(false);
  const [newSod, setNewSod] = useState<Partial<SoDPolicy>>({ riskLevel: 'HIGH' });
  const [sodError, setSodError] = useState<string | null>(null);
  const [sodEntitlementsByApp, setSodEntitlementsByApp] = useState<Record<string, string[]>>({});

  const hrInputRef = useRef<HTMLInputElement>(null);
  const accountInputRef = useRef<HTMLInputElement>(null);
  const entInputRef = useRef<HTMLInputElement>(null);
  const sodInputRef = useRef<HTMLInputElement>(null);
  const appsInputRef = useRef<HTMLInputElement>(null);

  const normalizeHeader = (value: string) => String(value || '').trim().toLowerCase();
  const getAppRecord = (id?: string | null) => applications.find(app => String((app as any).id || (app as any).appId) === String(id || ''));
  const getResolvedAppType = (app?: Application | null): NonNullable<Application['appType']> => {
    if (app?.appType && APP_TYPE_SCHEMA_TEMPLATES[app.appType]) return app.appType;
    return 'Application';
  };
  const getCorrelationFieldKey = (appType: NonNullable<Application['appType']>) => {
    if (appType === 'Database') return 'loginName';
    if (appType === 'Servers') return 'userId';
    return 'employeeId';
  };
  const getCorrelationFieldLabel = (appType: NonNullable<Application['appType']>) => {
    if (appType === 'Database') return 'Login Name';
    if (appType === 'Servers') return 'Users ID';
    return 'Employee ID';
  };
  const getEntitlementFieldKey = (appType: NonNullable<Application['appType']>) => {
    if (appType === 'Database') return 'dbRole';
    if (appType === 'Servers') return 'privilegeLevel';
    return 'role';
  };
  const getEntitlementFieldLabel = (appType: NonNullable<Application['appType']>) => {
    if (appType === 'Database') return 'DB Role';
    if (appType === 'Servers') return 'Admin/root';
    return 'Role';
  };
  const getCorrelationFieldGuidance = (appType: NonNullable<Application['appType']>) => {
    if (appType === 'Application') return 'Choose the feed column that best matches HR identity (prefer Employee ID).';
    if (appType === 'Database') return 'Choose the login column used to correlate database accounts to identities.';
    if (appType === 'Servers') return 'Choose the server user-id column used to correlate accounts to identities.';
    return 'Choose the column used to correlate feed records with HR identities.';
  };
  const getResolvedAccountSchema = (app?: Application | null) => {
    const appType = getResolvedAppType(app);
    const fallback = buildDefaultAccountSchema(appType);
    const current = app?.accountSchema;
    return {
      schemaAppType: appType,
      mappings: {
        ...fallback.mappings,
        ...(current?.mappings || {})
      },
      ignoreColumns: Array.isArray(current?.ignoreColumns)
        ? current.ignoreColumns.map(v => String(v || '').trim()).filter(Boolean)
        : [],
      customColumns: Array.isArray(current?.customColumns)
        ? current.customColumns.map(v => String(v || '').trim()).filter(Boolean)
        : [],
      statusRules: {
        activeValues: Array.isArray(current?.statusRules?.activeValues) ? current!.statusRules!.activeValues : fallback.statusRules.activeValues,
        inactiveValues: Array.isArray(current?.statusRules?.inactiveValues) ? current!.statusRules!.inactiveValues : fallback.statusRules.inactiveValues
      }
    };
  };

  const normalizeAccountStatus = (raw: any, app?: Application | null) => {
    const value = String(raw || '').trim();
    if (!value) return '';
    const schema = getResolvedAccountSchema(app);
    const lowered = value.toLowerCase();
    if (schema.statusRules.activeValues.map(v => v.toLowerCase()).includes(lowered)) return 'ACTIVE';
    if (schema.statusRules.inactiveValues.map(v => v.toLowerCase()).includes(lowered)) return 'INACTIVE';
    return value;
  };

  const getHrFallback = (seed: { employeeId?: string; email?: string; loginId?: string; userId?: string }) => {
    const employeeId = String(seed.employeeId || '').trim();
    const email = String(seed.email || '').trim().toLowerCase();
    const loginId = String(seed.loginId || seed.userId || '').trim();

    if (employeeId) {
      const byId = users.find(u => String(u.id || '').trim().toLowerCase() === employeeId.toLowerCase());
      if (byId) return byId;
    }
    if (email) {
      const byEmail = users.find(u => String(u.email || '').trim().toLowerCase() === email);
      if (byEmail) return byEmail;
    }
    if (loginId) {
      const byLogin = users.find(u => String(u.id || '').trim().toLowerCase() === loginId.toLowerCase());
      if (byLogin) return byLogin;
    }
    return undefined;
  };

  const downloadImportErrorReport = (errors: Array<{ row: number; reasons: string[]; raw: Record<string, any> }>) => {
    const headers = ['row', 'errors', 'raw'];
    const rows = errors.map((item) => [
      String(item.row),
      item.reasons.join(' | '),
      JSON.stringify(item.raw || {})
    ]);
    const content = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `account_import_row_errors_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const mapAccountUploadRows = (
    headers: string[],
    rows: any[],
    app?: Application | null,
    schemaOverride?: Application['accountSchema'] | null
  ) => {
    const appType = getResolvedAppType(app);
    const schema = schemaOverride ? {
      ...getResolvedAccountSchema(app),
      ...schemaOverride,
      mappings: {
        ...getResolvedAccountSchema(app).mappings,
        ...(schemaOverride?.mappings || {})
      },
      ignoreColumns: Array.isArray(schemaOverride?.ignoreColumns) ? schemaOverride.ignoreColumns : getResolvedAccountSchema(app).ignoreColumns,
      customColumns: Array.isArray(schemaOverride?.customColumns) ? schemaOverride.customColumns : getResolvedAccountSchema(app).customColumns
    } : getResolvedAccountSchema(app);
    const template = APP_TYPE_SCHEMA_TEMPLATES[appType];
    const headerLookup = new Map(headers.map(h => [normalizeHeader(h), h]));
    const ignoreSet = new Set(schema.ignoreColumns.map(col => normalizeHeader(col)));
    const customColumns = (schema.customColumns || []).filter(col => headerLookup.has(normalizeHeader(col)));

    const resolveHeader = (fieldKey: string, aliases: string[] = []) => {
      const configured = String(schema.mappings[fieldKey] || '').trim();
      if (configured && headerLookup.has(normalizeHeader(configured))) {
        return headerLookup.get(normalizeHeader(configured)) || '';
      }
      const defaultKey = String(template.defaultMappings[fieldKey] || '').trim();
      if (defaultKey && headerLookup.has(normalizeHeader(defaultKey))) {
        return headerLookup.get(normalizeHeader(defaultKey)) || '';
      }
      const allAliases = [fieldKey, ...aliases];
      for (const alias of allAliases) {
        const found = headerLookup.get(normalizeHeader(alias));
        if (found) return found;
      }
      return '';
    };

    const resolvedByField: Record<string, string> = {};
    template.fields.forEach(field => {
      resolvedByField[field.key] = resolveHeader(field.key, field.aliases || []);
    });

    const validRows: any[] = [];
    const failedRows: Array<{ row: number; reasons: string[]; raw: Record<string, any> }> = [];

    rows.forEach((raw, index) => {
      const rowNum = index + 2;
      const reasons: string[] = [];
      const pick = (fieldKey: string) => {
        const sourceHeader = resolvedByField[fieldKey];
        if (!sourceHeader) return '';
        if (ignoreSet.has(normalizeHeader(sourceHeader))) return '';
        return String(raw[sourceHeader] ?? '').trim();
      };
      const customAttributes = customColumns.reduce((acc, col) => {
        const sourceHeader = headerLookup.get(normalizeHeader(col)) || col;
        const value = String(raw[sourceHeader] ?? '').trim();
        if (value) acc[col] = value;
        return acc;
      }, {} as Record<string, string>);

      if (appType === 'Application') {
        const loginId = pick('loginId');
        const role = pick('role');
        let email = pick('email');
        let employeeId = pick('employeeId');
        const lastLoginAt = pick('lastLoginAt');
        let accountOwnerName = pick('accountOwnerName');
        const accountStatus = normalizeAccountStatus(pick('accountStatus'), app);

        const hr = getHrFallback({ employeeId, email, loginId });
        if (!email && employeeId && hr?.email) email = String(hr.email || '').trim();
        if (!employeeId && hr?.id) employeeId = String(hr.id || '').trim();
        if (!accountOwnerName) accountOwnerName = loginId;

        if (!loginId) reasons.push('Missing required field: Login ID/Name');
        if (!role) reasons.push('Missing required field: Role');
        if (!email) reasons.push('Missing required field: E-mail ID (including HR fallback)');
        if (!employeeId) reasons.push('Missing required field: Employee ID (including HR fallback)');
        if (!accountOwnerName) reasons.push('Missing required field: ID Owner/User Name');

        if (reasons.length > 0) {
          failedRows.push({ row: rowNum, reasons, raw });
          return;
        }

        validRows.push({
          appId: String((app as any)?.id || (app as any)?.appId || '').trim(),
          userId: loginId,
          userName: accountOwnerName,
          email,
          entitlement: role,
          accountStatus,
          employeeId,
          lastLoginDetails: lastLoginAt,
          accountOwnerName,
          customAttributes,
          accountId: loginId
        });
        return;
      }

      if (appType === 'Database') {
        const loginName = pick('loginName');
        const userType = pick('userType');
        const dbRole = pick('dbRole');
        const createDate = pick('createDate');
        let userDetails = pick('userDetails');
        const accountStatus = normalizeAccountStatus(pick('accountStatus'), app);

        const hr = getHrFallback({ loginId: loginName, userId: loginName });
        if (!userDetails && hr?.name) userDetails = String(hr.name || '').trim();

        if (!loginName) reasons.push('Missing required field: Login Name');
        if (!userType) reasons.push('Missing required field: User Type');
        if (!dbRole) reasons.push('Missing required field: DB Role');
        if (!userDetails) reasons.push('Missing required field: User Details (including HR fallback)');

        if (reasons.length > 0) {
          failedRows.push({ row: rowNum, reasons, raw });
          return;
        }

        validRows.push({
          appId: String((app as any)?.id || (app as any)?.appId || '').trim(),
          userId: loginName,
          userName: userDetails,
          email: String(hr?.email || '').trim(),
          entitlement: dbRole,
          accountStatus,
          userType,
          createDate,
          userDetails,
          customAttributes,
          accountId: loginName
        });
        return;
      }

      const userId = pick('userId');
      const userName = pick('userName');
      const privilegeLevel = pick('privilegeLevel');
      const accountStatus = normalizeAccountStatus(pick('accountStatus'), app);

      if (!userId) reasons.push('Missing required field: Users ID');
      if (!userName) reasons.push('Missing required field: User Name');
      if (!privilegeLevel) reasons.push('Missing required field: Admin/root');

      if (reasons.length > 0) {
        failedRows.push({ row: rowNum, reasons, raw });
        return;
      }

      validRows.push({
        appId: String((app as any)?.id || (app as any)?.appId || '').trim(),
        userId,
        userName,
        entitlement: privilegeLevel,
        isPrivileged: /admin|root/i.test(privilegeLevel),
        accountStatus,
        customAttributes,
        accountId: userId
      });
    });

    return { validRows, failedRows };
  };

  const buildUploadSchemaDraft = (app: Application, headers: string[]) => {
    const schema = getResolvedAccountSchema(app);
    const appType = getResolvedAppType(app);
    const template = APP_TYPE_SCHEMA_TEMPLATES[appType];
    const headerLookup = new Map(headers.map(h => [normalizeHeader(h), h]));
    const mappings: Record<string, string> = { ...(schema.mappings || {}) };

    template.fields.forEach(field => {
      const current = String(mappings[field.key] || '').trim();
      if (current && headerLookup.has(normalizeHeader(current))) {
        mappings[field.key] = headerLookup.get(normalizeHeader(current)) || current;
        return;
      }
      const candidates = [field.key, ...(field.aliases || []), template.defaultMappings[field.key] || '']
        .map(value => String(value || '').trim())
        .filter(Boolean);
      const matched = candidates
        .map(candidate => headerLookup.get(normalizeHeader(candidate)))
        .find(Boolean);
      mappings[field.key] = matched || '';
    });

    const mappedHeaders = new Set(Object.values(mappings).map(h => normalizeHeader(String(h || ''))).filter(Boolean));
    const suggestedCustomColumns = headers
      .filter(header => !mappedHeaders.has(normalizeHeader(header)) && !schema.ignoreColumns.map(v => normalizeHeader(v)).includes(normalizeHeader(header)));

    return {
      ...schema,
      schemaAppType: appType,
      mappings,
      customColumns: Array.from(new Set([...(schema.customColumns || []), ...suggestedCustomColumns]))
    };
  };

  const confirmUploadMapping = () => {
    if (!pendingAccountUpload) return;
    const targetApp = getAppRecord(pendingAccountUpload.appId);
    if (!targetApp || !uploadSchemaDraft) return;
    const appType = getResolvedAppType(targetApp);
    const correlationFieldKey = getCorrelationFieldKey(appType);
    const entitlementFieldKey = getEntitlementFieldKey(appType);
    const selectedCorrelationColumn = String(uploadSchemaDraft.mappings?.[correlationFieldKey] || '').trim();
    const selectedEntitlementColumn = String(uploadSchemaDraft.mappings?.[entitlementFieldKey] || '').trim();

    if (!selectedCorrelationColumn) {
      alert(`Please select a feed column for correlation (${getCorrelationFieldLabel(appType)}).`);
      return;
    }
    if (!selectedEntitlementColumn) {
      alert(`Please select a feed column for entitlement (${getEntitlementFieldLabel(appType)}).`);
      return;
    }

    const mapped = mapAccountUploadRows(
      pendingAccountUpload.headers,
      pendingAccountUpload.rows,
      targetApp,
      uploadSchemaDraft
    );

    if (mapped.failedRows.length > 0) {
      downloadImportErrorReport(mapped.failedRows);
      alert(`Imported ${mapped.validRows.length} row(s). ${mapped.failedRows.length} row(s) failed validation. Error report downloaded.`);
    }
    if (mapped.validRows.length === 0) {
      alert('No valid rows found in file. Please review the error report and try again.');
      return;
    }

    onDataImport('APP_ACCESS', mapped.validRows, pendingAccountUpload.appId);
    if (saveUploadMappingForApp) {
      onUpdateApp({
        ...targetApp,
        accountSchema: {
          ...targetApp.accountSchema,
          ...uploadSchemaDraft,
          schemaAppType: getResolvedAppType(targetApp)
        }
      });
    }

    setShowUploadMapper(false);
    setPendingAccountUpload(null);
    setUploadSchemaDraft(null);
    setSaveUploadMappingForApp(true);
  };

  const downloadTemplate = (type: 'HR' | 'APPLICATIONS' | 'APP_ACCESS' | 'APP_ENT' | 'APP_SOD') => {
    let headers: string[] = [];
    let rows: any[] = [];

    if (type === 'HR') headers = HR_TEMPLATE_HEADERS;
	else if (type === 'APPLICATIONS') {
  // Minimal columns your import expects
  headers = ['appId', 'name', 'appType', 'ownerId', 'ownerAdminId', 'ownerAdminIds', 'ownerAdminTeams', 'description'];
  // (Optional) pre-fill existing apps to let admins "export" and re-import
  rows = applications.map(a => [
    a.id ?? (a as any).appId,
    a.name,
    a.appType ?? 'Application',
    a.ownerId ?? '',
    a.ownerAdminId ?? '',
    getAdminReviewerIds(a).join('; '),
    getAdminTeamLabels(a).join('; '),
    a.description ?? ''
  ]);
}
    else if (type === 'APP_ACCESS') {
      const app = getAppRecord(selectedAppId);
      headers = getTemplateHeadersForAppType(app?.appType);
    }
    else if (type === 'APP_ENT') {
      headers = ENTITLEMENT_TEMPLATE_HEADERS;
      if (selectedAppId) {
        rows = entitlements.filter(e => e.appId === selectedAppId).map(e => [
          e.entitlement, e.description, e.owner, e.isPrivileged ? 'YES' : 'NO'
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
      else if (type === 'APP_ENT') expectedHeaders = ENTITLEMENT_TEMPLATE_HEADERS;
      else if (type === 'APP_SOD') expectedHeaders = SOD_POLICY_TEMPLATE_HEADERS;

      const isValid = type === 'APP_ACCESS' ? true : expectedHeaders.every(h => headers.includes(h));
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

        }

        return obj;
      });
      if (type === 'APP_ACCESS') {
        const targetApp = getAppRecord(appId);
        if (!targetApp) {
          alert('Select an application before uploading accounts.');
          return;
        }
        const draft = buildUploadSchemaDraft(targetApp, headers);
        setUploadSchemaDraft(draft);
        setPendingAccountUpload({
          appId: String(appId || ''),
          headers,
          rows: data,
          fileName: file.name
        });
        setSaveUploadMappingForApp(true);
        setShowUploadMapper(true);
        if (e.target) e.target.value = '';
        return;
      }
      // Special handling for SoD policies: dedupe by policyName and mark existing id for upsert
      if (type === 'APP_SOD') {
        const normalized: any[] = [];
        const seen: Record<string, number> = {};
        data.forEach((d: any) => {
          const name = (d.policyName || d['Policy Name'] || '').toString().trim();
          if (!name) return;
          const existing = sodPolicies.find(p => p.policyName.toLowerCase() === name.toLowerCase());
          // sanitize all fields to strings and trim
          const appId1 = (d.appId1 || d.appId || d.appId_1 || '').toString().trim();
          const entitlement1 = (d.entitlement1 || d.entitlement_1 || d.entitlement || '').toString().trim();
          const appId2 = (d.appId2 || d.appId_2 || '').toString().trim();
          const entitlement2 = (d.entitlement2 || d.entitlement_2 || '').toString().trim();
          const riskLevel = (d.riskLevel || d.risk || 'HIGH').toString().trim().toUpperCase();
          const item = {
            id: existing?.id || (d.id || d.policyId || '').toString().trim(),
            policyName: name,
            appId1,
            entitlement1,
            appId2,
            entitlement2,
            riskLevel
          };
          // If CSV contains duplicates, prefer the last occurrence
          if (seen[name.toLowerCase()] !== undefined) {
            normalized[seen[name.toLowerCase()]] = item;
          } else {
            seen[name.toLowerCase()] = normalized.length;
            normalized.push(item);
          }
        });
        console.debug('Prepared SOD upload payload:', normalized);
        onDataImport(type, normalized);
      } else {
        onDataImport(type, data, appId);
      }
      if (e.target) e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleAddApp = () => {
    const ownerAdminIds = Array.from(new Set(parseDelimitedValues(newApp.ownerAdminIds).concat(parseDelimitedValues(newApp.ownerAdminId))));
    const ownerAdminTeams = Array.from(new Set(parseDelimitedValues(newApp.ownerAdminTeamsText)));
    if (!newApp.name || !newApp.ownerId || ownerAdminIds.length === 0) {
      window.alert("Please fill in Application Name and select both owner levels.");
      return;
    }
    if (newApp.appType === 'Servers' && (!newApp.serverHost || !newApp.serverHostName || !newApp.serverEnvironment)) {
      window.alert('For Servers type, Server Host, Server Host Name, and UAT/PROD are required.');
      return;
    }
    const normalizedNewName = String(newApp.name || '').trim().toLowerCase();
    const duplicateApp = applications.find(app => String(app.name || '').trim().toLowerCase() === normalizedNewName);
    if (duplicateApp) {
      window.alert('Application Name already exists. Please use a unique name.');
      return;
    }
    const appId = `APP_${Date.now()}`;
    onAddApp({
      ...newApp,
      name: String(newApp.name || '').trim(),
      appType: newApp.appType,
      ownerAdminId: ownerAdminIds[0] || '',
      ownerAdminIds,
      ownerAdminTeams,
      accountSchema: buildDefaultAccountSchema(newApp.appType),
      id: appId,
      appId
    });
    setNewApp({
      name: '',
      appType: 'Application',
      ownerId: '',
      ownerAdminId: '',
      ownerAdminIds: [],
      ownerAdminTeamsText: '',
      description: '',
      serverHost: '',
      serverHostName: '',
      serverEnvironment: ''
    });
    setShowAddApp(false);
  };

  const handleSaveAppConfig = () => {
    if (!editingAppConfig) return;

    const nextName = String(editingAppConfig.name || '').trim();
    const ownerAdminIds = getAdminReviewerIds(editingAppConfig);
    if (!nextName || !editingAppConfig.ownerId || ownerAdminIds.length === 0) {
      window.alert('Please provide application name and both owner levels.');
      return;
    }

    if (editingAppConfig.appType === 'Servers' && (!editingAppConfig.serverHost || !editingAppConfig.serverHostName || !editingAppConfig.serverEnvironment)) {
      window.alert('For Servers type, Server Host, Server Host Name, and UAT/PROD are required.');
      return;
    }

    const duplicateApp = applications.find(app =>
      app.id !== editingAppConfig.id &&
      String(app.name || '').trim().toLowerCase() === nextName.toLowerCase()
    );
    if (duplicateApp) {
      window.alert('Application Name already exists. Please use a unique name.');
      return;
    }

    onUpdateApp({
      ...editingAppConfig,
      name: nextName,
      ownerAdminId: ownerAdminIds[0] || '',
      ownerAdminIds,
      ownerAdminTeams: getAdminTeamLabels(editingAppConfig),
      accountSchema: editingAppConfig.accountSchema || buildDefaultAccountSchema(editingAppConfig.appType)
    });
    setEditingAppConfig(null);
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

    // Persist via sod-import endpoint so backend stores the policy
    (async () => {
      try {
        const res = await importSodPolicies([policy]);
        console.debug('sod-import create response:', res);
        onUpdateSoD([...sodPolicies, policy]);
        setShowAddSod(false);
        setNewSod({ riskLevel: 'HIGH' });
      } catch (e: any) {
        console.error('Failed to create SoD policy:', e);
        window.alert('Failed to create SoD policy. ' + (e?.message || ''));
      }
    })();
  };

  const handleDeleteSod = async (policyId: string) => {
    if (!window.confirm('Delete this SoD policy? This cannot be undone.')) return;
    try {
      // Use the existing sod-import endpoint to perform delete operations by sending an item with action: 'DELETE'
      const res = await importSodPolicies([{ action: 'DELETE', id: policyId }]);
      console.debug('sod-import delete response:', res);
      onUpdateSoD(sodPolicies.filter(x => x.id !== policyId));
    } catch (e: any) {
      console.error('Failed to delete SoD policy via import endpoint:', e);
      window.alert('Failed to delete SoD policy. ' + (e?.message || ''));
    }
  };

  const normalizeValue = (value: any) => String(value || '').trim().toLowerCase();
  const parseBool = (value: any) => value === true || value === 1 || String(value || '').trim().toLowerCase() === 'true' || String(value || '').trim().toLowerCase() === 'yes';
  const getAppKey = (app: Application | any) => String(app?.appId || app?.id || '').trim();
  const selectedAppRecord = useMemo(() => getAppRecord(selectedAppId), [applications, selectedAppId]);

  useEffect(() => {
    if (!selectedAppRecord) {
      setSchemaDraft(null);
      return;
    }
    setSchemaDraft(getResolvedAccountSchema(selectedAppRecord));
  }, [selectedAppRecord, selectedAppRecord?.accountSchema]);

  const updateSchemaMapping = (fieldKey: string, sourceColumn: string) => {
    setSchemaDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        mappings: {
          ...(prev.mappings || {}),
          [fieldKey]: sourceColumn
        }
      };
    });
  };

  const updateSchemaIgnoreColumns = (value: string) => {
    setSchemaDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        ignoreColumns: value
          .split(',')
          .map(token => token.trim())
          .filter(Boolean)
      };
    });
  };

  const updateUploadMapping = (fieldKey: string, sourceColumn: string) => {
    setUploadSchemaDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        mappings: {
          ...(prev.mappings || {}),
          [fieldKey]: sourceColumn
        }
      };
    });
  };

  const toggleUploadIgnoreColumn = (column: string) => {
    setUploadSchemaDraft(prev => {
      if (!prev) return prev;
      const normalized = normalizeHeader(column);
      const existing = (prev.ignoreColumns || []).map(c => String(c || '').trim()).filter(Boolean);
      const next = existing.some(c => normalizeHeader(c) === normalized)
        ? existing.filter(c => normalizeHeader(c) !== normalized)
        : [...existing, column];
      return {
        ...prev,
        ignoreColumns: next
      };
    });
  };

  const toggleUploadCustomColumn = (column: string) => {
    setUploadSchemaDraft(prev => {
      if (!prev) return prev;
      const normalized = normalizeHeader(column);
      const existing = (prev.customColumns || []).map(c => String(c || '').trim()).filter(Boolean);
      const next = existing.some(c => normalizeHeader(c) === normalized)
        ? existing.filter(c => normalizeHeader(c) !== normalized)
        : [...existing, column];
      return {
        ...prev,
        customColumns: next
      };
    });
  };

  const saveSchemaConfiguration = () => {
    if (!selectedAppRecord || !schemaDraft) return;
    onUpdateApp({
      ...selectedAppRecord,
      accountSchema: {
        ...schemaDraft,
        schemaAppType: getResolvedAppType(selectedAppRecord)
      }
    });
  };

  useEffect(() => {
    if (!showAddSod) return;
    let alive = true;

    const seed: Record<string, string[]> = {};
    (entitlements || []).forEach((entry) => {
      const appId = String((entry as any)?.appId || '').trim();
      const entitlement = String((entry as any)?.entitlement || '').trim();
      if (!appId || !entitlement) return;
      if (!seed[appId]) seed[appId] = [];
      if (!seed[appId].includes(entitlement)) seed[appId].push(entitlement);
    });
    Object.keys(seed).forEach((appId) => seed[appId].sort((a, b) => a.localeCompare(b)));
    setSodEntitlementsByApp(seed);

    (async () => {
      const merged: Record<string, string[]> = { ...seed };
      await Promise.all(applications.map(async (app) => {
        const appKey = getAppKey(app);
        if (!appKey) return;
        try {
          const res: any = await getEntitlements(appKey, undefined, 500);
          const items = Array.isArray(res?.items) ? res.items : [];
          const list = (Array.from(new Set(items
            .map((entry: any) => String(entry?.entitlement || '').trim())
            .filter(Boolean))) as string[])
            .sort((a, b) => a.localeCompare(b));
          merged[appKey] = list;
        } catch {
          if (!merged[appKey]) merged[appKey] = [];
        }
      }));
      if (alive) setSodEntitlementsByApp(merged);
    })();

    return () => { alive = false; };
  }, [showAddSod, applications, entitlements]);

  const getSodEntitlementOptions = (appId?: string) => {
    const key = String(appId || '').trim();
    if (!key) return [];
    const direct = sodEntitlementsByApp[key] || [];
    const app = applications.find((candidate: any) => String(candidate?.id || '') === key || String(candidate?.appId || '') === key);
    const altId = String((app as any)?.id || '').trim();
    const altAppId = String((app as any)?.appId || '').trim();
    const merged = Array.from(new Set([
      ...direct,
      ...(altId ? (sodEntitlementsByApp[altId] || []) : []),
      ...(altAppId ? (sodEntitlementsByApp[altAppId] || []) : [])
    ]));
    return merged.sort((a, b) => a.localeCompare(b));
  };

  const accountIdentityKey = (acc: ApplicationAccess) => {
    if (acc.correlatedUserId) return `u:${normalizeValue(acc.correlatedUserId)}`;
    if (parseBool((acc as any).isOrphan)) {
      const orphanEmail = normalizeValue(acc.email);
      if (orphanEmail) return `e:${orphanEmail}`;
      const orphanName = normalizeValue(acc.userName);
      if (orphanName) return `n:${orphanName}`;
    }
    const userId = normalizeValue(acc.userId);
    if (userId) return `id:${userId}`;
    const email = normalizeValue(acc.email);
    if (email) return `e:${email}`;
    const userName = normalizeValue(acc.userName);
    if (userName) return `n:${userName}`;
    return `acc:${normalizeValue(acc.id)}`;
  };

  const isPrivilegedEntitlement = (appId: string, entitlement: string) => {
    const appIdNorm = normalizeValue(appId);
    const entNorm = normalizeValue(entitlement);
    return entitlements.some(e => normalizeValue(e.appId) === appIdNorm && normalizeValue(e.entitlement) === entNorm && e.isPrivileged);
  };

  const isPrivilegedAccount = (acc: ApplicationAccess) => {
    return parseBool((acc as any).isPrivileged) || isPrivilegedEntitlement(acc.appId, acc.entitlement);
  };

  const selectedAppData = access.filter(a => a.appId === selectedAppId);
  const selectedEntitlements = entitlements.filter(e => e.appId === selectedAppId);
  const filteredApplications = useMemo(() => {
    const query = String(appSearchQuery || '').trim().toLowerCase();
    if (!query) return applications;
    return applications.filter(app => {
      const ownerName = users.find(u => u.id === app.ownerId)?.name || '';
      const ownerAdminName = getAdminDisplayText(app);
      const fields = [
        String(app.name || ''),
        String((app as any).id || (app as any).appId || ''),
        String(app.appType || 'Application'),
        String(ownerName),
        String(ownerAdminName)
      ]
        .join(' ')
        .toLowerCase();
      return fields.includes(query);
    });
  }, [applications, users, appSearchQuery]);
  const groupedFilteredApplications = useMemo(() => {
    const grouped: Record<string, Application[]> = {};
    filteredApplications.forEach(app => {
      const appType = getResolvedAppType(app);
      if (!grouped[appType]) grouped[appType] = [];
      grouped[appType].push(app);
    });

    const orderedEntries: Array<[string, Application[]]> = [];
    APPLICATION_TYPE_OPTIONS.forEach(appType => {
      if (grouped[appType]?.length) {
        orderedEntries.push([
          appType,
          [...grouped[appType]].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        ]);
        delete grouped[appType];
      }
    });

    Object.entries(grouped)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([appType, apps]) => {
        orderedEntries.push([appType, [...apps].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))]);
      });

    return orderedEntries;
  }, [filteredApplications]);
  const selectedSchemaTemplate = selectedAppRecord
    ? APP_TYPE_SCHEMA_TEMPLATES[getResolvedAppType(selectedAppRecord)]
    : APP_TYPE_SCHEMA_TEMPLATES.Application;
  const isAppTypeGroupCollapsed = (appType: string) => {
    if (String(appSearchQuery || '').trim()) return false;
    return collapsedAppTypeGroups[appType] === true;
  };
  const toggleAppTypeGroup = (appType: string) => {
    setCollapsedAppTypeGroups(prev => ({
      ...prev,
      [appType]: !(prev[appType] === true)
    }));
  };
  const selectedAppCustomColumns = (selectedAppRecord?.accountSchema?.customColumns || [])
    .map(col => String(col || '').trim())
    .filter(Boolean);

  const selectedAppRiskByAccountId = useMemo(() => {
    const grouped: Record<string, Array<{ appId: string; entitlement: string }>> = {};
    access.forEach(acc => {
      const key = accountIdentityKey(acc);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({ appId: normalizeValue(acc.appId), entitlement: acc.entitlement });
    });

    const out = new Map<string, { hasSod: boolean; violatedPolicyIds: string[]; violatedPolicyNames: string[] }>();

    selectedAppData.forEach(acc => {
      const key = accountIdentityKey(acc);
      const entries = grouped[key] || [];
      const violated = sodPolicies.filter(policy => {
        const has1 = entries.some(entry => entry.appId === normalizeValue(policy.appId1) && normalizeValue(entry.entitlement) === normalizeValue(policy.entitlement1));
        const has2 = entries.some(entry => entry.appId === normalizeValue(policy.appId2) && normalizeValue(entry.entitlement) === normalizeValue(policy.entitlement2));
        if (!has1 || !has2) return false;
        return (
          (normalizeValue(acc.appId) === normalizeValue(policy.appId1) && normalizeValue(acc.entitlement) === normalizeValue(policy.entitlement1)) ||
          (normalizeValue(acc.appId) === normalizeValue(policy.appId2) && normalizeValue(acc.entitlement) === normalizeValue(policy.entitlement2))
        );
      });

      out.set(acc.id, {
        hasSod: violated.length > 0,
        violatedPolicyIds: violated.map(policy => policy.id),
        violatedPolicyNames: violated.map(policy => policy.policyName)
      });
    });

    return out;
  }, [access, selectedAppData, sodPolicies]);

  const getRiskDisplay = (acc: ApplicationAccess | { entitlements: ApplicationAccess[], isOrphan: boolean }) => {
    let hasSod = false;
    let policies: { name: string, id: string }[] = [];
    let isOrphan = false;
    let hasPrivileged = false;

    if ('entitlements' in acc) {
      hasSod = acc.entitlements.some(e => e.isSoDConflict || !!selectedAppRiskByAccountId.get(e.id)?.hasSod);
      const uniquePolicyIds = Array.from(new Set(acc.entitlements.flatMap(e => {
        const derived = selectedAppRiskByAccountId.get(e.id);
        return [...(e.violatedPolicyIds || []), ...(derived?.violatedPolicyIds || [])];
      })));
      policies = uniquePolicyIds.map(id => ({ 
        id, 
        name: sodPolicies.find(p => p.id === id)?.policyName || 'Unknown Policy' 
      }));
      isOrphan = acc.isOrphan;
      hasPrivileged = acc.entitlements.some(e => isPrivilegedAccount(e));
    } else {
      const derived = selectedAppRiskByAccountId.get(acc.id);
      hasSod = acc.isSoDConflict || !!derived?.hasSod;
      const policyIds = Array.from(new Set([...(acc.violatedPolicyIds || []), ...(derived?.violatedPolicyIds || [])]));
      policies = policyIds.map(id => ({ 
        id, 
        name: sodPolicies.find(p => p.id === id)?.policyName || 'Unknown Policy' 
      }));
      isOrphan = acc.isOrphan;
      hasPrivileged = isPrivilegedAccount(acc);
    }

    // Classification Level
    let level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
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
            {`${level} RISK`}
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

  const groupedSelectedAppData = useMemo(() => {
    if (!groupInApp) return null;
    const groups: Record<string, { userId: string, userName: string, entitlements: ApplicationAccess[], isOrphan: boolean }> = {};
    selectedAppData.forEach(acc => {
      const key = accountIdentityKey(acc);
      if (!groups[key]) groups[key] = { userId: acc.userId, userName: acc.userName, entitlements: [], isOrphan: parseBool((acc as any).isOrphan) };
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
            const resolveRiskKey = (acc: ApplicationAccess) => {
              if (acc.correlatedUserId) return `u:${acc.correlatedUserId}`;
              const email = String(acc.email || '').trim().toLowerCase();
              if (email) return `e:${email}`;
              const userId = String(acc.userId || '').trim();
              if (userId) return `id:${userId}`;
              return `n:${String(acc.userName || '').trim().toLowerCase()}`;
            };
            const userAccessMap: Record<string, { appId: string; entitlement: string }[]> = {};
            items.forEach(acc => {
              const key = resolveRiskKey(acc);
              if (!key) return;
              if (!userAccessMap[key]) userAccessMap[key] = [];
              userAccessMap[key].push({ appId: acc.appId, entitlement: acc.entitlement });
            });
            const final = items.map(acc => {
              const key = resolveRiskKey(acc);
              const userItems = userAccessMap[key] || [];
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
        const resolveRiskKey = (acc: ApplicationAccess) => {
          if (acc.correlatedUserId) return `u:${acc.correlatedUserId}`;
          const email = String(acc.email || '').trim().toLowerCase();
          if (email) return `e:${email}`;
          const userId = String(acc.userId || '').trim();
          if (userId) return `id:${userId}`;
          return `n:${String(acc.userName || '').trim().toLowerCase()}`;
        };
        const userAccessMap: Record<string, { appId: string; entitlement: string }[]> = {};
        items.forEach(acc => {
          const key = resolveRiskKey(acc);
          if (!key) return;
          if (!userAccessMap[key]) userAccessMap[key] = [];
          userAccessMap[key].push({ appId: acc.appId, entitlement: acc.entitlement });
        });

        const final = items.map(acc => {
          const key = resolveRiskKey(acc);
          const userItems = userAccessMap[key] || [];
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

  const getUserRole = (u: any): 'ADMIN' | 'AUDITOR' | 'USER' => {
    const role = String(u?.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'AUDITOR') return role;
    return 'USER';
  };

  const handleResetPassword = async (u: User) => {
    try {
      setResettingUserId(u.id);
      setCopiedPassword(false);
      const res = await onResetUserPassword(u.id);
      const temporaryPassword = String(res?.temporaryPassword || '');
      if (!temporaryPassword) {
        alert('Password reset completed, but no temporary password was returned.');
        return;
      }
      setResetResult({ userId: u.id, name: u.name, temporaryPassword });
    } catch (e: any) {
      alert(`Failed to reset password: ${e?.message || 'Unknown error'}`);
    } finally {
      setResettingUserId(null);
    }
  };

  const copyResetPassword = async () => {
    if (!resetResult?.temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(resetResult.temporaryPassword);
      setCopiedPassword(true);
    } catch {
      alert('Copy failed. Please copy the password manually before clicking OK.');
    }
  };

  const closeResetPasswordModal = () => {
    setResetResult(null);
    setCopiedPassword(false);
  };

  const handleRoleChange = async (userId: string, role: 'ADMIN' | 'AUDITOR' | 'USER') => {
    try {
      setUpdatingRoleUserId(userId);
      await onSetUserRole(userId, role);
    } catch (e: any) {
      alert(`Failed to update role: ${e?.message || 'Unknown error'}`);
    } finally {
      setUpdatingRoleUserId(null);
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const toggleSelectAllUsers = () => {
    if (selectedUserIds.length === users.length) {
      setSelectedUserIds([]);
      return;
    }
    setSelectedUserIds(users.map(user => user.id));
  };

  const handleBulkRoleApply = async () => {
    if (selectedUserIds.length === 0) {
      alert('Select at least one user.');
      return;
    }
    try {
      setBulkUpdatingRole(true);
      await onBulkSetUserRole(selectedUserIds, bulkRole);
      alert(`Updated role to ${bulkRole} for ${selectedUserIds.length} user(s).`);
      setSelectedUserIds([]);
      setShowBulkRoleModal(false);
    } catch (e: any) {
      alert(`Bulk role update failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setBulkUpdatingRole(false);
    }
  };

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
              <button
                onClick={() => setShowBulkRoleModal(true)}
                disabled={bulkUpdatingRole || selectedUserIds.length === 0}
                className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed"
                style={bulkUpdatingRole || selectedUserIds.length === 0 ? undefined : { backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                {bulkUpdatingRole ? 'Updating...' : `Set Role (${selectedUserIds.length})`}
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
                      <th className="px-6 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={users.length > 0 && selectedUserIds.length === users.length}
                          onChange={toggleSelectAllUsers}
                          className="rounded text-blue-600"
                        />
                      </th>
                      <th className="px-6 py-3">Employee ID</th>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Department</th>
                      <th className="px-6 py-3">Reporting Manager</th>
                      <th className="px-6 py-3">Access Summary</th>
                      <th className="px-6 py-3">Role</th>
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
                          <td className="px-6 py-4">
                            <input
                              type="checkbox"
                              checked={selectedUserIds.includes(u.id)}
                              onChange={() => toggleUserSelection(u.id)}
                              className="rounded text-blue-600"
                            />
                          </td>
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
                          <td className="px-6 py-4">
                            <select
                              value={getUserRole(u)}
                              disabled={updatingRoleUserId === u.id}
                              onChange={(e) => handleRoleChange(u.id, e.target.value as 'ADMIN' | 'AUDITOR' | 'USER')}
                              className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white"
                            >
                              <option value="ADMIN">Admin</option>
                              <option value="AUDITOR">Auditor</option>
                              <option value="USER">User</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => handleResetPassword(u)}
                                disabled={resettingUserId === u.id}
                                className="text-orange-600 hover:text-orange-800 flex items-center gap-1.5 font-bold text-xs disabled:text-slate-300 disabled:cursor-not-allowed"
                              >
                                <KeyRound className="w-3.5 h-3.5" /> {resettingUserId === u.id ? 'Resetting...' : 'Reset Password'}
                              </button>
                              <button onClick={() => setViewingUserId(u.id)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1.5 font-bold text-xs">
                                <Eye className="w-3.5 h-3.5" /> Drill Down
                              </button>
                            </div>
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

      {resetResult && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Password updated successfully</h3>
            <p className="text-sm text-slate-600 mt-1">Share this temporary password with {resetResult.name} ({resetResult.userId}). It will not be shown again after you click OK.</p>

            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Temporary Password</p>
              <p className="mt-1 text-sm font-mono text-slate-800 break-all">{resetResult.temporaryPassword}</p>
            </div>

            <div className="mt-5 flex items-center gap-3 justify-end">
              <button
                onClick={copyResetPassword}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
              >
                <Copy className="w-4 h-4" /> {copiedPassword ? 'Copied' : 'Copy Password'}
              </button>
              <button
                onClick={closeResetPasswordModal}
                className="px-4 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkRoleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Bulk Role Assignment</h3>
            <p className="text-sm text-slate-600 mt-1">Selected users: {selectedUserIds.length}</p>

            <div className="mt-4">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Select Role</label>
              <select
                value={bulkRole}
                onChange={(e) => setBulkRole(e.target.value as 'ADMIN' | 'AUDITOR' | 'USER')}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 bg-white"
              >
                <option value="ADMIN">Admin</option>
                <option value="AUDITOR">Auditor</option>
                <option value="USER">User</option>
              </select>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowBulkRoleModal(false)}
                disabled={bulkUpdatingRole}
                className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkRoleApply}
                disabled={bulkUpdatingRole || selectedUserIds.length === 0}
                className="px-4 py-2 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:bg-slate-300 disabled:cursor-not-allowed"
                style={bulkUpdatingRole || selectedUserIds.length === 0 ? undefined : { backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                {bulkUpdatingRole ? 'Updating...' : 'Apply Role'}
              </button>
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
                <Download className="w-4 h-4" /> Template
              </button>
              <input type="file" ref={sodInputRef} className="hidden" accept=".csv" onChange={(e) => handleFileUpload(e, 'APP_SOD')} />
              <button onClick={() => sodInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800">
                <Upload className="w-4 h-4" /> Upload
              </button>
              <button
                onClick={() => setShowAddSod(true)}
                className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
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
                  <th className="px-6 py-4">Policy Severity</th>
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
                          <button onClick={() => handleDeleteSod(p.id)} className="text-red-400 hover:text-red-600">
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
        <div className="space-y-6">
          {/* Header Box - Same pattern as SoD */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-blue-100 p-3 rounded-xl">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-lg">Application Onboarding</h3>
                <p className="text-sm text-slate-500">Create, configure, and manage connected applications.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => downloadTemplate('APPLICATIONS')}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                <Download className="w-4 h-4" /> Template
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
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800"
              >
                <Upload className="w-4 h-4" /> Upload
              </button>
              <button 
                onClick={() => setShowAddApp(true)} 
                className="flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 transition-all"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                <Plus className="w-4 h-4" /> Add Application
              </button>
            </div>
          </div>

          {/* Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Left Sidebar - Application List */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-4 space-y-2 max-h-[600px] overflow-y-auto">
                <div className="sticky top-0 bg-white pb-2 z-10">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Search Applications</label>
                  <input
                    type="text"
                    value={appSearchQuery}
                    onChange={(e) => setAppSearchQuery(e.target.value)}
                    placeholder="Search by name, id, type, owner"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs"
                  />
                </div>
                {applications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-center">
                    <Database className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-sm font-medium">No applications yet.</p>
                    <p className="text-xs opacity-70">Click "Add Application" above to create one.</p>
                  </div>
                ) : groupedFilteredApplications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-center">
                    <FileText className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-sm font-medium">No matching applications.</p>
                    <p className="text-xs opacity-70">Try a different search keyword.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groupedFilteredApplications.map(([appType, apps]) => (
                      <div key={`app-type-${appType}`} className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleAppTypeGroup(appType)}
                          className="w-full flex items-center justify-between px-1 pt-1 pb-1 rounded hover:bg-slate-50"
                        >
                          <div className="flex items-center gap-1.5">
                            <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isAppTypeGroupCollapsed(appType) ? '' : 'rotate-90'}`} />
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{appType}</p>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400">{apps.length}</span>
                        </button>
                        {!isAppTypeGroupCollapsed(appType) && apps.map(app => (
                          <button key={app.id} onClick={() => {
                            setSelectedAppId(app.id);
                            onSelectApp?.(app.id);
                          }} className={`w-full text-left p-3 rounded-lg border transition-all ${selectedAppId === app.id ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-slate-50 border-slate-200 hover:border-blue-300 hover:bg-white'}`}>
                            <div className="font-bold flex justify-between items-center">
                              <span className="truncate">{app.name}</span>
                              {selectedAppId === app.id && <Settings2 className="w-3.5 h-3.5 shrink-0 ml-2" />}
                            </div>
                            <div className={`text-[11px] mt-1.5 ${selectedAppId === app.id ? 'text-blue-100' : 'text-slate-500'}`}>
                              {app.appType || 'Application'}
                            </div>
                            <div className={`text-[11px] mt-0.5 ${selectedAppId === app.id ? 'text-blue-100' : 'text-slate-500'}`}>
                              {getOwnerLabels(app.appType).primary}: {users.find(u => u.id === app.ownerId)?.name || 'Unknown'}
                            </div>
                            <div className={`text-[11px] mt-0.5 ${selectedAppId === app.id ? 'text-blue-100' : 'text-slate-500'}`}>
                              {getOwnerLabels(app.appType).secondary}: {getAdminDisplayText(app)}
                            </div>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel - Application Detail */}
            <div className="lg:col-span-3">
            {selectedAppId ? (
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{applications.find(a => a.id === selectedAppId)?.name}</h3>
                    <p className="text-xs text-slate-400 uppercase font-bold tracking-wider mt-1">{applications.find(a => a.id === selectedAppId)?.appType || 'Application'}</p>
                    <p className="text-xs text-slate-500 mt-1">{applications.find(a => a.id === selectedAppId)?.description || 'No description provided.'}</p>
                    {applications.find(a => a.id === selectedAppId)?.appType === 'Servers' && (
                      <p className="text-xs text-slate-500 mt-1">
                        Host: {(applications.find(a => a.id === selectedAppId) as any)?.serverHost || '-'} | Host Name: {(applications.find(a => a.id === selectedAppId) as any)?.serverHostName || '-'} | Env: {(applications.find(a => a.id === selectedAppId) as any)?.serverEnvironment || '-'}
                      </p>
                    )}
                    <p className="text-sm text-slate-500">Manage accounts, definitions, and SoD rules.</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const app = applications.find(a => a.id === selectedAppId);
                        if (!app) return;
                        setEditingAppConfig({
                          ...app,
                          appType: app.appType || 'Application',
                          description: app.description || '',
                          serverHost: (app as any).serverHost || '',
                          serverHostName: (app as any).serverHostName || '',
                          serverEnvironment: (app as any).serverEnvironment || ''
                        });
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 text-blue-600 hover:bg-blue-50 rounded-lg text-xs font-bold border border-transparent hover:border-blue-100 transition-all"
                    >
                      <Edit2 className="w-4 h-4" /> Edit Configuration
                    </button>
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
                        <button onClick={() => setShowSchemaConfig(prev => !prev)} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold hover:bg-slate-50">
                          <Settings2 className="w-3.5 h-3.5" /> {showSchemaConfig ? 'Hide Mapping' : 'Configure Mapping'}
                        </button>
                        {showSchemaConfig && (
                          <button onClick={saveSchemaConfiguration} className="flex items-center gap-1.5 px-3 py-1.5 text-white rounded-lg text-xs font-bold hover:opacity-90" style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}>
                            Save Mapping
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={groupInApp} onChange={e => setGroupInApp(e.target.checked)} className="rounded text-blue-600" />
                          <span className="text-xs font-bold text-slate-600">Group by Identity</span>
                        </label>
                      </div>
                    </div>

                    {showSchemaConfig && schemaDraft && (
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                        <div>
                          <p className="text-xs font-black text-slate-700">Account Feed Mapping</p>
                          <p className="text-[11px] text-slate-500">Map feed columns to canonical fields for this application. This override applies only to this app.</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {selectedSchemaTemplate.fields.map(field => (
                            <div key={field.key}>
                              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                                {field.label}{field.required ? ' *' : ''}
                              </label>
                              <input
                                type="text"
                                value={schemaDraft.mappings?.[field.key] || ''}
                                onChange={(event) => updateSchemaMapping(field.key, event.target.value)}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                                placeholder={`Source column for ${field.label}`}
                              />
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ignore Columns</label>
                          <input
                            type="text"
                            value={(schemaDraft.ignoreColumns || []).join(', ')}
                            onChange={(event) => updateSchemaIgnoreColumns(event.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                            placeholder="Comma-separated source columns to ignore"
                          />
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-50 rounded-xl border overflow-hidden max-h-[600px] overflow-y-auto shadow-inner">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-slate-100 z-10">
                          <tr className="text-slate-400 uppercase font-bold border-b">
                            <th className="px-4 py-3">Identity / Account</th>
                            <th className="px-4 py-3">Correlation</th>
                            <th className="px-4 py-3">Entitlement(s)</th>
                            <th className="px-4 py-3">Status</th>
                            {selectedAppCustomColumns.map(col => (
                              <th key={col} className="px-4 py-3">{col}</th>
                            ))}
                            <th className="px-4 py-3">Risk Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {groupInApp ? (
                            groupedSelectedAppData?.map(group => {
                              const hasPrivileged = group.entitlements.some(e => isPrivilegedAccount(e));
                              
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
                                        <code key={e.id} className={`px-1 rounded border ${(e.isSoDConflict || !!selectedAppRiskByAccountId.get(e.id)?.hasSod) ? 'bg-red-50 text-red-700 border-red-100 font-bold' : isPrivilegedEntitlement(e.appId, e.entitlement) ? 'bg-indigo-50 text-indigo-700 border-indigo-100 font-bold' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>{e.entitlement}</code>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-[10px] font-bold text-slate-500">
                                      {Array.from(new Set(group.entitlements.map(e => String((e as any).accountStatus || '').trim()).filter(Boolean))).join(', ') || '-'}
                                    </span>
                                  </td>
                                  {selectedAppCustomColumns.map(col => (
                                    <td key={`${group.userId}-${col}`} className="px-4 py-3">
                                      <span className="text-[10px] font-bold text-slate-500">
                                        {Array.from(new Set(group.entitlements
                                          .map(e => String((e as any)?.customAttributes?.[col] || (e as any)?.[col] || '').trim())
                                          .filter(Boolean))).join(', ') || '-'}
                                      </span>
                                    </td>
                                  ))}
                                  <td className="px-4 py-3">
                                    {getRiskDisplay(group)}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            selectedAppData.map(acc => {
                              const isPriv = isPrivilegedAccount(acc);
                              const hasSod = acc.isSoDConflict || !!selectedAppRiskByAccountId.get(acc.id)?.hasSod;
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
                                    <code className={`px-1.5 py-0.5 rounded border ${hasSod ? 'bg-red-50 text-red-700 border-red-100 font-bold' : isPriv ? 'bg-indigo-50 text-indigo-700 border-indigo-100 font-bold' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>{acc.entitlement}</code>
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-[10px] font-bold text-slate-500">{String((acc as any).accountStatus || '').trim() || '-'}</span>
                                  </td>
                                  {selectedAppCustomColumns.map(col => (
                                    <td key={`${acc.id}-${col}`} className="px-4 py-3">
                                      <span className="text-[10px] font-bold text-slate-500">{String((acc as any)?.customAttributes?.[col] || (acc as any)?.[col] || '').trim() || '-'}</span>
                                    </td>
                                  ))}
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
                        <button onClick={() => downloadTemplate('APP_ENT')} className="flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> Template</button>
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
                            <th className="px-4 py-3">Privileged?</th>
                            <th className="px-4 py-3">Owner</th>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-4 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {selectedEntitlements.length === 0 ? (
                            <tr><td colSpan={5} className="py-20 text-center opacity-50">No catalog data. Upload accounts to auto-generate.</td></tr>
                          ) : (
                            selectedEntitlements.map(ent => (
                              <tr key={ent.entitlement} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-3 font-bold">{ent.entitlement}</td>
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
              <div className="flex flex-col items-center justify-center py-40 bg-white border border-dashed rounded-2xl text-slate-400 shadow-sm">
                <Settings2 className="w-16 h-16 mb-4 opacity-10" />
                <p className="font-medium text-center">Select an application from the list to view details and manage accounts.</p>
              </div>
            )}
            </div>
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
                    <span className="text-xs font-bold text-slate-400 uppercase">Policy Severity</span>
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
                            const isPriv = isPrivilegedAccount(acc);
                            const isOrphan = parseBool((acc as any).isOrphan);
                            const hasSod = acc.isSoDConflict;
                            const level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = hasSod ? 'CRITICAL' : isOrphan ? 'HIGH' : isPriv ? 'MEDIUM' : 'LOW';
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
          </div>
        </div>
      )}

      {showUploadMapper && pendingAccountUpload && uploadSchemaDraft && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 w-full max-w-4xl shadow-2xl animate-in zoom-in-95">
            {(() => {
              const mapperAppType = selectedAppRecord ? getResolvedAppType(selectedAppRecord) : 'Application';
              const correlationFieldKey = getCorrelationFieldKey(mapperAppType);
              const entitlementFieldKey = getEntitlementFieldKey(mapperAppType);
              const correlationFieldLabel = getCorrelationFieldLabel(mapperAppType);
              const entitlementFieldLabel = getEntitlementFieldLabel(mapperAppType);
              return (
                <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Map Feed Columns</h3>
                <p className="text-sm text-slate-500 mt-1">File: {pendingAccountUpload.fileName} | App: {selectedAppRecord?.name || pendingAccountUpload.appId}</p>
              </div>
              <button onClick={() => { setShowUploadMapper(false); setPendingAccountUpload(null); setUploadSchemaDraft(null); setSaveUploadMappingForApp(true); }} className="p-2 hover:bg-slate-100 rounded-full"><X className="w-5 h-5" /></button>
            </div>

            <div className="mt-6 max-h-[65vh] overflow-y-auto space-y-6 pr-1">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-black text-blue-900 uppercase tracking-wider">Required Upload Selections</p>
                <p className="text-[11px] text-blue-800">{getCorrelationFieldGuidance(mapperAppType)}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-blue-700 uppercase mb-1">Correlation Column ({correlationFieldLabel}) *</label>
                    <select
                      className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-xs"
                      value={uploadSchemaDraft.mappings?.[correlationFieldKey] || ''}
                      onChange={(event) => updateUploadMapping(correlationFieldKey, event.target.value)}
                    >
                      <option value="">-- Select Correlation Column --</option>
                      {pendingAccountUpload.headers.map(header => <option key={`correlation-${header}`} value={header}>{header}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-blue-700 uppercase mb-1">Entitlement Column ({entitlementFieldLabel}) *</label>
                    <select
                      className="w-full px-3 py-2 bg-white border border-blue-200 rounded-lg text-xs"
                      value={uploadSchemaDraft.mappings?.[entitlementFieldKey] || ''}
                      onChange={(event) => updateUploadMapping(entitlementFieldKey, event.target.value)}
                    >
                      <option value="">-- Select Entitlement Column --</option>
                      {pendingAccountUpload.headers.map(header => <option key={`entitlement-${header}`} value={header}>{header}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <p className="text-xs font-black text-slate-700 uppercase tracking-wider">Canonical Mapping</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  {selectedSchemaTemplate.fields.map(field => (
                    <div key={`upload-${field.key}`}>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">{field.label}{field.required ? ' *' : ''}</label>
                      <select
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                        value={uploadSchemaDraft.mappings?.[field.key] || ''}
                        onChange={(event) => updateUploadMapping(field.key, event.target.value)}
                      >
                        <option value="">-- Not mapped --</option>
                        {pendingAccountUpload.headers.map(header => <option key={`${field.key}-${header}`} value={header}>{header}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-black text-slate-700 uppercase tracking-wider">Ignore Columns</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-y-auto pr-1">
                    {pendingAccountUpload.headers.map(header => {
                      const checked = (uploadSchemaDraft.ignoreColumns || []).some(col => normalizeHeader(col) === normalizeHeader(header));
                      return (
                        <label key={`ignore-${header}`} className="flex items-center gap-2 text-xs text-slate-600">
                          <input type="checkbox" checked={checked} onChange={() => toggleUploadIgnoreColumn(header)} className="rounded text-blue-600" />
                          <span>{header}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-xs font-black text-slate-700 uppercase tracking-wider">Show As Custom Columns</p>
                  <p className="text-[10px] text-slate-500 mt-1">Selected columns will be stored and shown for this app in the accounts grid.</p>
                  <div className="mt-3 space-y-2 max-h-52 overflow-y-auto pr-1">
                    {pendingAccountUpload.headers.map(header => {
                      const isIgnored = (uploadSchemaDraft.ignoreColumns || []).some(col => normalizeHeader(col) === normalizeHeader(header));
                      const checked = (uploadSchemaDraft.customColumns || []).some(col => normalizeHeader(col) === normalizeHeader(header));
                      return (
                        <label key={`custom-${header}`} className={`flex items-center gap-2 text-xs ${isIgnored ? 'text-slate-300' : 'text-slate-600'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isIgnored}
                            onChange={() => toggleUploadCustomColumn(header)}
                            className="rounded text-blue-600"
                          />
                          <span>{header}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                  <input
                    type="checkbox"
                    checked={saveUploadMappingForApp}
                    onChange={(event) => setSaveUploadMappingForApp(event.target.checked)}
                    className="rounded text-blue-600"
                  />
                  Save this mapping as default for this application only
                </label>
                <p className="text-xs text-blue-700 mt-1">This will not change mappings for other applications or app types.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button onClick={() => { setShowUploadMapper(false); setPendingAccountUpload(null); setUploadSchemaDraft(null); setSaveUploadMappingForApp(true); }} className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={confirmUploadMapping}
                className="flex-1 px-6 py-3 text-white rounded-xl font-bold shadow-lg hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                Confirm Mapping And Upload
              </button>
            </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {editingAppConfig && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 w-full max-w-xl shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold mb-6 text-slate-900">Edit Application Configuration</h3>
            <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Application Name</label>
                <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={editingAppConfig.name || ''} onChange={e => setEditingAppConfig({ ...editingAppConfig, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Type</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={editingAppConfig.appType || 'Application'} onChange={e => setEditingAppConfig({ ...editingAppConfig, appType: e.target.value as NonNullable<Application['appType']> })}>
                  {APPLICATION_TYPE_OPTIONS.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Description</label>
                <textarea className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" rows={3} value={editingAppConfig.description || ''} onChange={e => setEditingAppConfig({ ...editingAppConfig, description: e.target.value })} />
              </div>
              {editingAppConfig.appType === 'Servers' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Server Host</label>
                    <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={editingAppConfig.serverHost || ''} onChange={e => setEditingAppConfig({ ...editingAppConfig, serverHost: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Server Host Name</label>
                    <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={editingAppConfig.serverHostName || ''} onChange={e => setEditingAppConfig({ ...editingAppConfig, serverHostName: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Environment</label>
                    <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={editingAppConfig.serverEnvironment || ''} onChange={e => setEditingAppConfig({ ...editingAppConfig, serverEnvironment: e.target.value as 'UAT' | 'PROD' | '' })}>
                      <option value="">Select Environment...</option>
                      <option value="UAT">UAT</option>
                      <option value="PROD">PROD</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">{getOwnerLabels(editingAppConfig.appType).primary}</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={editingAppConfig.ownerId || ''} onChange={e => setEditingAppConfig({ ...editingAppConfig, ownerId: e.target.value })}>
                  <option value="">Select Identity...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">{getOwnerLabels(editingAppConfig.appType).secondary}</label>
                <select
                  multiple
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none min-h-[140px]"
                  value={getAdminReviewerIds(editingAppConfig)}
                  onChange={e => {
                    const ownerAdminIds = Array.from(e.currentTarget.selectedOptions as HTMLCollectionOf<HTMLOptionElement>).map((option: HTMLOptionElement) => option.value);
                    setEditingAppConfig({ ...editingAppConfig, ownerAdminIds, ownerAdminId: ownerAdminIds[0] || '' });
                  }}
                >
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">Hold Ctrl to select multiple reviewer identities.</p>
                <input
                  type="text"
                  className="mt-3 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none"
                  value={getAdminTeamLabels(editingAppConfig).join(', ')}
                  onChange={e => setEditingAppConfig({ ...editingAppConfig, ownerAdminTeams: parseDelimitedValues(e.target.value) })}
                  placeholder="Optional teams, e.g. App Admin, DB Admin"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setEditingAppConfig(null)} className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleSaveAppConfig}
                className="flex-1 px-6 py-3 text-white rounded-xl font-bold shadow-lg hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                Save Changes
              </button>
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
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Type</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={newApp.appType} onChange={e => setNewApp({...newApp, appType: e.target.value as NonNullable<Application['appType']>})}>
                  {APPLICATION_TYPE_OPTIONS.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Description</label>
                <textarea className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" rows={3} value={newApp.description} onChange={e => setNewApp({...newApp, description: e.target.value})} />
              </div>
              {newApp.appType === 'Servers' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Server Host</label>
                    <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={newApp.serverHost} onChange={e => setNewApp({...newApp, serverHost: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Server Host Name</label>
                    <input type="text" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={newApp.serverHostName} onChange={e => setNewApp({...newApp, serverHostName: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Environment</label>
                    <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={newApp.serverEnvironment} onChange={e => setNewApp({...newApp, serverEnvironment: e.target.value as 'UAT' | 'PROD' | ''})}>
                      <option value="">Select Environment...</option>
                      <option value="UAT">UAT</option>
                      <option value="PROD">PROD</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">{getOwnerLabels(newApp.appType).primary}</label>
                <select className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none" value={newApp.ownerId} onChange={e => setNewApp({...newApp, ownerId: e.target.value})}>
                  <option value="">Select Identity...</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">{getOwnerLabels(newApp.appType).secondary}</label>
                <select
                  multiple
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none min-h-[140px]"
                  value={newApp.ownerAdminIds}
                  onChange={e => {
                    const ownerAdminIds = Array.from(e.currentTarget.selectedOptions as HTMLCollectionOf<HTMLOptionElement>).map((option: HTMLOptionElement) => option.value);
                    setNewApp({ ...newApp, ownerAdminIds, ownerAdminId: ownerAdminIds[0] || '' });
                  }}
                >
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.id})</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">Hold Ctrl to select multiple reviewer identities.</p>
                <input
                  type="text"
                  className="mt-3 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 outline-none"
                  value={newApp.ownerAdminTeamsText}
                  onChange={e => setNewApp({...newApp, ownerAdminTeamsText: e.target.value})}
                  placeholder="Optional teams, e.g. App Admin, DB Admin"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setShowAddApp(false)} className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleAddApp}
                className="flex-1 px-6 py-3 text-white rounded-xl font-bold shadow-lg hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                Add App
              </button>
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
              <div className="flex items-center h-full pt-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded text-blue-600" 
                    checked={editingEnt.isPrivileged} 
                    onChange={e => setEditingEnt({...editingEnt, isPrivileged: e.target.checked})} 
                    />
                  <span className="text-sm font-bold text-slate-700">Privileged Entitlement?</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setEditingEnt(null)} className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={() => { onUpdateEntitlement(editingEnt); setEditingEnt(null); }}
                className="flex-1 px-6 py-3 text-white rounded-xl font-bold shadow-lg hover:opacity-90"
                style={{ backgroundColor: 'var(--ag-primary, #2563eb)', color: 'var(--ag-on-primary, #ffffff)' }}
              >
                Save Changes
              </button>
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
                      {applications.map(app => <option key={getAppKey(app)} value={getAppKey(app)}>{app.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Entitlement</label>
                    <select className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg" value={newSod.entitlement1 || ''} onChange={e => setNewSod({...newSod, entitlement1: e.target.value})} disabled={!newSod.appId1}>
                      <option value="">Select Entitlement...</option>
                      {getSodEntitlementOptions(newSod.appId1).map((entitlement) => <option key={entitlement} value={entitlement}>{entitlement}</option>)}
                    </select>
                    {newSod.appId1 && getSodEntitlementOptions(newSod.appId1).length === 0 && (
                      <p className="mt-1 text-[10px] text-slate-400">No entitlements found for this app.</p>
                    )}
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
                      {applications.map(app => <option key={getAppKey(app)} value={getAppKey(app)}>{app.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 mb-1">Entitlement</label>
                    <select className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg" value={newSod.entitlement2 || ''} onChange={e => setNewSod({...newSod, entitlement2: e.target.value})} disabled={!newSod.appId2}>
                      <option value="">Select Entitlement...</option>
                      {getSodEntitlementOptions(newSod.appId2).map((entitlement) => <option key={entitlement} value={entitlement}>{entitlement}</option>)}
                    </select>
                    {newSod.appId2 && getSodEntitlementOptions(newSod.appId2).length === 0 && (
                      <p className="mt-1 text-[10px] text-slate-400">No entitlements found for this app.</p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5">Policy Severity</label>
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