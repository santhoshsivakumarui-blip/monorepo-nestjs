# Product platform modules

The boilerplate reserves these contracts for product teams:

- Feature flags: evaluate by tenant, user, and environment; emit audit events for changes.
- Multi-tenancy: carry `tenantId` in authenticated claims, database rows, events, search documents, cache keys, and audit entries.
- Webhooks: sign each outbound event, retain delivery attempts, retry with exponential backoff, and support replay by event ID.
- File intake: upload to object storage through short-lived signed URLs, scan asynchronously before release, and persist a content hash/audit event.
- Notification preferences: own them in `notifications_db`; all delivery adapters must respect opt-out state.
- Audit trail: append actor, action, target, request ID, correlation ID, tenant ID, and timestamp; never allow mutation of audit events.
