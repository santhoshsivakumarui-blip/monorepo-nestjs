# Multi-tenant clinic and hospital platform architecture

## 1. Executive summary

For a nationwide network of clinics and hospitals, the safest and most scalable approach is a multi-tenant SaaS platform with a hybrid database model:

- Shared platform database for core tenant, user, subscription, organization, branch, and billing metadata
- Shared database with tenant and branch scoping for most customers
- Dedicated database per tenant for large enterprise hospitals and regulated environments
- Service packaging for modular feature activation based on the subscribed package

This model balances cost, operational simplicity, data isolation, and growth. It also supports different commercial models such as per-user pricing, branch-based pricing, per-package pricing, and dedicated-instance pricing.

## 2. Business model and tenancy design

The system should be modeled around the business hierarchy:

- Tenant: hospital group or client company
- Organization: hospital, clinic group, or partner entity
- Branch: single clinic, center, or department
- User: doctor, nurse, admin, lab staff, receptionist, patient admin, etc.
- Package: purchased service bundle such as clinic management, EMR, billing, pharmacy, lab, or reporting

The important design principle is that the platform supports a shared foundation and optional feature isolation by tenant and branch.

## 3. Recommended database architecture

### 3.1 Option A: shared database with tenant_id and branch_id

Best for:

- small and medium clinics
- lower infrastructure cost
- faster deployment
- simpler operations

Recommended pattern:

- one PostgreSQL instance
- one shared application database
- all transactional tables include `tenant_id` and `branch_id`
- row-level filtering is enforced in the application layer and service logic
- indexes are created on `tenant_id`, `branch_id`, `organization_id`, and `user_id`

Example tables:

- tenants
- organizations
- branches
- users
- patients
- appointments
- encounters
- prescriptions
- invoices
- payments
- inventory_items
- stock_movements
- audit_logs

Good fit for:

- default SaaS pricing
- shared infrastructure
- standard operational model

Risk:

- noisy data in a large shared database
- harder isolation if one customer grows very large

### 3.2 Option B: shared database with tenant-specific schemas

Best for:

- stronger logical isolation without full dedicated database cost

Recommended pattern:

- single PostgreSQL instance
- separate schemas such as `tenant_a`, `tenant_b`, `tenant_c`
- schema-per-tenant migration strategy
- analytics and reporting remain centralized or projected into a reporting warehouse

This is a good compromise when a tenant needs more separation but does not require a fully isolated database.

### 3.3 Option C: dedicated database per tenant

Best for:

- large hospitals
- enterprise accounts
- strict compliance or strong data residency needs
- high-volume or business-critical workloads

Recommended pattern:

- one PostgreSQL database per tenant
- separate connection pool and service configuration
- dedicated backup and restore schedule
- tenant-specific migration lifecycle and environment settings

This is the correct premium model for enterprise or dedicated hosting customers.

## 4. Recommended platform approach

For a platform serving clinics and hospitals across a country, the most practical hybrid model is:

- Shared platform database for core SaaS metadata
- Shared database with tenant and branch scoping for most customers
- Dedicated database for enterprise customers
- Dedicated schemas for intermediate isolation requirements

This offers a balanced combination of:

- operational simplicity
- cost efficiency
- tenant isolation
- upgrade safety
- commercial flexibility

## 5. Service package design

The system should not be one monolithic hospital app. It should be designed as modular service packages.

### 5.1 Core platform package

Includes:

- authentication and authorization
- tenant management
- organization and branch management
- user roles and permissions
- audit trails and logs
- subscription and billing control
- feature flags and package assignment

### 5.2 Clinic management package

Includes:

- patient registration
- appointments
- visit workflow
- doctor schedules
- queue management
- branch operation dashboard

### 5.3 EMR / clinical records package

Includes:

- clinical notes
- diagnosis codes
- treatment records
- prescriptions
- documents and attachments
- referral management

### 5.4 Billing and claims package

Includes:

