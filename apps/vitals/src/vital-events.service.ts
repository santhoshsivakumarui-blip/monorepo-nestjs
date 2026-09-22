import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

export type VitalIngestedEvent = { tenantId: string; userId: string; metric: string; recordedAt: string };

/** Process-local fan-out for the HTTP service. Deployments should also fan this
 * event out through the existing broker so every replica receives it. */
@Injectable()
export class VitalEventsService {
  private readonly emitter = new EventEmitter();

  publish(event: VitalIngestedEvent) { this.emitter.emit(event.tenantId, event); }
  subscribe(tenantId: string, listener: (event: VitalIngestedEvent) => void) {
    this.emitter.on(tenantId, listener);
    return () => this.emitter.off(tenantId, listener);
  }
}
