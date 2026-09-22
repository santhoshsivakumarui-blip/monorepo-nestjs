import {
  Body, Controller, ForbiddenException, Get, Param, Put, Req, UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

export class UpdatePatientProfileDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() dob?: string;
  @IsOptional() @IsIn(["female", "male", "other"]) sex?: string;
  @IsOptional() @IsString() heightCm?: string;
  @IsOptional() @IsString() weightKg?: string;
  @IsOptional() @IsIn(["resident", "visitor"]) residencyStatus?: string;
  @IsOptional() @IsString() passportNumber?: string;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
  @IsOptional() @IsString() emergencyContactRelationship?: string;
}

interface AuthenticatedRequest { user?: { sub: string }; }

@Controller("users")
export class PatientProfileController {
  @Get(":id/profile")
  @UseGuards(JwtRolesGuard)
  async get(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    if (req.user!.sub !== id) throw new ForbiddenException("Cannot view another user's profile.");
    const { rows } = await database().query(
      `SELECT user_id, full_name, dob, sex, height_cm, weight_kg, residency_status, passport_number,
              emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, updated_at
       FROM patient_profiles WHERE user_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  @Put(":id/profile")
  @UseGuards(JwtRolesGuard)
  async update(
    @Param("id") id: string,
    @Body() body: UpdatePatientProfileDto,
    @Req() req: AuthenticatedRequest,
  ) {
    if (req.user!.sub !== id) throw new ForbiddenException("Cannot update another user's profile.");
    await database().query(
      `INSERT INTO patient_profiles
         (user_id, full_name, dob, sex, height_cm, weight_kg, residency_status, passport_number,
          emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name, dob = EXCLUDED.dob, sex = EXCLUDED.sex,
         height_cm = EXCLUDED.height_cm, weight_kg = EXCLUDED.weight_kg,
         residency_status = EXCLUDED.residency_status, passport_number = EXCLUDED.passport_number,
         emergency_contact_name = EXCLUDED.emergency_contact_name,
         emergency_contact_phone = EXCLUDED.emergency_contact_phone,
         emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
         updated_at = NOW()`,
      [
        id, body.fullName ?? null, body.dob ?? null, body.sex ?? null,
        body.heightCm ?? null, body.weightKg ?? null, body.residencyStatus ?? null, body.passportNumber ?? null,
        body.emergencyContactName ?? null, body.emergencyContactPhone ?? null, body.emergencyContactRelationship ?? null,
      ],
    );
    return { userId: id, accepted: true };
  }
}
