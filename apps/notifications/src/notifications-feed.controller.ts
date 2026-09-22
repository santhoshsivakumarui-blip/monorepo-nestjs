import {
  Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, UseGuards,
} from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import { JwtRolesGuard } from "../../../libs/common/src/oidc";

interface AuthenticatedRequest { user?: { sub: string }; }

@Controller("notifications")
export class NotificationsFeedController {
  @Get("mine")
  @UseGuards(JwtRolesGuard)
  async mine(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query(
      "SELECT id, category, title, message, read, created_at FROM notifications_feed WHERE recipient = $1 ORDER BY created_at DESC",
      [req.user!.sub],
    );
    return rows;
  }

  @Get("unread-count")
  @UseGuards(JwtRolesGuard)
  async unreadCount(@Req() req: AuthenticatedRequest) {
    const { rows } = await database().query<{ count: string }>(
      "SELECT COUNT(*) FROM notifications_feed WHERE recipient = $1 AND read = false",
      [req.user!.sub],
    );
    return { count: Number(rows[0].count) };
  }

  @Post(":id/read")
  @UseGuards(JwtRolesGuard)
  async markRead(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const existing = await database().query<{ recipient: string }>(
      "SELECT recipient FROM notifications_feed WHERE id = $1", [id],
    );
    const notification = existing.rows[0];
    if (!notification) throw new NotFoundException("Notification not found.");
    if (notification.recipient !== req.user!.sub) throw new ForbiddenException("Cannot manage another recipient's notifications.");

    await database().query("UPDATE notifications_feed SET read = true WHERE id = $1", [id]);
    return { id, read: true };
  }

  @Post("mark-all-read")
  @UseGuards(JwtRolesGuard)
  async markAllRead(@Req() req: AuthenticatedRequest) {
    await database().query("UPDATE notifications_feed SET read = true WHERE recipient = $1 AND read = false", [req.user!.sub]);
    return { accepted: true };
  }
}
