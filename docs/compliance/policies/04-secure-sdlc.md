# POL-04 Secure Software Development Life Cycle (Secure SDLC)

| Field | Value |
| --- | --- |
| Policy ID | POL-04 |
| Version | 0.1 readiness draft |
| Owner | Engineering Lead |
| Approver | Managing Director |
| Review cadence | Annual, and after a material architecture or threat change |
| Scope | Requirements, design, implementation, testing, release and maintenance of the FSM Platform |
| Related ISO Annex A | 5.8, 8.25–8.29, 8.31, 8.33 |
| Related SOC 2 | CC8.1, PI1.2, PI1.3, CC6.6 |
| Evidence | PR checklist, threat model, tests, CI results, scan results, release notes |

## 1. Purpose

Build security into the product life cycle so that authentication, authorization,
input handling, data protection, logging and dependency risk are considered
before code reaches production.

## 2. Scope

- Application code, APIs, background workers, PDF/OCR pipeline and database
  schema.
- Customer portal and PWA/offline behaviour.
- Integrations (SMTP, SMS, SSO, SCIM, maps, webhooks).
- Infrastructure-as-code and deployment configuration in this repository.
- Contractors who write production code. Outsourced development is currently
  not in scope (ISO 8.30 is N/A); if that changes, this policy must be updated.

## 3. Security requirements

Each feature or change must consider:

1. **Authentication and authorization.** Who can call it? Is the role and
   department check server-side? Is `isActive` checked? Is customer-portal
   isolation preserved?
2. **Input and output handling.** Validate and normalise on the server; encode
   output; sanitise Markdown/HTML; limit upload size and type; never trust
   client-side checks.
3. **Data protection.** Collect the minimum; classify the data; avoid logging
   secrets or personal data; use TLS and approved storage.
4. **File handling.** PDFs are sanitised with qpdf before inline display; file
   paths are checked; uploads are streamed and quota-limited.
5. **API security.** Bearer keys are hashed, scoped, expiring and read-only where
   possible; rate limits apply; errors do not leak internals.
6. **Auditability.** Security-relevant actions write an audit row with actor,
   action, target and metadata that contains no secrets.
7. **Failure behaviour.** Fail closed for authentication, authorization,
   encryption and backup requirements; show a safe error.
8. **Privacy.** New personal data requires a purpose, lawful basis, retention and
   deletion path. Consult the Privacy Officer.
9. **Dependencies.** Prefer maintained packages; pin versions; review licences
   and advisories.

## 4. Design and threat modelling

- For changes touching authentication, authorization, file upload, PDF
  processing, payment/billing, personal data, backups or external integrations,
  the author records a short threat note in the PR: assets, trust boundaries,
  threats, mitigations and residual risk.
- A full threat model is required for a new externally exposed service,
  authentication flow, data export or supplier integration.
- Architecture decisions are recorded in [docs/DECISIONS.md](../../../docs/DECISIONS.md).
- The Security Lead reviews high-risk designs before implementation.

## 5. Implementation and code review

1. TypeScript is used with type checking; `any` is discouraged.
2. Server actions and API routes authorize the caller and check active status.
3. Secrets come from environment/secret store, never source code.
4. Logging uses the structured logger and redacts secrets and personal data.
5. Error messages do not expose stack traces, SQL or internal paths to users.
6. At least one independent reviewer approves every production change.
7. Reviewers check the PR security checklist:
   - authorization and tenant isolation;
   - input validation and output encoding;
   - secrets and logs;
   - migration safety and rollback;
   - tests for the security-relevant path;
   - privacy/retention impact.

## 6. Testing and verification

| Test | When | Evidence |
| --- | --- | --- |
| Unit tests | Every change | CI result |
| Integration tests | Database/API changes | CI result |
| End-to-end tests | User-facing flows | Playwright result |
| Type check and lint | Every change | CI result |
| Accessibility check | UI changes | Lighthouse/axe result |
| Dependency audit | Every CI run and weekly Dependabot | npm audit output |
| Container scan | Every image build | Trivy result |
| Migration consistency | Every schema change | Prisma diff |
| Restore test | Weekly/quarterly | Restore-test log |
| Penetration test | Before major customer launch and annually thereafter | External report (gap G-04) |

Security tests must cover negative cases: unauthorized role, other department,
other customer, inactive user, expired API key, oversized upload and malformed
PDF.

## 7. Test data

- Production customer data must not be copied to development, test or CI.
- Use synthetic seed data (`scripts/seed-e2e.mjs`) and fictional accounts.
- If realistic data is essential, use anonymisation approved by the Privacy
  Officer and record the decision.
- Test artefacts are ephemeral and must not be committed.

## 8. Release and maintenance

- Follow [POL-03](03-change-management.md) for approval, deployment and rollback.
- Security fixes are prioritised under [POL-05](05-vulnerability-management.md).
- Release notes identify security-relevant changes and required configuration.
- Deprecated dependencies and unsupported runtime versions are tracked and
  upgraded.
- The organisation should publish an SBOM and sign images before a Type II
  observation period (gap G-15).

## 9. Roles and responsibilities

| Role | Responsibility |
| --- | --- |
| Engineering Lead | Owns the SDLC, review quality and test strategy. |
| Platform Lead | Owns architecture, threat model and security requirements. |
| Developers | Implement securely, write tests, disclose risks, respond to review. |
| Security Lead | Reviews high-risk designs, scans and vulnerability trends. |
| Privacy Officer | Reviews personal-data changes and retention. |

## 10. Evidence

- Approved PRs with reviewer and CI result.
- Threat notes and threat models.
- Test and coverage results.
- Scan reports and remediation tickets.
- Release notes and deployment records.
- Exception/risk acceptances for deferred security work.

## 11. Related documents

- [Change management](03-change-management.md)
- [Vulnerability management](05-vulnerability-management.md)
- [Information security policy](01-information-security-policy.md)
- [SECURITY.md](../../../SECURITY.md)
- [CONTRIBUTING.md](../../../CONTRIBUTING.md)
