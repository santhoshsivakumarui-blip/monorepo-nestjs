import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from '../../../libs/common/src/json.logger';
import { requestId } from '../../../libs/common/src/request-id.middleware';
import { ProblemDetailsFilter } from '../../../libs/common/src/api';
import { rateLimit } from '../../../libs/common/src/rate-limit.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger() });
  app.setGlobalPrefix('api');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(requestId);
  app.use(rateLimit);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  const spec = new DocumentBuilder().setTitle('Platform API').setVersion('v1').addBearerAuth().build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, spec));
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
