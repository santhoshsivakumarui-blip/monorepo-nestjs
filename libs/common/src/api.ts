import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { getRequestContext } from "./request-context";

export interface Page<T> {
  data: T[];
  nextCursor?: string;
}
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<{ requestId?: string }>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail =
      error instanceof HttpException
        ? String(error.getResponse())
        : "Unexpected server error";
    const requestId = request?.requestId ?? getRequestContext().requestId;
    const body: ApiProblem = {
      type: `https://httpstatuses.com/${status}`,
      title: HttpStatus[status],
      status,
      detail,
      requestId,
    };
    response.status(status).type("application/problem+json").send(body);
  }
}
