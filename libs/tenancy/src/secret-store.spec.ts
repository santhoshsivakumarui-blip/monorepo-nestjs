import { registryDatabase } from "./registry-database";
import {
  decryptSecret, deleteTenantDatabaseSecret, encryptSecret,
  fetchTenantDatabaseSecret, storeTenantDatabaseSecret,
} from "./secret-store";

jest.mock("./registry-database");

const mockedDatabase = registryDatabase as jest.MockedFunction<typeof registryDatabase>;

describe("secret-store", () => {
  const originalKey = process.env.TENANT_SECRETS_KEY;

  beforeEach(() => {
    process.env.TENANT_SECRETS_KEY = "opOvIdmkBoTKDQQfxGKw0yvlU91lW7kINg0AF4S/FbE=";
    mockedDatabase.mockReset();
  });

  afterAll(() => {
    process.env.TENANT_SECRETS_KEY = originalKey;
  });

  describe("encryptSecret / decryptSecret", () => {
    it("round-trips a connection string", () => {
      const plaintext = "postgresql://user:pass@host/enterprise_acme_vitals_db?sslmode=require";
      const encrypted = encryptSecret(plaintext);
      expect(encrypted).not.toContain(plaintext);
      expect(decryptSecret(encrypted)).toBe(plaintext);
    });

    it("produces a different ciphertext each time (random IV)", () => {
      const plaintext = "postgresql://user:pass@host/db";
      expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
    });

    it("throws without TENANT_SECRETS_KEY set", () => {
      delete process.env.TENANT_SECRETS_KEY;
      expect(() => encryptSecret("x")).toThrow("TENANT_SECRETS_KEY is not set");
    });

    it("throws when the key is the wrong length", () => {
      process.env.TENANT_SECRETS_KEY = Buffer.from("too-short").toString("base64");
      expect(() => encryptSecret("x")).toThrow("must decode to exactly 32 bytes");
    });

    it("throws on a tampered ciphertext (GCM auth tag mismatch)", () => {
      const encrypted = encryptSecret("postgresql://user:pass@host/db");
      const [iv, tag, data] = encrypted.split(":");
      const tampered = [iv, tag, Buffer.from("tampered").toString("base64") + data.slice(8)].join(":");
      expect(() => decryptSecret(tampered)).toThrow();
    });
  });

  describe("storeTenantDatabaseSecret / fetchTenantDatabaseSecret", () => {
    it("stores an encrypted value and fetches back the original plaintext", async () => {
      let stored: string | undefined;
      const query = jest.fn().mockImplementation((sql: string, params: unknown[]) => {
        if (sql.startsWith("INSERT")) {
          stored = params[1] as string;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: stored ? [{ connection_string_encrypted: stored }] : [] });
      });
      mockedDatabase.mockReturnValue({ query } as any);

      await storeTenantDatabaseSecret("enterprise_acme_vitals_db", "postgresql://user:pass@host/enterprise_acme_vitals_db");
      const fetched = await fetchTenantDatabaseSecret("enterprise_acme_vitals_db");

      expect(fetched).toBe("postgresql://user:pass@host/enterprise_acme_vitals_db");
      expect(stored).not.toContain("postgresql://");
    });

    it("returns null when nothing is registered for that key", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      mockedDatabase.mockReturnValue({ query } as any);

      await expect(fetchTenantDatabaseSecret("unknown_db")).resolves.toBeNull();
    });

    it("deletes a secret", async () => {
      const query = jest.fn().mockResolvedValue({ rows: [] });
      mockedDatabase.mockReturnValue({ query } as any);

      await deleteTenantDatabaseSecret("enterprise_acme_vitals_db");
      expect(query).toHaveBeenCalledWith(
        "DELETE FROM tenant_database_secrets WHERE database_key = $1",
        ["enterprise_acme_vitals_db"],
      );
    });
  });
});
