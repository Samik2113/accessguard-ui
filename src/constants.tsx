
import React from 'react';
import { Shield, FileCheck, BarChart3, History, Layers, UserCheck } from 'lucide-react';
import { AppAccountSchemaConfig, AppTypeSchemaTemplate, Application, HrFeedSchemaConfig, HrSchemaFieldDefinition, UserRole } from './types';

export const NAV_ITEMS = [
  { id: 'my-team-access', label: 'My Team Access', icon: <UserCheck className="w-5 h-5" />, panel: 'workspace', roles: [UserRole.ADMIN, UserRole.AUDITOR, UserRole.USER] },
  { id: 'reviews', label: 'My Reviews', icon: <FileCheck className="w-5 h-5" />, panel: 'workspace', roles: [UserRole.ADMIN, UserRole.AUDITOR, UserRole.USER] },
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN, UserRole.AUDITOR] },
  { id: 'inventory', label: 'Inventory', icon: <Shield className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN] },
  { id: 'governance', label: 'Governance', icon: <BarChart3 className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN, UserRole.AUDITOR] },
  { id: 'audit', label: 'Audit Logs', icon: <History className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN, UserRole.AUDITOR] },
];


export const HR_STATUS_ACTIVE_VALUES = ['active', 'enabled', 'enable', 'yes', 'true', '1', 'onroll', 'current'];
export const HR_STATUS_INACTIVE_VALUES = ['inactive', 'terminated', 'disable', 'disabled', 'no', 'false', '0', 'offboarded', 'separated'];

export const HR_SCHEMA_FIELDS: HrSchemaFieldDefinition[] = [
  { key: 'userId', label: 'User ID', required: true, aliases: ['userid', 'user id', 'account id', 'accountid', 'login id', 'loginid', 'worker id'] },
  { key: 'name', label: 'Display Name', required: true, aliases: ['name', 'display name', 'displayname', 'full name', 'fullname'] },
  { key: 'givenName', label: 'Given Name', required: false, aliases: ['given name', 'givenname', 'first name', 'firstname'] },
  { key: 'surname', label: 'Surname', required: false, aliases: ['surname', 'last name', 'lastname', 'family name', 'familyname'] },
  { key: 'description', label: 'Description', required: false, aliases: ['description', 'desc'] },
  { key: 'email', label: 'Email ID', required: true, aliases: ['email', 'email id', 'emailid', 'mail', 'mail id'] },
  { key: 'enabled', label: 'Enabled', required: false, aliases: ['enabled', 'is enabled', 'isenabled', 'active flag'] },
  { key: 'employeeId', label: 'Employee ID', required: false, aliases: ['employee id', 'employeeid', 'emp id', 'empid', 'person id', 'personid'] },
  { key: 'status', label: 'Employee Status', required: false, aliases: ['status', 'employee status', 'employeestatus', 'employment status', 'employmentstatus'] },
  { key: 'department', label: 'Department', required: false, aliases: ['department', 'dept'] },
  { key: 'city', label: 'City', required: false, aliases: ['city', 'location'] },
  { key: 'managerId', label: 'Manager Details', required: false, aliases: ['manager', 'manager id', 'managerid', 'manager details', 'managerdetails'] },
  { key: 'title', label: 'Title', required: false, aliases: ['title', 'job title', 'jobtitle', 'designation'] },
  { key: 'creationDate', label: 'Creation Date', required: false, aliases: ['creation date', 'creationdate', 'created date', 'createddate', 'created at', 'createdat'] },
  { key: 'lastLogonDate', label: 'Last Logon Date', required: false, aliases: ['last logon date', 'lastlogondate', 'last login', 'last login date', 'lastlogindate'] }
];

export const DEFAULT_HR_FEED_SCHEMA: HrFeedSchemaConfig = {
  mappings: {
    userId: 'userId',
    name: 'name',
    givenName: 'givenName',
    surname: 'surname',
    description: 'description',
    email: 'email',
    enabled: 'enabled',
    employeeId: 'employeeId',
    status: 'status',
    department: 'department',
    city: 'city',
    managerId: 'managerId',
    title: 'title',
    creationDate: 'creationDate',
    lastLogonDate: 'lastLogonDate'
  },
  ignoreColumns: [],
  customColumns: [],
  statusRules: {
    activeValues: HR_STATUS_ACTIVE_VALUES,
    inactiveValues: HR_STATUS_INACTIVE_VALUES
  }
};

