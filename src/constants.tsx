
import React from 'react';
import { Shield, FileCheck, BarChart3, History, Layers, UserCheck } from 'lucide-react';
import { AppAccountSchemaConfig, AppTypeSchemaTemplate, Application, UserRole } from './types';

export const NAV_ITEMS = [
  { id: 'my-team-access', label: 'My Team Access', icon: <UserCheck className="w-5 h-5" />, panel: 'workspace', roles: [UserRole.ADMIN, UserRole.AUDITOR, UserRole.USER] },
  { id: 'reviews', label: 'My Reviews', icon: <FileCheck className="w-5 h-5" />, panel: 'workspace', roles: [UserRole.ADMIN, UserRole.AUDITOR, UserRole.USER] },
  { id: 'dashboard', label: 'Dashboard', icon: <Layers className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN, UserRole.AUDITOR] },
  { id: 'inventory', label: 'Inventory', icon: <Shield className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN] },
  { id: 'governance', label: 'Governance', icon: <BarChart3 className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN, UserRole.AUDITOR] },
  { id: 'audit', label: 'Audit Logs', icon: <History className="w-5 h-5" />, panel: 'admin-auditor', roles: [UserRole.ADMIN, UserRole.AUDITOR] },
];


export const HR_TEMPLATE_HEADERS = [
  'userId',      // ← make this explicit
  'name',
  'email',
  'department',
  'managerId',
  'title',
  'status'
];

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
    fields: [],
    defaultMappings: {},
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
