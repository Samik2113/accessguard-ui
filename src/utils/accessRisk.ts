import { APP_TYPE_SCHEMA_TEMPLATES, buildDefaultAccountSchema } from '../constants';
import { Application, ApplicationAccess, ReviewItem } from '../types';

const normalizeText = (value: unknown) => String(value || '').trim();

const normalizeLower = (value: unknown) => normalizeText(value).toLowerCase();

const parseBool = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = normalizeLower(value);
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
};

const getResolvedAppType = (app?: Application | null): NonNullable<Application['appType']> => {
  if (app?.appType && APP_TYPE_SCHEMA_TEMPLATES[app.appType]) return app.appType;
  return 'Application';
};

const getStatusRules = (app?: Application | null) => {
  const appType = getResolvedAppType(app);
  const fallback = buildDefaultAccountSchema(appType);
  const current = app?.accountSchema;
  return {
    activeValues: Array.isArray(current?.statusRules?.activeValues) ? current.statusRules.activeValues : fallback.statusRules.activeValues,
    inactiveValues: Array.isArray(current?.statusRules?.inactiveValues) ? current.statusRules.inactiveValues : fallback.statusRules.inactiveValues
  };
};

export const findApplicationByAppId = (applications: Application[], appId?: string | null) => {
  const normalizedAppId = normalizeText(appId);
  if (!normalizedAppId) return undefined;
  return applications.find((app) => {
    const candidates = [app.id, (app as any).appId].map((value) => normalizeText(value)).filter(Boolean);
    return candidates.includes(normalizedAppId);
  });
};

export const normalizeAccountStatus = (raw: unknown, app?: Application | null) => {
  const value = normalizeText(raw);
  if (!value) return 'ACTIVE';

  const lowered = value.toLowerCase();
  const statusRules = getStatusRules(app);
  if (statusRules.activeValues.map((entry) => normalizeLower(entry)).includes(lowered)) return 'ACTIVE';
  if (statusRules.inactiveValues.map((entry) => normalizeLower(entry)).includes(lowered)) return 'INACTIVE';

  if (/(disable|inactive|terminated|suspend|lock|revoke|closed|expired|offboard)/i.test(value)) return 'INACTIVE';
  if (/(active|enabled|open|current|live)/i.test(value)) return 'ACTIVE';

  return value.toUpperCase();
};

export const isActiveAccount = (raw: unknown, app?: Application | null) => normalizeAccountStatus(raw, app) === 'ACTIVE';

export const hasActiveOrphanRisk = (
  record: { isOrphan?: unknown; accountStatus?: unknown },
  app?: Application | null
) => parseBool(record?.isOrphan) && isActiveAccount(record?.accountStatus, app);

export const findMatchingAccessRecord = (
  item: Pick<ReviewItem, 'accessId' | 'appId' | 'appUserId' | 'entitlement'>,
  access: ApplicationAccess[]
) => {
  const accessId = normalizeText(item.accessId);
  if (accessId) {
    const directMatch = access.find((entry) => normalizeText(entry.id) === accessId);
    if (directMatch) return directMatch;
  }

  const appId = normalizeText(item.appId);
  const appUserId = normalizeText(item.appUserId);
  const entitlement = normalizeText(item.entitlement);

  const exactMatch = access.find((entry) => {
    return normalizeText(entry.appId) === appId
      && normalizeText(entry.userId) === appUserId
      && normalizeText(entry.entitlement) === entitlement;
  });
  if (exactMatch) return exactMatch;

  return access.find((entry) => {
    return normalizeText(entry.appId) === appId
      && normalizeText(entry.userId) === appUserId;
  });
};