import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() { return { status: 'ok', service: 'api-gateway' }; }

  @Get('ready')
  ready() {
    if (process.env.READY !== 'false') return { status: 'ready' };
    throw new ServiceUnavailableException('gateway is not ready');
  }
}
