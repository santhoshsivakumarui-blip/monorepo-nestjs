import { Pool } from 'pg';

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Keep completed responses for 24 hours; run as a daily job per service database.
  await pool.query("DELETE FROM idempotency_keys WHERE completed_at < NOW() - INTERVAL '24 hours'");
  await pool.end();
}
run().catch((error) => { console.error(error); process.exit(1); });
