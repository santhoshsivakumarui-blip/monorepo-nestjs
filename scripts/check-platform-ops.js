function validatePlatformOperationsReadiness(env = process.env) {
  if (env.NODE_ENV !== "production") {
    return { ok: true, issues: [] };
  }

  const required = [
    "SECRET_MANAGER",
    "TLS_INGRESS",
    "IMAGE_TAG",
    "ALERT_ROUTING",
  ];

  const issues = [];
  for (const key of required) {
    if (!env[key]) issues.push(key);
  }

  if (env.IMAGE_TAG && env.IMAGE_TAG.toLowerCase() === "latest") {
    issues.push("IMAGE_TAG");
  }

  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
  };
}

if (require.main === module) {
  const result = validatePlatformOperationsReadiness();
  if (!result.ok) {
    console.error(
      `Platform operations readiness check failed: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Platform operations readiness: OK");
}

module.exports = { validatePlatformOperationsReadiness };
