function validateProductionReadiness(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [] };
  }

  const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "KAFKA_BROKERS",
    "RABBITMQ_URL",
    "REDIS_URL",
    "ELASTICSEARCH_NODE",
  ];

  const issues = [];
  const placeholderPattern = /change-me|development-only|example|placeholder/i;

  for (const key of required) {
    if (!env[key]) issues.push(key);
    else if (
      typeof env[key] === "string" &&
      placeholderPattern.test(env[key])
    ) {
      issues.push(key);
    }
  }

  const oidcConfigured = Boolean(
    env.OAUTH_ISSUER || env.OAUTH_AUDIENCE || env.OAUTH_CLIENT_ID,
  );

  if (oidcConfigured) {
    ["OAUTH_ISSUER", "OAUTH_AUDIENCE", "OAUTH_CLIENT_ID"].forEach((key) => {
      if (!env[key]) issues.push(key);
    });
  } else {
    ["JWT_ISSUER", "JWT_AUDIENCE"].forEach((key) => {
      if (!env[key]) issues.push(key);
    });
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

if (require.main === module) {
  const result = validateProductionReadiness();
  if (!result.ok) {
    console.error(
      `Production readiness check failed: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Production readiness: OK");
}

module.exports = { validateProductionReadiness };
