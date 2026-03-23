export enum UserRole {
  ADMIN = 'ADMIN',
  AUDITOR = 'AUDITOR',
  USER = 'USER'
}

export enum ReviewStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  REMEDIATION = 'REMEDIATION',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

export enum ActionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REVOKED = 'REVOKED',
  REMEDIATED = 'REMEDIATED',
  CANCELLED = 'CANCELLED'
}

export interface User {
  id: string;
  name: string;
  email: string;
  department: string;
  managerId: string;
}

export interface EntitlementDefinition {
  appId: string;
  entitlement: string;
  description: string;
  owner: string;
  isPrivileged: boolean;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
  riskScore: string;
}

export interface SoDPolicy {
  id: string;
  policyName: string;
  appId1: string;
  entitlement1: string;
  appId2: string;
  entitlement2: string;
  riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface Application {
  id: string;
  name: string;
  ownerId: string; // Linked to User.id
  ownerAdminId?: string; // Second-level owner/admin/team linked to User.id
  appType?: 'Application' | 'Database' | 'Servers' | 'Shared Mailbox';
  serverHost?: string;
  serverHostName?: string;
  serverEnvironment?: 'UAT' | 'PROD' | '';
  accountSchema?: AppAccountSchemaConfig;
  description: string;
}

export interface ApplicationAccess {
  id: string;
  userId: string; // App-specific ID
  userName: string;
  email?: string;
  appId: string;
  appName: string;
  entitlement: string;
  accountStatus?: string;
  isSoDConflict: boolean;
  violatedPolicyNames?: string[];
  violatedPolicyIds?: string[];
  correlatedUserId?: string;
  isOrphan: boolean;
}

export interface ReviewCycle {
  id: string;
  name: string;
  appId: string; 
  appName: string;
  year: number;
  quarter: number;
  status: ReviewStatus;
  launchedAt?: string;
  dueDate?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  totalItems: number;
  pendingItems: number;
  pendingRemediationItems?: number;
  confirmedManagers: string[]; // List of manager IDs who submitted
  certificationType?: 'MANAGER' | 'APPLICATION_OWNER';
  riskScope?: 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY';
}

export interface ReviewItem {
  id: string;
  reviewCycleId: string;
  accessId: string;
  appUserId: string; 
  managerId: string; 
  status: ActionStatus;
  comment?: string;
  actionedAt?: string;
  remediatedAt?: string; 
  userName: string;
  appName: string;
  entitlement: string;
  isSoDConflict: boolean;
  violatedPolicyNames?: string[];
  violatedPolicyIds?: string[];
  isOrphan: boolean;
  isPrivileged: boolean;
  reassignedAt?: string;
  reassignedBy?: string;
  reassignmentComment?: string | null;
  reassignmentCount?: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
}

export interface AppCustomization {
  platformName: string;
  primaryColor: string;
  environmentLabel: string;
  loginSubtitle: string;
  supportEmail: string;
  idleTimeoutMinutes: number;
  emailTemplates: {
    reviewAssignment: {
      subject: string;
      body: string;
    };
    reviewReminder: {
      subject: string;
      body: string;
    };
    reviewEscalation: {
      subject: string;
      body: string;
    };
    reviewConfirmationReminder: {
      subject: string;
      body: string;
    };
    reviewConfirmationEscalation: {
      subject: string;
      body: string;
    };
    remediationNotify: {
      subject: string;
      body: string;
    };
    reviewReassigned: {
      subject: string;
      body: string;
    };
    reviewReassignedBulk: {
      subject: string;
      body: string;
    };
  };
}

export interface AccountSchemaFieldDefinition {
  key: string;
  label: string;
  required: boolean;
  aliases?: string[];
}

export interface AppTypeSchemaTemplate {
  appType: NonNullable<Application['appType']>;
  fields: AccountSchemaFieldDefinition[];
  defaultMappings: Record<string, string>;
  statusRules: {
    activeValues: string[];
    inactiveValues: string[];
  };
}

export interface AppAccountSchemaConfig {
  schemaAppType: NonNullable<Application['appType']>;
  mappings: Record<string, string>;
  ignoreColumns: string[];
  statusRules: {
    activeValues: string[];
    inactiveValues: string[];
  };
}