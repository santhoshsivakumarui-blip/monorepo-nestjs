import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports the gateway as healthy', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok', service: 'api-gateway' });
  });
});
