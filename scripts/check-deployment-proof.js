function validateDeploymentProof(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [] };
  }

  const required = [
    "MANAGED_ENVIRONMENT",
    "MANAGED_CLUSTER",
    "DEPLOYMENT_NAMESPACE",
    "INGRESS_HOST",
    "GATEWAY_URL",
    "SERVICE_ROUTE",
    "BROKER_TOPIC",
    "CONSUMER_GROUP",
    "METRICS_ENDPOINT",
    "TRACE_ENDPOINT",
    "OBSERVABILITY_OWNER",
  ];

  const issues = [];

  for (const key of required) {
    if (!env[key] || !String(env[key]).trim()) {
      issues.push(key);
    }
  }

  const urlsToValidate = [
    ["GATEWAY_URL", env.GATEWAY_URL],
    ["METRICS_ENDPOINT", env.METRICS_ENDPOINT],
    ["TRACE_ENDPOINT", env.TRACE_ENDPOINT],
  ];

  for (const [key, value] of urlsToValidate) {
    if (!value) continue;
    try {
      new URL(String(value));
    } catch {
      issues.push(key);
    }
  }

  if (env.GATEWAY_URL && !String(env.GATEWAY_URL).startsWith("https://")) {
    issues.push("GATEWAY_URL");
  }

  if (env.SERVICE_ROUTE && !String(env.SERVICE_ROUTE).startsWith("/")) {
    issues.push("SERVICE_ROUTE");
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

if (require.main === module) {
  const result = validateDeploymentProof();
  if (!result.ok) {
    console.error(
      `Deployment proof validation failed: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Deployment proof validation: OK");
}

module.exports = { validateDeploymentProof };
