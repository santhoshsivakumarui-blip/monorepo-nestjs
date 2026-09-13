export interface WebhookEvent { id: string; type: string; occurredAt: string; payload: unknown; signature?: string; }
