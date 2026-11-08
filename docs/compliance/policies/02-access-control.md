# POL-02 Access Control and Access Review

| Field | Value |
| --- | --- |
| Policy ID | POL-02 |
| Version | 0.1 readiness draft |
| Owner | Operations Lead |
| Approver | Managing Director |
| Review cadence | Annual; access review quarterly, privileged access monthly |
| Scope | Application, database, hosting, source code, CI/CD, suppliers and endpoints |
| Related ISO Annex A | 5.15–5.18, 5.3, 8.2–8.5, 8.18 |
| Related SOC 2 | CC6.1–CC6.3, CC6.5, CC6.6 |
| Evidence | Access-review template, IdP export, joiner/mover/leaver records, role matrix, audit log |

## 1. Purpose

Ensure that access to the FSM Platform, production infrastructure, source code
and customer data is authorised, limited to a legitimate need, authenticated,
reviewed and removed promptly.

## 2. Scope

- Application users, portal users, API keys and SCIM-provisioned identities.
- Administrators, developers and operations staff with production access.
- Database roles (`fsm_app`, `fsm_migrator`, maintenance roles), SSH accounts and
  cloud identities.
- GitHub organisation, repository, Actions, GHCR, package registries and secret
  stores.
- Supplier support accounts and any third-party access.

## 3. Authentication

1. **Unique identities.** Shared accounts are prohibited for named people.
   Service accounts are named, owned and documented.
2. **Strong authentication.** Passwords are hashed with bcrypt and never stored
   or logged in clear text. Administrative and office roles should require 2FA;
   production should set `REQUIRE_2FA_ROLES=ADMIN,OFFICE`.
3. **SSO/OIDC.** SSO uses authorization code flow with PKCE, state and nonce.
   Identities are matched on provider and subject, not email alone. Auto-
   provisioning is off by default; new accounts are inactive and least
   privileged.
4. **SCIM.** SCIM tokens are hashed, scoped, expiring and revocable. Admin
   provisioning requires an explicit opt-in.
5. **API keys.** API keys are hashed, scoped, read-only where possible and
   expire (default 90 days, maximum 365). Creation, rotation and revocation are
   audit-logged.
6. **Session security.** Password, 2FA, role or permission changes invalidate
   other sessions through `sessionVersion`. Sessions have a maximum lifetime.
7. **Break-glass.** Local administrator access is retained for IdP/2FA failure.
   The break-glass procedure is documented in
   [SECURITY.md](../../../SECURITY.md) and
   [OPERATIONS.md](../../../docs/OPERATIONS.md). Use requires a second person where
   available and a written record.

## 4. Privileged access

Privileged access includes application `ADMIN`, database DDL/owner roles,
production shell/SSH, cloud subscription owner, Key Vault secret access, CI
secrets, GitHub organisation owner and backup encryption keys.

- Privileged access is granted only after role approval and is reviewed monthly.
- Day-to-day work uses a normal account; privileged roles are not used for
  browsing or email.
- Production database runtime uses a DML-only role. Schema changes use the
  migration role. The application readiness check should fail in production if
  the runtime role can change schema, unless an explicit documented exception
  exists.
- Destructive operations (restore over production, mass deletion, key
  destruction) require two-person approval and a recorded rollback point.
- Break-glass use is logged, reviewed after the event and rotated afterwards.

## 5. Role and permission design

1. Roles are defined by business function, not by person.
2. Permissions follow least privilege and department scoping. Cross-department
   report access is explicit, not a default.
3. Customer-portal users can see only their own customer's data.
4. Custom roles are reviewed when created and at access review.
5. A person with an approval role must not also be the sole implementer of the
   same high-risk change. Where the team is too small, the compensating control
   is a second reviewer, audit log and retrospective review.

## 6. Access reviews

| Review | Frequency | Reviewer | Scope | Evidence |
| --- | --- | --- | --- | --- |
| Application users and roles | Quarterly | Operations Lead | Active users, roles, last login, customer portal users | Signed review export |
| Privileged application/cloud access | Monthly | Security Lead | Admins, DB roles, cloud owners, GitHub owners | Screenshot/export + approval |
| API keys and SCIM tokens | Quarterly | Platform Lead | Owner, scope, expiry, last use | Key inventory |
| Supplier support access | Quarterly / on use | Operations Lead | Named supplier accounts, time-bound access | Ticket/approval |
| GitHub and CI access | Quarterly | Engineering Lead | Org members, teams, deploy keys, Actions secrets | GitHub export |

Reviewers must make an explicit decision for each identity: retain, reduce,
disable or delete. "No change" is a decision only when the reviewer confirms the
role and last activity. The completed review is retained for at least the audit
cycle plus one year.

The template is [templates/ACCESS-REVIEW.md](../templates/ACCESS-REVIEW.md).

## 7. Joiner, mover, leaver

### Joiner

1. Approved request states role, department, systems and duration.
2. Identity is created in the IdP; MFA is enrolled before access.
3. Least-privilege role is assigned; no shared credentials.
4. Policy acknowledgement and training are completed.
5. Access is recorded in the onboarding checklist.

### Mover

1. Manager confirms the new role and removes unnecessary access.
2. Role change invalidates sessions and is audit-logged.
3. Access review covers the change at the next cycle.

### Leaver

1. HR notifies Operations before or on the last working day.
2. Disable the account, revoke sessions, API keys, SCIM tokens and SSH keys.
3. Remove from GitHub, cloud, database, secret stores and supplier portals.
4. Recover laptop, phone, tokens, keys and paper records.
5. Record completion and retain the checklist. Do not delete the audit history
   needed for accountability.

## 8. Remote and third-party access

- Remote administration uses TLS, a trusted network path and named accounts.
- Endpoints must meet [POL-12](12-acceptable-use.md): disk encryption, screen
  lock, patching and no customer data stored locally.
- Supplier access is time-bound, approved, logged and supervised where the
  supplier can access restricted data.
- Supplier accounts are removed at contract end or when the engagement changes.

## 9. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Quarterly access reviews completed | 100% | Access-review record |
| Privileged accounts with MFA | 100% | IdP/application report |
| Leaver access revoked within one business day | 100% | Offboarding checklist |
| Orphaned accounts older than 90 days | 0 | Access review |
| API keys beyond expiry | 0 | Key inventory |
| Break-glass uses reviewed | 100% | Incident/access log |

## 10. Exceptions

Exceptions require a risk ID, compensating control, expiry and Managing Director
approval for High/Critical risk. Shared credentials are not an acceptable
permanent exception for named people.

## 11. Related documents

- [Information security policy](01-information-security-policy.md)
- [Acceptable use](12-acceptable-use.md)
- [Cryptography and key management](13-cryptography-key-management.md)
- [SECURITY.md](../../../SECURITY.md)
- [OPERATIONS.md](../../../docs/OPERATIONS.md)
