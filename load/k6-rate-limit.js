import http from 'k6/http';
import { check } from 'k6';
export const options = { vus: 1, iterations: 6 };
export default function () {
  const response = http.post(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/auth/token`, JSON.stringify({ userId: 'load-test' }), { headers: { 'content-type': 'application/json' } });
  check(response, { 'rate-limit or accepted': (r) => r.status === 200 || r.status === 429 });
}
