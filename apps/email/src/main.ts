import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { Topics } from "../../../libs/contracts/src/events";
import {
  deadLetterQueueArguments,
  deadLetterQueueName,
  ensureQueueWithDlq,
} from "../../../libs/common/src/rabbitmq-topology";
import { AppModule } from "./app.module";

const RABBITMQ_URL =
  process.env.RABBITMQ_URL ?? "amqp://platform:platform@rabbitmq:5672";
const QUEUE = Topics.emailRequested;

async function bootstrap() {
  await ensureQueueWithDlq(RABBITMQ_URL, {
    queue: QUEUE,
    deadLetterQueue: deadLetterQueueName(QUEUE),
  });

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [RABBITMQ_URL],
      queue: QUEUE,
      noAck: false,
      queueOptions: {
        durable: true,
        arguments: deadLetterQueueArguments(deadLetterQueueName(QUEUE)),
      },
    },
  });
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3004, "0.0.0.0");
}
bootstrap();
