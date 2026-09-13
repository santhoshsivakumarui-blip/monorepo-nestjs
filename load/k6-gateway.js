import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 10, duration: '30s', thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] } };
export default function () { check(http.get(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/health`), { 'is healthy': (r) => r.status === 200 }); }
