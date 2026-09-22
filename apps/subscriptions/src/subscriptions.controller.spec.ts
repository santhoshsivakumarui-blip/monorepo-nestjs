import { computeCurrentPeriodEnd } from "./subscriptions.controller";

describe("computeCurrentPeriodEnd", () => {
  it("adds one month for a monthly cycle", () => {
    const from = new Date("2026-01-15T00:00:00.000Z");
    expect(computeCurrentPeriodEnd("monthly", from).toISOString()).toBe(
      "2026-02-15T00:00:00.000Z",
    );
  });

  it("adds one year for an annual cycle", () => {
    const from = new Date("2026-01-15T00:00:00.000Z");
    expect(computeCurrentPeriodEnd("annual", from).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });
});
