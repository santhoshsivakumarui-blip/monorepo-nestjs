import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsEmail, IsIn, IsNotEmpty, IsString, IsUUID } from "class-validator";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard, RequireRolesGuard } from "../../../libs/common/src/oidc";

const platformAdminGuard = new RequireRolesGuard(["PLATFORM_ADMIN"]);

export class CreateAdminUserDto {
  /** Must equal the OIDC subject (JWT `sub`) this person authenticates with. */
  @IsUUID()
  id!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsIn(["PLATFORM_ADMIN", "AUDITOR", "PROVISIONER"])
  role!: string;
}

@Controller("admin-users")
export class AdminUsersController {
  @Get("health") health() {
    return { status: "ok", service: "admin" };
  }

  /**
   * Bootstrapping note: creating the first admin_users row requires an
   * existing PLATFORM_ADMIN caller, which doesn't exist yet on a fresh
   * environment — seed that first row directly via migration/SQL, then
   * manage the rest through this endpoint.
   */
  @Post()
  @UseGuards(JwtRolesGuard, platformAdminGuard)
  async create(@Body() body: CreateAdminUserDto) {
    await database().query(
      "INSERT INTO admin_users (id, email, full_name, role) VALUES ($1, $2, $3, $4)",
      [body.id, body.email, body.fullName, body.role],
    );
    return { id: body.id, accepted: true };
  }

  @Get()
  @UseGuards(JwtRolesGuard, platformAdminGuard)
  async list() {
    const { rows } = await database().query(
      "SELECT id, email, full_name, role, status, last_login_at, created_at FROM admin_users ORDER BY created_at DESC",
    );
    return rows;
  }
}
