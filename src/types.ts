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
  title?: string;
  status?: string;
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

export type CampaignReviewerType = 'MANAGER' | 'APPLICATION_OWNER' | 'APPLICATION_ADMIN' | 'ENTITLEMENT_OWNER' | 'SPECIFIC_USER';
export type CertificationType = CampaignReviewerType;
export type OrphanReviewerMode = 'APPLICATION_OWNER' | 'APPLICATION_ADMIN' | 'CUSTOM';

export interface CampaignScopeSelection {
  ALL_APPLICATIONS?: boolean;
  ALL_SERVERS?: boolean;
  ALL_DATABASES?: boolean;
  ALL_SHARED_MAILBOXES?: boolean;
  ALL_SHARED_FOLDERS?: boolean;
  specificAppIds?: string[];
}

export interface CampaignConfigPayload {
  cycleId?: string;
  name: string;
  ownerId: string;
  dueDate: string;
  startAt?: string;
  startNow: boolean;
  riskScope?: 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY';
  scope: CampaignScopeSelection;
  reviewerType: CampaignReviewerType;
  specificReviewerId?: string;
  orphanReviewerMode?: OrphanReviewerMode;
  orphanReviewerId?: string;
}

export interface Application {
  id: string;
  name: string;
  ownerId: string; // Linked to User.id
  ownerAdminId?: string; // Second-level owner/admin/team linked to User.id
  ownerAdminIds?: string[];
  ownerAdminTeams?: string[];
  appType?: 'Application' | 'Database' | 'Servers' | 'Shared Mailbox' | 'Shared Folder';
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
  hrStatus?: string;
  isTerminated?: boolean;
  isOrphan: boolean;
}

export interface ReviewCycle {
  id: string;
  name: string;
  appId: string; 
  appName: string;
  appIds?: string[];
  appTypes?: Array<NonNullable<Application['appType']>>;
  scope?: CampaignScopeSelection;
  scopeSummary?: string;
  year: number;
  quarter: number;
  status: ReviewStatus;
  stagedAt?: string;
  launchedAt?: string;
  startAt?: string;
  startNow?: boolean;
  dueDate?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  totalItems: number;
  pendingItems: number;
  pendingRemediationItems?: number;
  confirmedManagers: string[]; // List of manager IDs who submitted
  certificationType?: CertificationType;
  reviewerType?: CampaignReviewerType;
  reviewerLabel?: string;
  specificReviewerId?: string;
  campaignOwnerId?: string;
  campaignOwnerName?: string;
  riskScope?: 'ALL_ACCESS' | 'SOD_ONLY' | 'PRIVILEGED_ONLY' | 'ORPHAN_ONLY';
  orphanReviewerMode?: OrphanReviewerMode;
  orphanReviewerId?: string;
}

export interface ReviewItem {
  id: string;
  reviewCycleId: string;
  accessId: string;
  appId?: string;
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
  hrStatus?: string;
  isTerminated?: boolean;
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
  hrFeedSchema?: HrFeedSchemaConfig;
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

export interface HrSchemaFieldDefinition {
  key: string;
  label: string;
  required: boolean;
  aliases?: string[];
}

export interface HrFeedSchemaConfig {
  mappings: Record<string, string>;
  ignoreColumns: string[];
  customColumns?: string[];
  statusRules: {
    activeValues: string[];
    inactiveValues: string[];
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
  customColumns?: string[];
  statusRules: {
    activeValues: string[];
    inactiveValues: string[];
  };
}