export const buildDefaultHrFeedSchema = (): HrFeedSchemaConfig => ({
  mappings: { ...DEFAULT_HR_FEED_SCHEMA.mappings },
  ignoreColumns: [],
  customColumns: [],
  statusRules: {
    activeValues: [...DEFAULT_HR_FEED_SCHEMA.statusRules.activeValues],
    inactiveValues: [...DEFAULT_HR_FEED_SCHEMA.statusRules.inactiveValues]
  }
});

export const getTemplateHeadersForHrSchema = (schema?: HrFeedSchemaConfig) => {
  const resolved = schema || DEFAULT_HR_FEED_SCHEMA;
  const canonicalHeaders = HR_SCHEMA_FIELDS.map((field) => String(resolved.mappings[field.key] || field.key).trim()).filter(Boolean);
  const customHeaders = (resolved.customColumns || []).map((value) => String(value || '').trim()).filter(Boolean);
  return Array.from(new Set([...canonicalHeaders, ...customHeaders]));
};

export const HR_TEMPLATE_HEADERS = getTemplateHeadersForHrSchema(DEFAULT_HR_FEED_SCHEMA);

export const APP_ACCESS_TEMPLATE_HEADERS = ['id', 'userId', 'userName', 'email', 'entitlement'];
export const ENTITLEMENT_TEMPLATE_HEADERS = ['entitlement', 'description', 'owner', 'isPrivileged'];
export const SOD_POLICY_TEMPLATE_HEADERS = ['policyName', 'appId1', 'entitlement1', 'appId2', 'entitlement2', 'riskLevel'];

export const ACCOUNT_STATUS_ACTIVE_VALUES = ['active', 'enable', 'enabled', '1', 'true', 'a'];
export const ACCOUNT_STATUS_INACTIVE_VALUES = ['inactive', 'disable', 'disabled', '0', 'false', 'i'];

