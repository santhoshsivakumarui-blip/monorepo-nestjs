import { insertReading, resolveLinkedTenant } from "./readings";

describe("insertReading", () => {
  it("inserts the reading and does nothing else when the patient isn't linked to a tenant", async () => {
    const query = jest.fn().mockResolvedValueOnce({});
    const client = { query } as any;

    await insertReading(client, "user-1", undefined, { metric: "heart_rate", value: 160, unit: "bpm", recordedAt: "t", source: "face_scan" });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("INSERT INTO vitals_readings");
  });

  it("creates a triage event when linked and the reading breaches the effective rule", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({}) // insert vitals_readings
      .mockResolvedValueOnce({ rows: [] }) // patient_alert_overrides — none
      .mockResolvedValueOnce({ rows: [{ comparator: "gt", threshold: "150" }] }) // alert_rules — breached
      .mockResolvedValueOnce({}); // insert triage_events
    const client = { query } as any;

    await insertReading(client, "user-1", "tenant-1", { metric: "heart_rate", value: 160, unit: "bpm", recordedAt: "t", source: "face_scan" });

    expect(query.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes("INSERT INTO triage_events"))).toBe(true);
  });

  it("does not create a triage event for a non-breaching linked reading", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ comparator: "gt", threshold: "150" }] });
    const client = { query } as any;

    await insertReading(client, "user-1", "tenant-1", { metric: "heart_rate", value: 90, unit: "bpm", recordedAt: "t", source: "face_scan" });

    expect(query.mock.calls.some((c) => typeof c[0] === "string" && c[0].includes("INSERT INTO triage_events"))).toBe(false);
  });
});

describe("resolveLinkedTenant", () => {
  it("returns the tenantId when linked", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ tenant_id: "tenant-1" }] });
    const client = { query } as any;

    await expect(resolveLinkedTenant(client, "user-1")).resolves.toBe("tenant-1");
  });

  it("returns undefined when not linked", async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const client = { query } as any;

    await expect(resolveLinkedTenant(client, "user-1")).resolves.toBeUndefined();
  });
});
