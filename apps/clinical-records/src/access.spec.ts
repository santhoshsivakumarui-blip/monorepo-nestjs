import { ForbiddenException } from "@nestjs/common";
import { requireStaffForTenant, requireStaffOrSelf } from "./access";

describe("requireStaffOrSelf", () => {
  it("allows a staff caller whose token tenantId matches", () => {
    expect(() => requireStaffOrSelf({ user: { sub: "staff-1", tenantId: "tenant-1" } }, "patient-1", "tenant-1"))
      .not.toThrow();
  });

  it("rejects a staff caller whose token tenantId does not match", () => {
    expect(() => requireStaffOrSelf({ user: { sub: "staff-1", tenantId: "tenant-2" } }, "patient-1", "tenant-1"))
      .toThrow(ForbiddenException);
  });

  it("allows a patient caller viewing their own records", () => {
    expect(() => requireStaffOrSelf({ user: { sub: "patient-1" } }, "patient-1", "tenant-1"))
      .not.toThrow();
  });

  it("rejects a patient caller viewing another patient's records", () => {
    expect(() => requireStaffOrSelf({ user: { sub: "patient-1" } }, "patient-2", "tenant-1"))
      .toThrow(ForbiddenException);
  });
});

describe("requireStaffForTenant", () => {
  it("allows a staff caller for their own tenant", () => {
    expect(() => requireStaffForTenant({ user: { sub: "staff-1", tenantId: "tenant-1" } }, "tenant-1"))
      .not.toThrow();
  });

  it("rejects a patient caller outright, even for their own id", () => {
    expect(() => requireStaffForTenant({ user: { sub: "patient-1" } }, "tenant-1"))
      .toThrow(ForbiddenException);
  });

  it("rejects a staff caller for a different tenant", () => {
    expect(() => requireStaffForTenant({ user: { sub: "staff-1", tenantId: "tenant-2" } }, "tenant-1"))
      .toThrow(ForbiddenException);
  });
});
