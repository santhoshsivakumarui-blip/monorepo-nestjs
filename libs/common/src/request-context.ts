import { AsyncLocalStorage } from "node:async_hooks";

type RequestContextValue = {
  requestId?: string;
};

const requestContext = new AsyncLocalStorage<RequestContextValue>();

export function runWithRequestContext<T>(
  context: RequestContextValue,
  callback: () => T,
): T {
  return requestContext.run(context, callback);
}

export function getRequestContext(): RequestContextValue {
  return requestContext.getStore() ?? {};
}

export { AsyncLocalStorage };
