import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsNotEmpty, IsObject, IsString } from "class-validator";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard, RequireRolesGuard } from "../../../libs/common/src/oidc";

const platformAdminGuard = new RequireRolesGuard(["PLATFORM_ADMIN"]);

export class UpsertHardwareSkuDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  modelName!: string;

  @IsString()
  @IsNotEmpty()
  hardwareRevision!: string;

  @IsString()
  @IsNotEmpty()
  minSupportedFirmware!: string;

  @IsObject()
  sensorCapabilities!: Record<string, boolean>;
}

@Controller("hardware-catalog")
export class HardwareCatalogController {
  @Get("health") health() {
    return { status: "ok", service: "admin" };
  }

  @Post()
  @UseGuards(JwtRolesGuard, platformAdminGuard)
  async upsert(@Body() body: UpsertHardwareSkuDto) {
    await database().query(
      `INSERT INTO global_hardware_catalog (sku, model_name, hardware_revision, min_supported_firmware, sensor_capabilities)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sku) DO UPDATE SET
         model_name = $2, hardware_revision = $3, min_supported_firmware = $4, sensor_capabilities = $5`,
      [
        body.sku,
        body.modelName,
        body.hardwareRevision,
        body.minSupportedFirmware,
        body.sensorCapabilities,
      ],
    );
    return { sku: body.sku, accepted: true };
  }

  @Get()
  @UseGuards(JwtRolesGuard)
  async list() {
    const { rows } = await database().query(
      "SELECT * FROM global_hardware_catalog ORDER BY created_at DESC",
    );
    return rows;
  }
}
