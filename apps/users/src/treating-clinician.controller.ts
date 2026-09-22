import {
  Body, Controller, ForbiddenException, NotFoundException, Param, Patch, Req, UseGuards,
} from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { database, queryAsTenant } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

export class SetTreatingClinicianDto {
  @IsString() @IsNotEmpty() clinicianId!: string;
}

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

/** Separate controller (rather than a method on RosterController) purely because
 * its path lives under /patients, not /users. */
@Controller("patients")
export class TreatingClinicianController {
  @Patch(":id/treating-clinician")
  @UseGuards(JwtRolesGuard)
  async set(
    @Param("id") id: string,
    @Body() body: SetTreatingClinicianDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const existing = await database().query<{ tenant_id: string }>(
      "SELECT tenant_id FROM patient_hospital_links WHERE user_id = $1", [id],
    );
    const link = existing.rows[0];
    if (!link) throw new NotFoundException("This patient is not linked to any hospital.");
    if (!req.user!.tenantId || req.user!.tenantId !== link.tenant_id) {
      throw new ForbiddenException("Cannot manage another tenant's patients.");
    }

    await queryAsTenant(
      link.tenant_id,
      "UPDATE patient_hospital_links SET treating_clinician_id = $2 WHERE user_id = $1",
      [id, body.clinicianId],
    );
    return { userId: id, clinicianId: body.clinicianId, accepted: true };
  }
}
