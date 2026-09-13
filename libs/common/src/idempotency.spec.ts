import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  beginIdempotent,
  completeIdempotent,
  requestFingerprint,
} from "./idempotency";

describe("idempotency guard", () => {
  it("requires a key between 16 and 255 characters", async () => {
    const client = { query: jest.fn() } as any;

    await expect(
      beginIdempotent(client, "short", "fingerprint"),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("returns the stored response when the same request is replayed", async () => {
    const response = { userId: "u-1", email: "user@example.com" };
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ fingerprint: "same", response }] }),
    } as any;

    await expect(
      beginIdempotent(client, "1234567890abcdef", "same"),
    ).resolves.toEqual(response);
  });

  it("rejects a replay with the same key but a different payload fingerprint", async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({
          rows: [{ fingerprint: "different", response: null }],
        }),
    } as any;

    await expect(
      beginIdempotent(client, "1234567890abcdef", "current"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("stores the final response when work completes", async () => {
    const client = { query: jest.fn().mockResolvedValue({}) } as any;
    await expect(
      completeIdempotent(client, "1234567890abcdef", { ok: true }),
    ).resolves.toBeUndefined();

    expect(client.query).toHaveBeenCalledWith(
      "UPDATE idempotency_keys SET response = $2, completed_at = NOW() WHERE key = $1",
      ["1234567890abcdef", { ok: true }],
    );
  });

  it("creates a stable request fingerprint from method, route, and payload", () => {
    const first = requestFingerprint("POST", "/users", {
      email: "user@example.com",
    });
    const second = requestFingerprint("POST", "/users", {
      email: "user@example.com",
    });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });
});
