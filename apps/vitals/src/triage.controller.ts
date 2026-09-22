import {
  BadRequestException, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { database, queryAsTenant } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { AuthenticatedRequest, requireTenantScope } from "./tenant-scope";

@Controller("triage")
export class TriageController {
  @Get("queue")
  @UseGuards(JwtRolesGuard)
  async queue(@Query("tenantId") tenantId: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!tenantId) throw new BadRequestException("tenantId query parameter is required.");
    requireTenantScope(req, tenantId);
    const { rows } = await queryAsTenant(
      tenantId,
      `SELECT id, user_id, metric, value, rule_source, status, created_at
       FROM triage_events WHERE tenant_id = $1 AND status = 'open'
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows;
  }

  @Post(":id/acknowledge")
  @UseGuards(JwtRolesGuard)
  async acknowledge(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ tenant_id: string }>(
      "SELECT tenant_id FROM triage_events WHERE id = $1", [id],
    );
    const event = existing.rows[0];
    if (!event) throw new NotFoundException("Triage event not found.");
    requireTenantScope(req, event.tenant_id);

    await queryAsTenant(
      event.tenant_id,
      "UPDATE triage_events SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2 WHERE id = $1",
      [id, req.user!.sub],
    );
    return { id, accepted: true };
  }
}
