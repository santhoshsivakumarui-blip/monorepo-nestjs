/** Versioned domain events shared by producers and consumers. */
export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  correlationId: string;
  payload: TPayload;
}

export interface UserCreatedPayload { userId: string; email: string; }
export interface OrderCreatedPayload { orderId: string; userId: string; total: number; }

export const Topics = {
  userCreated: 'users.user-created.v1',
  orderCreated: 'orders.order-created.v1',
  orderDeadLetter: 'orders.dead-letter.v1',
} as const;
