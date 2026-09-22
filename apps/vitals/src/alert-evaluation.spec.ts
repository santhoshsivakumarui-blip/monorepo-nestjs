import { breaches, resolveEffectiveRule } from "./alert-evaluation";

describe("breaches", () => {
  it("evaluates gt and lt comparators", () => {
    expect(breaches(160, "gt", 150)).toBe(true);
    expect(breaches(140, "gt", 150)).toBe(false);
    expect(breaches(85, "lt", 90)).toBe(true);
    expect(breaches(95, "lt", 90)).toBe(false);
  });
});

describe("resolveEffectiveRule", () => {
  it("prefers an enabled patient override over the hospital-wide rule", async () => {
    const runner = {
      query: jest.fn().mockResolvedValueOnce({ rows: [{ comparator: "gt", threshold: "180" }] }),
    } as any;

    const rule = await resolveEffectiveRule(runner, "user-1", "tenant-1", "heart_rate");

    expect(rule).toEqual({ comparator: "gt", threshold: 180, source: "patient_override" });
    expect(runner.query).toHaveBeenCalledTimes(1);
  });

  it("falls back to the hospital-wide rule when no enabled override exists", async () => {
    const runner = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // no override
        .mockResolvedValueOnce({ rows: [{ comparator: "gt", threshold: "150" }] }),
    } as any;

    const rule = await resolveEffectiveRule(runner, "user-1", "tenant-1", "heart_rate");

    expect(rule).toEqual({ comparator: "gt", threshold: 150, source: "hospital_wide" });
  });

  it("returns null when neither an override nor a hospital-wide rule exists", async () => {
    const runner = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    } as any;

    const rule = await resolveEffectiveRule(runner, "user-1", "tenant-1", "heart_rate");

    expect(rule).toBeNull();
  });
});
