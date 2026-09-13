import { PostgreSqlContainer } from '@testcontainers/postgresql';

describe('infrastructure', () => {
  it('starts a disposable PostgreSQL database', async () => {
    const database = await new PostgreSqlContainer('postgres:17-alpine').start();
    expect(database.getConnectionUri()).toContain('postgresql://');
    await database.stop();
  });
});
