import { Controller, Get } from '@nestjs/common';

@Controller('billing')
export class BillingController {
  @Get()
  getHello(): string {
    return 'Billing service is running';
  }
}
