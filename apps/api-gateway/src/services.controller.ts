import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { request } from 'http';

const targets: Record<string, string> = {
  users: process.env.USERS_SERVICE_URL ?? 'http://users:3001',
  orders: process.env.ORDERS_SERVICE_URL ?? 'http://orders:3002',
  notifications: process.env.NOTIFICATIONS_SERVICE_URL ?? 'http://notifications:3003',
};

/** Minimal reverse proxy. Replace with an API-management product at scale. */
@Controller()
export class ServicesController {
  private async forward(service: string, method: string, path: string, body?: unknown, headers?: Record<string, string | undefined>) {
    const base = targets[service];
    if (!base) return { error: 'unknown service' };
    const url = new URL(path, base);
    return new Promise<unknown>((resolve, reject) => {
      const req = request(url, { method, headers: { 'content-type': 'application/json', 'idempotency-key': headers?.['idempotency-key'] ?? '', 'x-request-id': headers?.['x-request-id'] ?? '' } }, (res) => {
        let value = ''; res.on('data', (chunk) => value += chunk);
        res.on('end', () => resolve(value ? JSON.parse(value) : null));
      });
      req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
    });
  }
  @Get(':service/:resource') get(@Param('service') service: string, @Param('resource') resource: string) { return this.forward(service, 'GET', `/${resource}`); }
  @Post(':service/:resource') post(@Param('service') service: string, @Param('resource') resource: string, @Body() body: unknown, @Headers() headers: Record<string, string | undefined>) { return this.forward(service, 'POST', `/${resource}`, body, headers); }
}
