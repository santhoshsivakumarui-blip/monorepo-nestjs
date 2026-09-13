function validateSecretTlsRollout(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [] };
  }

  const required = [
    "SECRET_MANAGER",
    "TLS_INGRESS",
    "CERT_ISSUER",
    "CERT_SECRET_NAME",
    "CERT_RENEWAL_BEFORE_DAYS",
  ];

  const issues = [];

  for (const key of required) {
    if (!env[key]) issues.push(key);
  }

  const renewalDays = Number(env.CERT_RENEWAL_BEFORE_DAYS ?? "");
  if (
    env.CERT_RENEWAL_BEFORE_DAYS &&
    (!Number.isFinite(renewalDays) || renewalDays <= 0)
  ) {
    issues.push("CERT_RENEWAL_BEFORE_DAYS");
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

if (require.main === module) {
  const result = validateSecretTlsRollout();
  if (!result.ok) {
    console.error(
      `Secret and TLS rollout validation failed: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Secret and TLS rollout validation: OK");
}

module.exports = { validateSecretTlsRollout };
