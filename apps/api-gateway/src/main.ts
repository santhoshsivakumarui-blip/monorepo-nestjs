import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { json, urlencoded } from "express";
import { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { JsonLogger } from "../../../libs/common/src/json.logger";
import { requestId } from "../../../libs/common/src/request-id.middleware";
import { ProblemDetailsFilter } from "../../../libs/common/src/api";
import { rateLimit } from "../../../libs/common/src/rate-limit.middleware";
import { buildCorsOrigins, buildSecurityHeaders } from "./security";
import { mountServiceProxies } from "./proxy";
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

  const app = await NestFactory.create(AppModule, {
    logger: new JsonLogger(),
    // Body parsing is disabled here and re-added below *after* the service
    // proxies are mounted, so proxied request bodies (including multipart
    // uploads) stream through to the microservices untouched.
    bodyParser: false,
  });
  const securityHeaders = buildSecurityHeaders();
  const origins = buildCorsOrigins(process.env.CORS_ORIGINS);
  const expressApp = app.getHttpAdapter().getInstance();

  app.setGlobalPrefix("api");
  expressApp.set("trust proxy", 1);
  app.use(requestId);
  app.use(rateLimit);
  app.use((req: Request, res: Response, next: NextFunction) => {
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

  // Mount the per-service reverse proxies before any body parser so they
  // receive the raw request stream.
  mountServiceProxies(expressApp);
  expressApp.use(json());
  expressApp.use(urlencoded({ extended: true }));

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
