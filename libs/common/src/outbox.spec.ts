import { getOutboxRetryStatus } from "./outbox";

describe("outbox retry status", () => {
  it("marks events as failed before the limit and dead-letter after the limit", () => {
    expect(getOutboxRetryStatus(0, 5)).toBe("pending");
    expect(getOutboxRetryStatus(3, 5)).toBe("failed");
    expect(getOutboxRetryStatus(5, 5)).toBe("dead-letter");
  });
});
