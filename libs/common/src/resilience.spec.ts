import { withRetry, withTimeout } from "./resilience";

describe("resilience helpers", () => {
  it("retries transient failures until success", async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("temporary failure");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 1 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("times out slow operations", async () => {
    await expect(
      withTimeout(
        new Promise((resolve) => setTimeout(() => resolve("too late"), 50)),
        10,
      ),
    ).rejects.toThrow("operation timed out");
  });
});
