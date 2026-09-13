const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "KAFKA_BROKERS",
  "RABBITMQ_URL",
  "REDIS_URL",
  "ELASTICSEARCH_NODE",
];
const placeholders = /change-me|development-only|example|placeholder/i;
const missing = required.filter((key) => !process.env[key]);
const invalid = required.filter(
  (key) =>
    typeof process.env[key] === "string" && placeholders.test(process.env[key]),
);

if (missing.length || invalid.length) {
  const issues = [...missing, ...invalid];
  console.error(
    `Invalid or missing environment values: ${[...new Set(issues)].join(", ")}`,
  );
  process.exit(1);
}
console.log("Environment: OK");
