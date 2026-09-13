import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { JsonLogger } from "../../../libs/common/src/json.logger";
import { requestId } from "../../../libs/common/src/request-id.middleware";
import { ProblemDetailsFilter } from "../../../libs/common/src/api";
import { rateLimit } from "../../../libs/common/src/rate-limit.middleware";
import { buildCorsOrigins, buildSecurityHeaders } from "./security";
import { registerGracefulShutdown } from "./shutdown";
import { validateOidcConfiguration } from "./auth";

async function bootstrap() {
  if (
    process.env.OAUTH_ISSUER ||
    process.env.OAUTH_AUDIENCE ||
    process.env.OAUTH_CLIENT_ID
  ) {
    await validateOidcConfiguration();
  }

  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  const securityHeaders = buildSecurityHeaders();
  const origins = buildCorsOrigins(process.env.CORS_ORIGINS);

  app.setGlobalPrefix("api");
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(requestId);
  app.use(rateLimit);
  app.use((req, res, next) => {
    Object.entries(securityHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
    next();
  });
  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-request-id",
        "idempotency-key",
      ],
    });
  }
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  const spec = new DocumentBuilder()
    .setTitle("Platform API")
    .setVersion("v1")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, spec));
  registerGracefulShutdown(app);
  await app.listen(process.env.PORT ?? 3000, "0.0.0.0");
}
bootstrap();
