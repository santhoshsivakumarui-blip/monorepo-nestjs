import { LoggerService } from "@nestjs/common";
import { getRequestContext } from "./request-context";

export class JsonLogger implements LoggerService {
  private write(level: string, message: unknown, context?: string) {
    const request = getRequestContext();
    process.stdout.write(
      `${JSON.stringify({
        level,
        message,
        context,
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  }

  log(message: unknown, context?: string) {
    this.write("info", message, context);
  }
  error(message: unknown, trace?: string, context?: string) {
    this.write("error", { message, trace }, context);
  }
  warn(message: unknown, context?: string) {
    this.write("warn", message, context);
  }
  debug(message: unknown, context?: string) {
    this.write("debug", message, context);
  }
  verbose(message: unknown, context?: string) {
    this.write("trace", message, context);
  }
}
