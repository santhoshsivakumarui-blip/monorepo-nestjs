import {
  Body, Controller, Delete, ForbiddenException, Headers, Param, Put, Req, UseGuards,
} from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import {
  beginIdempotent, completeIdempotent, requestFingerprint,
} from "../../../libs/common/src/idempotency";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { linkPatientToTenant, unlinkPatientFromTenant } from "./hospital-link";

export class LinkHospitalDto {
  @IsString() @IsNotEmpty() tenantId!: string;
}

interface AuthenticatedRequest { user?: { sub: string }; }

@Controller("users")
export class HospitalLinkController {
  @Put(":id/hospital-link")
  @UseGuards(JwtRolesGuard)
  async link(
    @Param("id") id: string,
    @Body() body: LinkHospitalDto,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user!.sub !== id) {
      throw new ForbiddenException("Cannot link a hospital for another user.");
    }

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ userId: string; tenantId: string }>(
        client, key, requestFingerprint("PUT", `/users/${id}/hospital-link`, body),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const payload = await linkPatientToTenant(client, id, body.tenantId);
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  @Delete(":id/hospital-link")
  @UseGuards(JwtRolesGuard)
  async unlink(
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user!.sub !== id) {
      throw new ForbiddenException("Cannot unlink a hospital for another user.");
    }

    const client = await database().connect();
    try {
      await client.query("BEGIN");
      const replay = await beginIdempotent<{ userId: string; tenantId: string | null }>(
        client, key, requestFingerprint("DELETE", `/users/${id}/hospital-link`, {}),
      );
      if (replay) { await client.query("COMMIT"); return replay; }

      const payload = (await unlinkPatientFromTenant(client, id)) ?? { userId: id, tenantId: null };
      await completeIdempotent(client, key!, payload);
      await client.query("COMMIT");
      return payload;
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }
}
