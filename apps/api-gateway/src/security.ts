export function buildSecurityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-xss-protection": "0",
    "referrer-policy": "no-referrer",
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "content-security-policy":
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  };
}

export function buildCorsOrigins(raw?: string) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
