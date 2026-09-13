import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "./request-context";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-request-id") ?? randomUUID();
  res.setHeader("x-request-id", id);
  (req as Request & { requestId: string }).requestId = id;

  runWithRequestContext({ requestId: id }, () => next());
}
