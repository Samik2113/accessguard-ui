export interface ReviewCycleDto {
  id: string;
  cycleId?: string;
  name: string;
  appId: string;
  appName: string;
  status: string;
  launchedAt?: string;
  dueDate?: string;
  completedAt?: string;
  totalItems: number;
  pendingItems: number;
  pendingRemediationItems?: number;
  confirmedManagers?: string[];
  _etag?: string;
  _ts?: number;
}

export interface ReviewItemDto {
  id: string;
  reviewCycleId: string;
  appId: string;
  appName: string;
  managerId: string;
  appUserId: string;
  userName: string;
  entitlement: string;
  status: string;
  comment?: string;
  actionedAt?: string;
  remediatedAt?: string;
  isSoDConflict?: boolean;
  violatedPolicyIds?: string[];
  violatedPolicyNames?: string[];
  isOrphan?: boolean;
  isPrivileged?: boolean;
  reassignedAt?: string;
  reassignedBy?: string;
  reassignmentComment?: string | null;
  reassignmentCount?: number;
  _etag?: string;
  _ts?: number;
}

export interface ReviewCycleDetailResponse {
  ok: true;
  cycle: ReviewCycleDto;
  items: ReviewItemDto[];
  page: {
    count: number;
    continuationToken?: string | null;
  };
  validators: {
    etag: string;
    lastModified: string;
  };
}
