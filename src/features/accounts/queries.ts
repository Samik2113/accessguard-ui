import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAccounts, getAccountsByUser } from '../../services/api';
import { useDebouncedValue } from '../reviews/useDebouncedValue';

export const accountQueryKeys = {
  byApp: (filters: { appId?: string; userId?: string; entitlement?: string; search?: string; top?: number }) => ['accounts-by-app', filters] as const,
  byUser: (filters: { userId?: string; search?: string; top?: number }) => ['accounts-by-user', filters] as const
};

export function useAccountsByApp(filters: { appId?: string; userId?: string; entitlement?: string; search?: string; top?: number }) {
  const debouncedSearch = useDebouncedValue(filters.search, 400);
  const normalized = useMemo(() => ({
    appId: filters.appId?.trim() || undefined,
    userId: filters.userId?.trim() || undefined,
    entitlement: filters.entitlement?.trim() || undefined,
    search: debouncedSearch?.trim() || undefined,
    top: filters.top ?? 200
  }), [filters.appId, filters.userId, filters.entitlement, filters.top, debouncedSearch]);

  return useQuery({
    queryKey: accountQueryKeys.byApp(normalized),
    queryFn: () => getAccounts(normalized.appId || '', normalized.userId, normalized.entitlement, normalized.top, undefined, normalized.search),
    enabled: Boolean(normalized.appId) && (!normalized.search || normalized.search.length >= 2),
    select: (raw: any) => ({
      items: Array.isArray(raw?.items) ? raw.items : [],
      count: Number(raw?.count || 0),
      continuationToken: raw?.continuationToken
    })
  });
}

export function useAccountsByUser(filters: { userId?: string; search?: string; top?: number }) {
  const debouncedSearch = useDebouncedValue(filters.search, 400);
  const normalized = useMemo(() => ({
    userId: filters.userId?.trim() || undefined,
    search: debouncedSearch?.trim() || undefined,
    top: filters.top ?? 1000
  }), [filters.userId, filters.top, debouncedSearch]);

  return useQuery({
    queryKey: accountQueryKeys.byUser(normalized),
    queryFn: () => getAccountsByUser(normalized.userId || '', normalized.top, normalized.search),
    enabled: Boolean(normalized.userId) && (!normalized.search || normalized.search.length >= 2),
    select: (raw: any) => ({
      items: Array.isArray(raw?.items) ? raw.items : [],
      count: Number(raw?.count || 0)
    })
  });
}
