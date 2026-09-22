const fs = require("fs");
const path = require("path");

const name = process.argv[2]?.toLowerCase();
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  throw new Error("Usage: npm run generate:service -- <kebab-name>");
}

const root = path.join(process.cwd(), "apps", name);
if (fs.existsSync(root)) {
  throw new Error(`${name} already exists`);
}

const className = name
  .split("-")
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join("");

const directories = [
  "src/config",
  "src/common",
  `src/modules/${name}`,
  `src/modules/${name}/dto`,
  `src/modules/${name}/entities`,
  `src/modules/${name}/events`,
  "src/modules/health",
  "src/guards",
  "src/filters",
  "src/interceptors",
  "src/utils",
  "test/e2e",
];

for (const dir of directories) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}

const files = {
  "src/app.module.ts": `import { Module } from '@nestjs/common';\nimport { HealthController } from './modules/health/health.controller';\n\n@Module({\n  imports: [],\n  controllers: [HealthController],\n  providers: [],\n})\nexport class AppModule {}\n`,
  "src/main.ts": `import { NestFactory } from '@nestjs/core';\nimport { ValidationPipe } from '@nestjs/common';\nimport { AppModule } from './app.module';\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  app.setGlobalPrefix('api');\n  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));\n  app.enableShutdownHooks();\n  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');\n}\n\nbootstrap();\n`,
  "src/config/app.config.ts": `export const appConfig = () => ({\n  port: Number(process.env.PORT ?? 3000),\n  globalPrefix: 'api',\n});\n`,
  "src/config/env.validation.ts": `export const validateEnvironment = () => {\n  const issues: string[] = [];\n\n  if (!process.env.NODE_ENV) {\n    issues.push('NODE_ENV');\n  }\n\n  return { ok: issues.length === 0, issues };\n};\n`,
  "src/common/constants.ts": `export const SERVICE_NAME = '${name}';\nexport const DEFAULT_PAGE_SIZE = 20;\n`,
  "src/common/types.ts": `export type ServiceHealth = {\n  status: 'ok' | 'error';\n  service: string;\n};\n`,
  [`src/modules/${name}/${name}.module.ts`]: `import { Module } from '@nestjs/common';\n\n@Module({})\nexport class ${className}Module {}\n`,
  [`src/modules/${name}/${name}.controller.ts`]: `import { Controller, Get } from '@nestjs/common';\n\n@Controller('${name}')\nexport class ${className}Controller {\n  @Get()\n  getHello(): string {\n    return '${className} service is running';\n  }\n}\n`,
  [`src/modules/${name}/${name}.service.ts`]: `import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class ${className}Service {\n  getStatus(): string {\n    return '${className} ready';\n  }\n}\n`,
  [`src/modules/${name}/dto/create-${name}.dto.ts`]: `export class Create${className}Dto {\n  readonly id?: string;\n}\n`,
  [`src/modules/${name}/dto/update-${name}.dto.ts`]: `export class Update${className}Dto {\n  readonly id?: string;\n}\n`,
  [`src/modules/${name}/dto/${name}-response.dto.ts`]: `export class ${className}ResponseDto {\n  id?: string;\n}\n`,
  [`src/modules/${name}/entities/${name}.entity.ts`]: `export class ${className}Entity {\n  id?: string;\n}\n`,
  [`src/modules/${name}/events/${name}-created.event.ts`]: `export class ${className}CreatedEvent {\n  constructor(public readonly id: string) {}\n}\n`,
  [`src/modules/${name}/events/${name}-created.handler.ts`]: `export class ${className}CreatedHandler {\n  handle(event: { id: string }) {\n    return event;\n  }\n}\n`,
  "src/modules/health/health.controller.ts": `import { Controller, Get } from '@nestjs/common';\n\n@Controller('health')\nexport class HealthController {\n  @Get()\n  getHealth() {\n    return { status: 'ok', service: '${name}' };\n  }\n}\n`,
  "src/guards/jwt-auth.guard.ts": `import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class JwtAuthGuard implements CanActivate {\n  canActivate(context: ExecutionContext): boolean {\n    const req = context.switchToHttp().getRequest();\n    return !!req.headers.authorization;\n  }\n}\n`,
  "src/filters/http-exception.filter.ts": `import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';\nimport { Request, Response } from 'express';\n\n@Catch(HttpException)\nexport class HttpExceptionFilter implements ExceptionFilter {\n  catch(exception: HttpException, host: ArgumentsHost) {\n    const ctx = host.switchToHttp();\n    const response = ctx.getResponse<Response>();\n    const request = ctx.getRequest<Request>();\n    const status = exception.getStatus();\n\n    response.status(status).json({\n      statusCode: status,\n      timestamp: new Date().toISOString(),\n      path: request.url,\n      message: exception.message,\n    });\n  }\n}\n`,
  "src/interceptors/logging.interceptor.ts": `import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';\nimport { Observable } from 'rxjs';\nimport { tap } from 'rxjs/operators';\n\n@Injectable()\nexport class LoggingInterceptor implements NestInterceptor {\n  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {\n    const req = context.switchToHttp().getRequest();\n    const now = Date.now();\n\n    return next.handle().pipe(\n      tap(() => {\n        const elapsed = Date.now() - now;\n        console.log(\`[${name}] \${req.method} \${req.url} \${elapsed}ms\`);\n      }),\n    );\n  }\n}\n`,
  "src/utils/normalize-name.util.ts": `export function normalize${className}Name(value: string): string {\n  return value.trim();\n}\n`,
  [`test/e2e/${name}.e2e-spec.ts`]: `describe('${className} health', () => {\n  it('should boot the application', () => {\n    expect(true).toBe(true);\n  });\n});\n`,
  "tsconfig.app.json": JSON.stringify(
    {
      extends: "../../tsconfig.json",
      compilerOptions: {
        outDir: `../../dist/apps/${name}`,
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  ),
  "README.md": `# ${className} service\n\nThis service owns its own domain data, REST contracts, and event streams.\n\n## Expected layout\n\n- src/config\n- src/modules/${name}\n- src/guards\n- src/filters\n- src/interceptors\n- test/e2e\n\nRegister the service in nest-cli.json, Docker Compose, k8s, and Helm after defining the domain contract.\n`,
};

for (const [relativePath, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

console.log(
  `Created ${root}. Complete the registration steps documented in apps/${name}/README.md.`,
);
