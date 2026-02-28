import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getReviewCycleDetail, getReviewCycles } from '../../services/api';
import type { ReviewCycleDetailResponse } from '../../../shared/types/reviews';
import { useDebouncedValue } from './useDebouncedValue';

export const reviewQueryKeys = {
  cycles: (filters: { appId?: string; status?: string; top?: number }) => ['review-cycles', filters] as const,
  cycleDetail: (filters: { cycleId?: string; includeItems: true; managerId?: string; status?: string; top?: number }) => ['review-cycle-detail', filters] as const
};

export function useReviewCycles(filters: { appId?: string; status?: string; top?: number }) {
  const debouncedStatus = useDebouncedValue(filters.status, 350);
  const normalized = useMemo(() => ({
    appId: filters.appId?.trim() || undefined,
    status: debouncedStatus?.trim() || undefined,
    top: filters.top ?? 200
  }), [filters.appId, filters.top, debouncedStatus]);

  return useQuery({
    queryKey: reviewQueryKeys.cycles(normalized),
    queryFn: () => getReviewCycles(normalized),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    enabled: true,
    select: (raw: any) => ({
      cycles: Array.isArray(raw?.cycles) ? raw.cycles : [],
      count: Number(raw?.count || 0)
    })
  });
}

export function useReviewCycleDetail(filters: { cycleId?: string; managerId?: string; status?: string; top?: number; appId?: string }) {
  const debouncedStatus = useDebouncedValue(filters.status, 350);
  const normalizedCycleId = filters.cycleId?.trim() || '';
  const normalizedManagerId = filters.managerId?.trim() || undefined;

  return useQuery({
    queryKey: reviewQueryKeys.cycleDetail({
      cycleId: normalizedCycleId,
      includeItems: true,
      managerId: normalizedManagerId,
      status: debouncedStatus?.trim() || undefined,
      top: filters.top ?? 200
    }),
    queryFn: () => getReviewCycleDetail({
      cycleId: normalizedCycleId,
      appId: filters.appId,
      managerId: normalizedManagerId,
      status: debouncedStatus?.trim() || undefined,
      top: filters.top ?? 200
    }) as Promise<ReviewCycleDetailResponse>,
    enabled: normalizedCycleId.length > 0,
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    select: (raw) => ({
      cycle: raw?.cycle,
      items: Array.isArray(raw?.items) ? raw.items : [],
      page: raw?.page,
      validators: raw?.validators
    })
  });
}
