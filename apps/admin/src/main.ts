import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  isOidcConfigured,
  validateOidcConfiguration,
} from "../../../libs/common/src/oidc";
import { AppModule } from "./app.module";

/** Matches apps/api-gateway/src/security.ts's buildCorsOrigins — kept local
 * rather than shared since apps don't otherwise import each other's src. */
function buildCorsOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

async function bootstrap() {
  if (isOidcConfigured()) {
    await validateOidcConfiguration();
  }

  const app = await NestFactory.create(AppModule);
  const origins = buildCorsOrigins(process.env.CORS_ORIGINS);
  // Clinic web (zentinal-clinic-app) calls this service directly from the
  // browser for auth/staff and hospital routes — the gateway doesn't forward
  // Authorization headers yet, so browser clients bypass it entirely.
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "idempotency-key"],
    });
  }
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3006, "0.0.0.0");
}
bootstrap();
