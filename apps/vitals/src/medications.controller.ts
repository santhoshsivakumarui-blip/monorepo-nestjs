import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards,
} from "@nestjs/common";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { randomUUID } from "crypto";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

export class CreateMedicationScheduleDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() dose!: string;
  @IsString() @IsNotEmpty() timeOfDay!: string;
  @IsOptional() @IsString() note?: string;
}

interface AuthenticatedRequest { user?: { sub: string }; }

@Controller("medications")
export class MedicationsController {
  @Get("mine")
  @UseGuards(JwtRolesGuard)
  async mine(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      "SELECT id, name, dose, time_of_day, note, active FROM medication_schedules WHERE user_id = $1 AND active = true ORDER BY time_of_day",
      [req.user!.sub],
    );
    return rows;
  }

  @Post()
  @UseGuards(JwtRolesGuard)
  async create(@Body() body: CreateMedicationScheduleDto, @Req() req: AuthenticatedRequest) {
    const id = randomUUID();
    await database().query(
      "INSERT INTO medication_schedules (id, user_id, name, dose, time_of_day, note) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, req.user!.sub, body.name, body.dose, body.timeOfDay, body.note ?? null],
    );
    return { id, ...body, active: true };
  }

  @Post(":id/deactivate")
  @UseGuards(JwtRolesGuard)
  async deactivate(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ user_id: string }>(
      "SELECT user_id FROM medication_schedules WHERE id = $1", [id],
    );
    const schedule = existing.rows[0];
    if (!schedule) throw new NotFoundException("Medication schedule not found.");
    if (schedule.user_id !== req.user!.sub) throw new ForbiddenException("Cannot manage another patient's medications.");

    await database().query("UPDATE medication_schedules SET active = false WHERE id = $1", [id]);
    return { id, active: false };
  }

  /** Lazily ensures the day's dose rows exist (no cron job in this codebase — see the plan's named deferral), then returns them. */
  @Get("doses")
  @UseGuards(JwtRolesGuard)
  async doses(@Query("date") date: string | undefined, @Req() req: AuthenticatedRequest) {
    if (!date) throw new BadRequestException("date query parameter is required (YYYY-MM-DD).");
    const userId = req.user!.sub;

    const schedules = await database().query<{ id: string; name: string; dose: string; time_of_day: string; note: string | null }>(
      "SELECT id, name, dose, time_of_day, note FROM medication_schedules WHERE user_id = $1 AND active = true",
      [userId],
    );
    for (const schedule of schedules.rows) {
      await database().query(
        `INSERT INTO medication_doses (id, schedule_id, user_id, scheduled_date) VALUES ($1, $2, $3, $4)
         ON CONFLICT (schedule_id, scheduled_date) DO NOTHING`,
        [randomUUID(), schedule.id, userId, date],
      );
    }

    const { rows } = await database().query(
      `SELECT d.id, s.name, s.dose, s.time_of_day, s.note, d.taken, d.taken_at
       FROM medication_doses d JOIN medication_schedules s ON s.id = d.schedule_id
       WHERE d.user_id = $1 AND d.scheduled_date = $2
       ORDER BY s.time_of_day`,
      [userId, date],
    );
    return rows;
  }

  @Post("doses/:doseId/taken")
  @UseGuards(JwtRolesGuard)
  async markTaken(@Param("doseId") doseId: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ user_id: string }>(
      "SELECT user_id FROM medication_doses WHERE id = $1", [doseId],
    );
    const dose = existing.rows[0];
    if (!dose) throw new NotFoundException("Dose not found.");
    if (dose.user_id !== req.user!.sub) throw new ForbiddenException("Cannot manage another patient's doses.");

    await database().query("UPDATE medication_doses SET taken = true, taken_at = NOW() WHERE id = $1", [doseId]);
    return { id: doseId, taken: true };
  }

  @Get("adherence")
  @UseGuards(JwtRolesGuard)
  async adherence(@Query("days") daysRaw: string | undefined, @Req() req: AuthenticatedRequest) {
    const days = daysRaw ? Number(daysRaw) : 14;
    const { rows } = await database().query<{ scheduled_date: string; total: string; taken: string }>(
      `SELECT scheduled_date, COUNT(*) AS total, COUNT(*) FILTER (WHERE taken) AS taken
       FROM medication_doses
       WHERE user_id = $1 AND scheduled_date >= (CURRENT_DATE - $2::int)
       GROUP BY scheduled_date ORDER BY scheduled_date`,
      [req.user!.sub, days],
    );
    return rows.map((row) => ({
      date: row.scheduled_date,
      total: Number(row.total),
      taken: Number(row.taken),
      percent: Math.round((Number(row.taken) / Number(row.total)) * 100),
    }));
  }
}
