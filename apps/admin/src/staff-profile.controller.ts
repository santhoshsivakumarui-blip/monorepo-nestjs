import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req, UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { database, queryAsTenant } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";
import { verifyPassword, hashPassword } from "../../../libs/common/src/password";

export class UpdateStaffProfileDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() license?: string;
  @IsOptional() @IsString() phone?: string;
}

export class UpdateNotificationPreferencesDto {
  @IsOptional() @IsBoolean() critical?: boolean;
  @IsOptional() @IsBoolean() messages?: boolean;
  @IsOptional() @IsBoolean() scripts?: boolean;
  @IsOptional() @IsBoolean() weeklySummary?: boolean;
}

export class SetMfaDto {
  @IsBoolean() enabled!: boolean;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() currentPassword!: string;
  @IsString() @MinLength(8) newPassword!: string;
}

interface AuthenticatedRequest { user?: { sub: string; tenantId?: string }; }

@Controller("staff/me")
export class StaffProfileController {
  @Get()
  @UseGuards(JwtRolesGuard)
  async get(@Req() req: AuthenticatedRequest) {
    const { rows } = await queryAsTenant(
      req.user!.tenantId!,
      "SELECT id, email, full_name, role, department, phone, license, mfa_enabled FROM tenant_staff WHERE id = $1",
      [req.user!.sub],
    );
    if (!rows[0]) throw new NotFoundException("Staff account not found.");
    return rows[0];
  }

  @Patch()
  @UseGuards(JwtRolesGuard)
  async update(@Body() body: UpdateStaffProfileDto, @Req() req: AuthenticatedRequest) {
    await queryAsTenant(
      req.user!.tenantId!,
      `UPDATE tenant_staff SET
         full_name = COALESCE($2, full_name), license = COALESCE($3, license), phone = COALESCE($4, phone)
       WHERE id = $1`,
      [req.user!.sub, body.fullName ?? null, body.license ?? null, body.phone ?? null],
    );
    return { accepted: true };
  }

  @Get("notification-preferences")
  @UseGuards(JwtRolesGuard)
  async getPreferences(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      "SELECT critical, messages, scripts, weekly_summary FROM staff_notification_preferences WHERE staff_id = $1",
      [req.user!.sub],
    );
    return rows[0] ?? { critical: true, messages: true, scripts: true, weekly_summary: false };
  }

  @Patch("notification-preferences")
  @UseGuards(JwtRolesGuard)
  async updatePreferences(@Body() body: UpdateNotificationPreferencesDto, @Req() req: AuthenticatedRequest) {
    await database().query(
      `INSERT INTO staff_notification_preferences (staff_id, critical, messages, scripts, weekly_summary)
       VALUES ($1, COALESCE($2, true), COALESCE($3, true), COALESCE($4, true), COALESCE($5, false))
       ON CONFLICT (staff_id) DO UPDATE SET
         critical = COALESCE($2, staff_notification_preferences.critical),
         messages = COALESCE($3, staff_notification_preferences.messages),
         scripts = COALESCE($4, staff_notification_preferences.scripts),
         weekly_summary = COALESCE($5, staff_notification_preferences.weekly_summary)`,
      [req.user!.sub, body.critical ?? null, body.messages ?? null, body.scripts ?? null, body.weeklySummary ?? null],
    );
    return { accepted: true };
  }

  @Patch("mfa")
  @UseGuards(JwtRolesGuard)
  async setMfa(@Body() body: SetMfaDto, @Req() req: AuthenticatedRequest) {
    await queryAsTenant(
      req.user!.tenantId!, "UPDATE tenant_staff SET mfa_enabled = $2 WHERE id = $1", [req.user!.sub, body.enabled],
    );
    return { enabled: body.enabled };
  }

  @Post("change-password")
  @UseGuards(JwtRolesGuard)
  async changePassword(@Body() body: ChangePasswordDto, @Req() req: AuthenticatedRequest) {
    const { rows } = await queryAsTenant<{ password_hash: string | null }>(
      req.user!.tenantId!, "SELECT password_hash FROM tenant_staff WHERE id = $1", [req.user!.sub],
    );
    if (!rows[0]?.password_hash || !verifyPassword(body.currentPassword, rows[0].password_hash)) {
      throw new BadRequestException("Current password is incorrect.");
    }
    await queryAsTenant(
      req.user!.tenantId!,
      "UPDATE tenant_staff SET password_hash = $2 WHERE id = $1",
      [req.user!.sub, hashPassword(body.newPassword)],
    );
    return { accepted: true };
  }

  @Get("sessions")
  @UseGuards(JwtRolesGuard)
  async sessions(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      "SELECT id, device_label, ip_address, created_at, revoked_at FROM staff_sessions WHERE staff_id = $1 ORDER BY created_at DESC",
      [req.user!.sub],
    );
    return rows;
  }

  @Delete("sessions/:id")
  @UseGuards(JwtRolesGuard)
  async revokeSession(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ staff_id: string }>(
      "SELECT staff_id FROM staff_sessions WHERE id = $1", [id],
    );
    const session = existing.rows[0];
    if (!session) throw new NotFoundException("Session not found.");
    if (session.staff_id !== req.user!.sub) throw new ForbiddenException("Cannot revoke another staff member's session.");

    await database().query("UPDATE staff_sessions SET revoked_at = NOW() WHERE id = $1", [id]);
    return { id, revoked: true };
  }
}
