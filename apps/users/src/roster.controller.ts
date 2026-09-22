import {
  BadRequestException, Controller, ForbiddenException, Get, Header, Query, Req, UseGuards,
} from "@nestjs/common";
import { queryAsTenant } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

function requireTenantScope(req: AuthenticatedRequest, tenantId: string) {
  if (req.user!.tenantId && req.user!.tenantId !== tenantId) {
    throw new ForbiddenException("Cannot view another tenant's roster.");
  }
}

/** Identity/profile side of the roster only — the clinic app composes this with
 * apps/vitals's per-patient latest readings via a second call (client-side
 * composition, not a DB join, per the service-boundary ADR). */
async function fetchRoster(tenantId: string) {
  const { rows } = await queryAsTenant<{
    id: string; full_name: string | null; dob: string | null; sex: string | null;
    linked_at: string; treating_clinician_id: string | null;
  }>(
    tenantId,
    `SELECT u.id, pp.full_name, pp.dob, pp.sex, l.linked_at, l.treating_clinician_id
     FROM patient_hospital_links l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN patient_profiles pp ON pp.user_id = u.id
     WHERE l.tenant_id = $1
     ORDER BY l.linked_at DESC`,
    [tenantId],
  );

  return rows.map((row) => ({
    id: row.id,
    mrn: `PT-${row.id.slice(0, 8).toUpperCase()}`,
    name: row.full_name,
    dob: row.dob,
    sex: row.sex,
    linkedAt: row.linked_at,
    treatingClinicianId: row.treating_clinician_id,
  }));
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Controller("users")
export class RosterController {
  @Get("roster")
  @UseGuards(JwtRolesGuard)
  async roster(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    return fetchRoster(tenantId);
  }

  @Get("roster/export")
  @UseGuards(JwtRolesGuard)
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", "attachment; filename=roster.csv")
  async exportRoster(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const rows = await fetchRoster(tenantId);

    const header = ["id", "mrn", "name", "dob", "sex", "linkedAt", "treatingClinicianId"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(header.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(","));
    }
    return lines.join("\n");
  }
}