export const APP_TYPE_SCHEMA_TEMPLATES: Record<NonNullable<Application['appType']>, AppTypeSchemaTemplate> = {
  Application: {
    appType: 'Application',
    fields: [
      { key: 'loginId', label: 'Login ID/Name', required: true, aliases: ['loginid', 'login_name', 'userid', 'user_id', 'user'] },
      { key: 'email', label: 'E-mail ID', required: true, aliases: ['email', 'emailid', 'mail', 'email_id'] },
      { key: 'employeeId', label: 'Employee ID', required: true, aliases: ['employeeid', 'empid', 'workerid', 'personid'] },
      { key: 'role', label: 'Role', required: true, aliases: ['role', 'entitlement', 'accessrole'] },
      { key: 'lastLoginAt', label: 'Last Login Details', required: false, aliases: ['lastlogin', 'lastlogindetails', 'last_login'] },
      { key: 'accountStatus', label: 'Account Status', required: false, aliases: ['status', 'accountstatus', 'userstatus'] },
      { key: 'accountOwnerName', label: 'ID Owner/User Name', required: true, aliases: ['username', 'owner', 'displayname', 'name'] }
    ],
    defaultMappings: {
      loginId: 'loginId',
      email: 'email',
      employeeId: 'employeeId',
      role: 'role',
      lastLoginAt: 'lastLoginAt',
      accountStatus: 'accountStatus',
      accountOwnerName: 'accountOwnerName'
    },
    statusRules: {
      activeValues: ACCOUNT_STATUS_ACTIVE_VALUES,
      inactiveValues: ACCOUNT_STATUS_INACTIVE_VALUES
    }
  },
  Database: {
    appType: 'Database',
    fields: [
      { key: 'loginName', label: 'Login Name', required: true, aliases: ['loginname', 'login', 'userid', 'user_id'] },
      { key: 'userType', label: 'User Type', required: true, aliases: ['usertype', 'user_type', 'type'] },
      { key: 'dbRole', label: 'DB Role', required: true, aliases: ['dbrole', 'role', 'entitlement', 'database_role'] },
      { key: 'accountStatus', label: 'Account Status', required: false, aliases: ['status', 'accountstatus', 'userstatus'] },
      { key: 'createDate', label: 'Create Date', required: false, aliases: ['createdate', 'created_at', 'create_date'] },
      { key: 'userDetails', label: 'User Details', required: true, aliases: ['userdetails', 'displayname', 'name', 'owner'] }
    ],
    defaultMappings: {
      loginName: 'loginName',
      userType: 'userType',
      dbRole: 'dbRole',
      accountStatus: 'accountStatus',
      createDate: 'createDate',
      userDetails: 'userDetails'
    },
    statusRules: {
      activeValues: ACCOUNT_STATUS_ACTIVE_VALUES,
      inactiveValues: ACCOUNT_STATUS_INACTIVE_VALUES
    }
  },
  Servers: {
    appType: 'Servers',
    fields: [
      { key: 'userId', label: 'Users ID', required: true, aliases: ['userid', 'user_id', 'loginid'] },
      { key: 'userName', label: 'User Name', required: true, aliases: ['username', 'displayname', 'name'] },
      { key: 'privilegeLevel', label: 'Admin/root', required: true, aliases: ['adminroot', 'admin', 'root', 'entitlement', 'role'] },
      { key: 'accountStatus', label: 'Account Status', required: false, aliases: ['status', 'accountstatus', 'userstatus'] }
    ],
    defaultMappings: {
      userId: 'userId',
      userName: 'userName',
      privilegeLevel: 'privilegeLevel',
      accountStatus: 'accountStatus'
    },
    statusRules: {
      activeValues: ACCOUNT_STATUS_ACTIVE_VALUES,
      inactiveValues: ACCOUNT_STATUS_INACTIVE_VALUES
    }
  },
  'Shared Mailbox': {
    appType: 'Shared Mailbox',
    fields: [
      { key: 'ids', label: 'Ids', required: true, aliases: ['ids', 'id', 'user id', 'userid', 'user_id', 'employee id', 'employeeid', 'login id', 'loginid'] },
      { key: 'displayName', label: 'Display Name', required: true, aliases: ['display name', 'displayname', 'name', 'user name', 'username'] },
      { key: 'email', label: 'Email Id', required: true, aliases: ['email id', 'emailid', 'email', 'mail', 'mail id', 'mailid'] },
      { key: 'mailboxAccess', label: 'Mailbox Access', required: true, aliases: ['mailbox access', 'mailboxaccess', 'access', 'role', 'entitlement', 'permission'] }
    ],
    defaultMappings: {
      ids: 'Ids',
      displayName: 'Display Name',
      email: 'Email Id',
      mailboxAccess: 'Mailbox Access'
    },
    statusRules: {
      activeValues: ACCOUNT_STATUS_ACTIVE_VALUES,
      inactiveValues: ACCOUNT_STATUS_INACTIVE_VALUES
    }
  },
  'Shared Folder': {
    appType: 'Shared Folder',
    fields: [
      { key: 'ids', label: 'Ids', required: true, aliases: ['ids', 'id', 'user id', 'userid', 'user_id', 'employee id', 'employeeid', 'login id', 'loginid'] },
      { key: 'displayName', label: 'Display Name', required: true, aliases: ['display name', 'displayname', 'name', 'user name', 'username'] },
      { key: 'email', label: 'Email Id', required: true, aliases: ['email id', 'emailid', 'email', 'mail', 'mail id', 'mailid'] },
      { key: 'folderAccess', label: 'Folder Access', required: true, aliases: ['folder access', 'folderaccess', 'access', 'role', 'entitlement', 'permission'] }
    ],
    defaultMappings: {
      ids: 'Ids',
      displayName: 'Display Name',
      email: 'Email Id',
      folderAccess: 'Folder Access'
    },
    statusRules: {
      activeValues: ACCOUNT_STATUS_ACTIVE_VALUES,
      inactiveValues: ACCOUNT_STATUS_INACTIVE_VALUES
    }
  }
};

export const buildDefaultAccountSchema = (appType?: Application['appType']): AppAccountSchemaConfig => {
  const resolvedType = appType && APP_TYPE_SCHEMA_TEMPLATES[appType] ? appType : 'Application';
  const template = APP_TYPE_SCHEMA_TEMPLATES[resolvedType];
  return {
    schemaAppType: resolvedType,
    mappings: { ...template.defaultMappings },
    ignoreColumns: [],
    customColumns: [],
    statusRules: {
      activeValues: [...template.statusRules.activeValues],
      inactiveValues: [...template.statusRules.inactiveValues]
    }
  };
};

export const getTemplateHeadersForAppType = (appType?: Application['appType']) => {
  const resolvedType = appType && APP_TYPE_SCHEMA_TEMPLATES[appType] ? appType : 'Application';
  const template = APP_TYPE_SCHEMA_TEMPLATES[resolvedType];
  return template.fields.map(field => template.defaultMappings[field.key] || field.key);
};

export const SAMPLE_USERS = [];
export const SAMPLE_ACCESS = [];
