import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

export function isOpenFgaConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.OPENFGA_API_URL && env.OPENFGA_STORE_ID);
}

/**
 * Thin wrapper around OpenFGA's Check API. Requires a store and authorization
 * model to already exist in OpenFGA (not provisioned by this client) — see
 * apps/admin/README.md for the bootstrap step.
 */
export async function checkFgaPermission(
  user: string,
  relation: string,
  object: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const apiUrl = env.OPENFGA_API_URL;
  const storeId = env.OPENFGA_STORE_ID;
  if (!apiUrl || !storeId) {
    throw new Error("OPENFGA_API_URL and OPENFGA_STORE_ID must be configured.");
  }

  const response = await fetch(`${apiUrl}/stores/${storeId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tuple_key: { user, relation, object },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenFGA check failed: ${response.status}`);
  }

  const body = (await response.json()) as { allowed?: boolean };
  return body.allowed === true;
}

/**
 * Authorizes the request via OpenFGA when OPENFGA_STORE_ID is configured;
 * otherwise allows (matches this repo's convention of features activating
 * only once their config is present — see isOidcConfigured in oidc.ts).
 * Must run after a guard that populates request.user (e.g. JwtRolesGuard).
 */
export function createFgaGuard(relation: string, object: string) {
  @Injectable()
  class FgaGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      if (!isOpenFgaConfigured()) return true;

      const request = context
        .switchToHttp()
        .getRequest<{ user?: { sub: string } }>();
      const user = request.user?.sub;
      if (!user) throw new UnauthorizedException();

      const allowed = await checkFgaPermission(`user:${user}`, relation, object);
      if (!allowed) {
        throw new UnauthorizedException(
          `Not authorized for ${relation} on ${object}.`,
        );
      }
      return true;
    }
  }
  return FgaGuard;
}
