import { AsyncLocalStorage } from "node:async_hooks";

type TenantContextValue = {
  tenantId?: string;
  branchIds?: string[];
};

const tenantContext = new AsyncLocalStorage<TenantContextValue>();

export function runWithTenantContext<T>(
  context: TenantContextValue,
  callback: () => T,
): T {
  return tenantContext.run(context, callback);
}

export function getTenantContext(): TenantContextValue {
  return tenantContext.getStore() ?? {};
}
