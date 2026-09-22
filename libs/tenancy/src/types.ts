export type SubscriptionPlan = "starter" | "growth" | "enterprise";
export type DatabaseMode = "pooled" | "dedicated";

/**
 * Services a tenant can have a dedicated database for. `admin` is
 * deliberately excluded — it hosts the tenant registry itself (this very
 * table lives there), so a per-tenant copy of it would duplicate the
 * registry. See infra/postgres/migrations/admin/0005_per_service_tenant_placement.sql.
 */
export const TENANT_SCOPED_SERVICES = [
  "users",
  "vitals",
  "notifications",
  "clinical-records",
  "subscriptions",
] as const;
export type TenantScopedService = (typeof TENANT_SCOPED_SERVICES)[number];

/** The wildcard placement row a pooled tenant gets — applies to every service. */
export const ALL_SERVICES_PLACEMENT = "*";

export interface TenantPlacement {
  tenantId: string;
  mode: DatabaseMode;
  databaseKey: string;
  poolName?: string;
  status: string;
}