- invoice generation
- payment tracking
- insurance claims
- receivables management
- package pricing logic

### 5.5 Pharmacy package

Includes:

- stock management
- medicine inventory
- prescription fulfillment
- sales and returns
- expiry tracking

### 5.6 Lab and diagnostics package

Includes:

- test requests
- sample tracking
- result entry
- lab workflow
- reporting

### 5.7 Inventory package

Includes:

- stock transfer
- purchase order management
- stores and warehouses
- product movement tracking

### 5.8 Reporting and analytics package

Includes:

- dashboards
- operational KPIs
- revenue reporting
- patient flow analytics
- branch comparisons

## 6. Commercial pricing model

### 6.1 Shared database / per-user pricing

Use for:

- SMB healthcare groups
- clinics sharing infrastructure
- multi-tenant SaaS rollout

Example commercial structure:

- Core platform: included or small base fee
- Per active user: monthly fee
- Module add-ons: per package or per branch

Typical pricing examples:

- Clinical staff: per active user
- Doctors: per doctor seat
- Admin staff: bundled package
- Branch addons: monthly branch fee

### 6.2 Shared database / per-branch pricing

Use for:

- lower user count but multiple branch operations

Example:

- base platform fee
- per branch monthly fee
- module addon fee

### 6.3 Dedicated database pricing

Use for:

- enterprise hospitals
- regulated groups
- high-volume operations
- custom compliance requirements

Example:

- dedicated environment fee
- premium support fee
- per-user seat fee
- custom SLAs

## 7. Recommended tenant architecture

Use the following hierarchy in the system:

- Super admin
- Tenant admin
- Organization admin
- Branch admin
- Doctor
- Nurse
- Receptionist
- Pharmacist
- Lab technician
- Patient

Permissions should be enforced by:

- tenant scope
- branch scope
- role-based access control
- package feature access
- user-specific permission policy

## 8. Recommended module breakdown for this repo

The repo is already organized around a modular monorepo pattern. For this healthcare platform, the app structure should evolve to include services like:

- apps/api-gateway
- apps/auth
- apps/tenants
- apps/branches
- apps/users
- apps/patients
- apps/appointments
- apps/records
- apps/billing
- apps/pharmacy
- apps/lab
- apps/inventory
- apps/reporting

Shared logic belongs in:

- libs/common
- libs/contracts
- libs/auth
- libs/tenancy
- libs/audit
- libs/feature-flags

## 9. Data isolation approach

The platform should always enforce tenant boundaries. At minimum:

- all tenant data is tagged with `tenant_id`
- branch data is tagged with `branch_id`
- access checks validate both the tenant and branch context
- patient records and billing data are never shared across tenants
- background jobs and reports must filter by tenant scope

For enterprise customers, dedicated DBs should be used instead of shared tenant scoping.

## 10. Operational and compliance considerations

For a multi-branch hospital platform, you should also design for:

- audit logs for every sensitive change
- role-based access controls
- data retention policy
- patient consent records
- backup and restore exercises
- disaster recovery validation
- branch-level data sovereignty if required
- secure secrets and TLS for production deployment

## 11. Recommended final architecture

For your use case, the strongest model is:

1. Shared platform foundation for tenant and user management
2. Shared database + tenant_id model for standard customers
3. Package-based feature activation
4. Dedicated database for enterprise hospitals
5. Per-user or per-branch pricing for SMB and mid-market customers
6. Fixed enterprise fee for dedicated deployment customers

This is the cleanest and commercially scalable approach for a clinic and hospital network spread across the country.

## 12. Conclusion

The best overall architecture is a multi-tenant healthcare SaaS platform with hybrid database deployment:

- shared DB for most clients
- schema or tenant-level isolation for medium clients
- dedicated DB for enterprise hospitals
- modular service packages sold independently
- pricing based on users, branches, or dedicated hosting

This structure is operationally manageable, commercially flexible, and well-suited for the healthcare domain.
