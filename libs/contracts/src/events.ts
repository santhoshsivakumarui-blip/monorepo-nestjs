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
/** In-app notification only — not a delivery channel. */
export interface NotificationRequestedPayload { recipient: string; message: string; category?: string; title?: string; }
export interface EmailRequestedPayload { to: string; subject: string; message: string; }
export interface SmsRequestedPayload { to: string; message: string; }
export interface TenantProvisionedPayload {
  tenantId: string;
  tenantCode: string;
  legalName: string;
  plan: 'starter' | 'growth' | 'enterprise';
  mode: 'pooled' | 'dedicated';
  /** One entry for pooled (the shared pool); one per tenant-scoped service for dedicated. */
  databaseKeys: string[];
  complianceFramework: string;
  regionAffinity: string;
  status: string;
}

export interface DeviceSubscriptionActivatedPayload {
  subscriptionId: string;
  userId: string;
  deviceSku: string;
  billingCycle: 'monthly' | 'annual';
  priceCents: number;
  currency: string;
  status: string;
}
export interface DeviceSubscriptionCancelledPayload { subscriptionId: string; userId: string; }
export interface PatientHospitalLinkedPayload { userId: string; tenantId: string; }
export interface PatientHospitalUnlinkedPayload { userId: string; tenantId: string; }
export interface HospitalRevokeAllLinksRequestedPayload { tenantId: string; }

export const Topics = {
  userCreated: 'users.user-created.v1',
  orderCreated: 'orders.order-created.v1',
  orderDeadLetter: 'orders.dead-letter.v1',
  notificationsRequested: 'notifications.requested.v1',
  emailRequested: 'email.requested.v1',
  smsRequested: 'sms.requested.v1',
  tenantProvisioned: 'tenant.provisioned.v2',
  deviceSubscriptionActivated: 'subscriptions.device-subscription-activated.v1',
  deviceSubscriptionCancelled: 'subscriptions.device-subscription-cancelled.v1',
  patientHospitalLinked: 'users.patient-hospital-linked.v1',
  patientHospitalUnlinked: 'users.patient-hospital-unlinked.v1',
  hospitalRevokeAllLinksRequested: 'admin.hospital-revoke-all-links-requested.v1',
} as const;
