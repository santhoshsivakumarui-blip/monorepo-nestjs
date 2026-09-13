const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "KAFKA_BROKERS",
  "RABBITMQ_URL",
  "REDIS_URL",
  "ELASTICSEARCH_NODE",
];
const placeholders = /change-me|development-only|example|placeholder/i;

function validateRequiredEnvironment(env = process.env) {
  const missing = required.filter((key) => !env[key]);
  const invalid = required.filter(
    (key) => typeof env[key] === "string" && placeholders.test(env[key]),
  );

  const issues = [...new Set([...missing, ...invalid])];

  return {
    ok: issues.length === 0,
    issues,
  };
}

if (require.main === module) {
  const result = validateRequiredEnvironment();
  if (!result.ok) {
    console.error(
      `Invalid or missing environment values: ${result.issues.join(", ")}`,
    );
    process.exit(1);
  }
  console.log("Environment: OK");
}

module.exports = { required, validateRequiredEnvironment };
