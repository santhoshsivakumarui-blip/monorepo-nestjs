import type { Express, Request, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { IncomingMessage } from "http";
import type { Socket } from "net";

const targets: Record<string, string> = {
  users: process.env.USERS_SERVICE_URL ?? "http://users:3001",
  orders: process.env.ORDERS_SERVICE_URL ?? "http://orders:3002",
  notifications:
    process.env.NOTIFICATIONS_SERVICE_URL ?? "http://notifications:3003",
  email: process.env.EMAIL_SERVICE_URL ?? "http://email:3004",
  sms: process.env.SMS_SERVICE_URL ?? "http://sms:3005",
  admin: process.env.ADMIN_SERVICE_URL ?? "http://admin:3006",
  subscriptions:
    process.env.SUBSCRIPTIONS_SERVICE_URL ?? "http://subscriptions:3007",
  vitals: process.env.VITALS_SERVICE_URL ?? "http://vitals:3008",
  "clinical-records":
    process.env.CLINICAL_RECORDS_SERVICE_URL ?? "http://clinical-records:3009",
};

/**
 * Mounts a transparent reverse proxy for each backend microservice under
 * `/api/<service>`, making the gateway the single public entry point. Express
 * strips the `/api/<service>` mount prefix, so the remainder (path + query) is
 * forwarded verbatim to the service, which keeps its own root-level routing.
 * http-proxy-middleware forwards every client header — including the
 * `Authorization` bearer token that each service's JwtRolesGuard requires —
 * supports all HTTP methods, streams the request body (so multipart uploads
 * work), and preserves upstream status codes.
 */
export function mountServiceProxies(app: Express): void {
  for (const [service, target] of Object.entries(targets)) {
    app.use(
      `/api/${service}`,
      createProxyMiddleware({
        target,
        changeOrigin: true,
        on: {
          error: (
            err: Error,
            _req: IncomingMessage | Request,
            res: Response | Socket,
          ) => {
            if (!("writeHead" in res)) return;
            const response = res as Response;
            if (!response.headersSent) {
              response.writeHead(502, { "content-type": "application/json" });
            }
            response.end(
              JSON.stringify({
                type: "https://httpstatuses.com/502",
                title: "Bad Gateway",
                status: 502,
                detail: `Upstream service "${service}" unavailable: ${err.message}`,
              }),
            );
          },
        },
      }),
    );
  }
}
