import {
  BadRequestException, Controller, Get, Header, Query, Req, UseGuards,
} from "@nestjs/common";
import { queryAsTenant } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireTenantScope } from "./tenant-scope";

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function fetchAuditLog(tenantId: string, category?: string, search?: string) {
  const conditions = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(action ILIKE $${params.length} OR target ILIKE $${params.length} OR actor_label ILIKE $${params.length})`);
  }
  const { rows } = await queryAsTenant(
    tenantId,
    `SELECT id, actor_id, actor_label, action, target, category, created_at
     FROM hospital_audit_events WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

@Controller("hospital-audit-log")
export class HospitalAuditController {
  @Get()
  @UseGuards(JwtRolesGuard)
  async list(
    @Query("tenantId") tenantId: string | undefined,
    @Query("category") category: string | undefined,
    @Query("search") search: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    return fetchAuditLog(tenantId, category, search);
  }

  @Get("export")
  @UseGuards(JwtRolesGuard)
  @Header("Content-Type", "text/csv")
  @Header("Content-Disposition", "attachment; filename=audit-log.csv")
  async export(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const rows = await fetchAuditLog(tenantId);

    const header = ["id", "actor_id", "actor_label", "action", "target", "category", "created_at"];
    const lines = [header.join(",")];
    for (const row of rows) {
      lines.push(header.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(","));
    }
    return lines.join("\n");
  }
}
