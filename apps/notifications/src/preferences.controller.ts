import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsOptional } from "class-validator";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

export class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() smsEnabled?: boolean;
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
  @IsOptional() @IsBoolean() analyticsEnabled?: boolean;
}

interface AuthenticatedRequest { user?: { sub: string }; }

@Controller("notifications/preferences")
export class PreferencesController {
  @Get("mine")
  @UseGuards(JwtRolesGuard)
  async get(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      "SELECT email_enabled, sms_enabled, push_enabled, analytics_enabled FROM notification_preferences WHERE user_id = $1",
      [req.user!.sub],
    );
    return rows[0] ?? { email_enabled: true, sms_enabled: false, push_enabled: true, analytics_enabled: true };
  }

  @Patch("mine")
  @UseGuards(JwtRolesGuard)
  async update(@Body() body: UpdatePreferencesDto, @Req() req: AuthenticatedRequest) {
    await database().query(
      `INSERT INTO notification_preferences (user_id, email_enabled, sms_enabled, push_enabled, analytics_enabled)
       VALUES ($1, COALESCE($2, true), COALESCE($3, false), COALESCE($4, true), COALESCE($5, true))
       ON CONFLICT (user_id) DO UPDATE SET
         email_enabled = COALESCE($2, notification_preferences.email_enabled),
         sms_enabled = COALESCE($3, notification_preferences.sms_enabled),
         push_enabled = COALESCE($4, notification_preferences.push_enabled),
         analytics_enabled = COALESCE($5, notification_preferences.analytics_enabled)`,
      [req.user!.sub, body.emailEnabled ?? null, body.smsEnabled ?? null, body.pushEnabled ?? null, body.analyticsEnabled ?? null],
    );
    return { accepted: true };
  }
}
