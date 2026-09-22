import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

export interface JwtConfig {
  secret?: string;
  issuer?: string;
  audience?: string;
}

export interface JwtUser {
  sub: string;
  roles: string[];
  /** Absent for platform-level tokens (PLATFORM_ADMIN/PROVISIONER), which are tenant-unscoped. */
  tenantId?: string;
  branchIds?: string[];
}

export const isDevelopmentSecret = (value?: string) =>
  !value || /change-me|development-only|example|placeholder/i.test(value);

export function buildJwtConfig(env: NodeJS.ProcessEnv = process.env): JwtConfig {
  const isProduction = env.NODE_ENV === "production";
  return {
    secret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER ?? (isProduction ? undefined : "platform-local"),
    audience: env.JWT_AUDIENCE ?? (isProduction ? undefined : "platform-api"),
  };
}

export function isOidcConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.OAUTH_ISSUER || env.OAUTH_AUDIENCE || env.OAUTH_CLIENT_ID);
}

export async function validateOidcConfiguration(
  env: NodeJS.ProcessEnv = process.env,
) {
  const issuer = env.OAUTH_ISSUER;
  const audience = env.OAUTH_AUDIENCE;
  const clientId = env.OAUTH_CLIENT_ID;

  if (!issuer || !audience || !clientId) {
    throw new Error(
      "OIDC configuration is incomplete. Missing: OAUTH_ISSUER, OAUTH_AUDIENCE, or OAUTH_CLIENT_ID.",
    );
  }

  const discoveryUrl = new URL(
    ".well-known/openid-configuration",
    issuer.endsWith("/") ? issuer : `${issuer}/`,
  );
  const response = await fetch(discoveryUrl.toString());
  if (!response.ok) {
    throw new Error(
      `OIDC discovery request failed for ${issuer}: ${response.status}`,
    );
  }

  const metadata = (await response.json()) as {
    issuer?: string;
    jwks_uri?: string;
  };
  if (metadata.issuer !== issuer) {
    throw new Error(
      `OIDC issuer mismatch: expected ${issuer}, got ${metadata.issuer ?? "unknown"}`,
    );
  }
  if (!metadata.jwks_uri) {
    throw new Error(`OIDC discovery for ${issuer} did not include jwks_uri.`);
  }
}

/**
 * Fail-fast startup check for JWT/OIDC config. Call once at service bootstrap
 * (module load time) so misconfiguration blocks startup rather than surfacing
 * as a runtime 401 later.
 */
export function assertAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): JwtConfig {
  const isProduction = env.NODE_ENV === "production";
  const jwtConfig = buildJwtConfig(env);

  if (isDevelopmentSecret(jwtConfig.secret)) {
    throw new Error(
      "JWT_SECRET must be set to a non-placeholder value before starting.",
    );
  }

  if (isOidcConfigured(env)) {
    const missing = [
      !env.OAUTH_ISSUER && "OAUTH_ISSUER",
      !env.OAUTH_AUDIENCE && "OAUTH_AUDIENCE",
      !env.OAUTH_CLIENT_ID && "OAUTH_CLIENT_ID",
    ].filter(Boolean) as string[];

    if (missing.length > 0) {
      throw new Error(
        `OIDC configuration is incomplete. Missing: ${missing.join(", ")}.`,
      );
    }
  }

  if (
    isProduction &&
    !isOidcConfigured(env) &&
    (!jwtConfig.issuer || !jwtConfig.audience)
  ) {
    throw new Error(
      "JWT_ISSUER and JWT_AUDIENCE must be set explicitly in production before starting.",
    );
  }

  return jwtConfig;
}

export const Roles = (...roles: string[]) => SetMetadata("roles", roles);

/** Verifies the bearer JWT and attaches { sub, roles } to the request. */
@Injectable()
export class JwtRolesGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: JwtUser;
    }>();
    const raw = request.headers.authorization;
    if (!raw?.startsWith("Bearer ")) throw new UnauthorizedException();

    const jwtConfig = buildJwtConfig();
    try {
      const verified = this.jwt.verify<JwtUser>(raw.slice(7), {
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });
      request.user = { ...verified, roles: verified.roles ?? ["user"] };
      return true;
    } catch {
      throw new UnauthorizedException("Invalid or expired token.");
    }
  }
}

/** Requires the caller's JWT `roles` claim to include one of the given roles. */
@Injectable()
export class RequireRolesGuard implements CanActivate {
  constructor(private readonly allowedRoles: string[]) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { roles: string[] } }>();
    const roles = request.user?.roles ?? [];
    if (!roles.some((role) => this.allowedRoles.includes(role))) {
      throw new UnauthorizedException(
        `Requires one of roles: ${this.allowedRoles.join(", ")}.`,
      );
    }
    return true;
  }
}
