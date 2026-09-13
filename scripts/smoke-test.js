const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";
const net = require("net");
const Redis = require("ioredis");
const { Client } = require("pg");
const { Kafka } = require("kafkajs");
const { validateRequiredEnvironment } = require("./check-env.js");

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return { response, body };
}

async function assertTcpReachable(host, port, label) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          `${label} dependency check failed: timeout connecting to ${host}:${port}`,
        ),
      );
    }, 5000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.end();
      console.log(`Dependency check: ${label} reachable at ${host}:${port}`);
      resolve();
    });

    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label} dependency check failed: ${error.message}`));
    });
  });
}

async function assertKafkaReachable() {
  if (!process.env.KAFKA_BROKERS) {
    throw new Error("KAFKA_BROKERS is not configured");
  }

  const [first] = process.env.KAFKA_BROKERS.split(",");
  const [host, portText] = first.split(":");
  const port = Number(portText ?? 9092);

  await assertTcpReachable(host, port, "Kafka");

  const kafka = new Kafka({ brokers: [`${host}:${port}`] });
  const admin = kafka.admin();
  await admin.connect();
  await admin.listTopics();
  await admin.disconnect();
}

async function assertRabbitMqReachable() {
  if (!process.env.RABBITMQ_URL) {
    throw new Error("RABBITMQ_URL is not configured");
  }

  const url = new URL(process.env.RABBITMQ_URL);
  const host = url.hostname;
  const port = Number(url.port || 5672);

  await assertTcpReachable(host, port, "RabbitMQ");
}

async function assertDependencies() {
  const envResult = validateRequiredEnvironment();
  if (!envResult.ok) {
    throw new Error(
      `Invalid environment configuration: ${envResult.issues.join(", ")}`,
    );
  }

  const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    await redis.ping();
    console.log("Dependency check: Redis reachable");
  } catch (error) {
    throw new Error(
      `Redis dependency check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await redis.quit().catch(() => undefined);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await db.connect();
    await db.query("SELECT 1");
    console.log("Dependency check: PostgreSQL reachable");
  } catch (error) {
    throw new Error(
      `PostgreSQL dependency check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await db.end().catch(() => undefined);
  }

  await assertKafkaReachable();
  await assertRabbitMqReachable();
}

async function assertGet(path, expectedStatus = 200) {
  const { response, body } = await fetchJson(`${baseUrl}${path}`);

  if (response.status !== expectedStatus) {
    throw new Error(
      `${path} returned ${response.status} instead of ${expectedStatus}: ${JSON.stringify(body)}`,
    );
  }

  return body;
}

async function assertTokenFlow() {
  const { response, body } = await fetchJson(`${baseUrl}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "smoke-user", roles: ["user"] }),
  });

  if (response.status !== 201 && response.status !== 200) {
    throw new Error(
      `/api/auth/token returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  if (!body.accessToken || typeof body.accessToken !== "string") {
    throw new Error(
      `/api/auth/token did not return an accessToken: ${JSON.stringify(body)}`,
    );
  }

  const me = await fetchJson(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${body.accessToken}` },
  });

  if (me.response.status !== 200) {
    throw new Error(
      `/api/auth/me returned ${me.response.status}: ${JSON.stringify(me.body)}`,
    );
  }

  return body;
}

async function main() {
  try {
    await assertDependencies();
    const health = await assertGet("/api/health");
    const ready = await assertGet("/api/health/ready");
    const token = await assertTokenFlow();

    console.log(`Smoke test passed: ${baseUrl}`);
    console.log(
      JSON.stringify(
        { health, ready, tokenIssued: !!token.accessToken },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Smoke test failed for ${baseUrl}`);
    console.error(message);

    if (
      message.includes("Redis") ||
      message.includes("REDIS_URL") ||
      message.includes("Rate limiter unavailable") ||
      message.includes("503")
    ) {
      console.error(
        "The gateway depends on Redis for rate limiting. Start the local platform stack or ensure REDIS_URL is reachable before rerunning this smoke test.",
      );
    }

    if (message.includes("PostgreSQL") || message.includes("DATABASE_URL")) {
      console.error(
        "The gateway depends on PostgreSQL for core service state. Confirm the database is reachable before rerunning this smoke test.",
      );
    }

    process.exit(1);
  }
}

main();
