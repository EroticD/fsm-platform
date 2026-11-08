# ISO/IEC 27001:2022 and SOC 2 Readiness Package

**Status:** readiness draft, not certified and not audited.
**Version:** 0.9.1 (2026-11-08); package revision 0.1.
**Baseline:** `master`/`dev` @ `v0.9.1`, 2026-11-08.
**Product:** FSM Platform (`fsm-platform`).
**Owner:** Platform Lead (document owner), with the role owners listed below.

> **Read this first.** This package describes how the FSM Platform is intended
> to be governed, operated and evidenced. It is not a certificate, an audit
> report, a legal opinion or a guarantee of compliance. ISO/IEC 27001
> certification requires an accredited certification body. A SOC 2 report
> requires an independent CPA firm and an examination over a defined period.
> Code, policies and an evidence pack alone cannot certify anything. See
> [GAP-ANALYSIS.md](GAP-ANALYSIS.md) for the remaining work.

## 1. Purpose

This package exists to:

1. define the information security management system (ISMS) scope and the
   control baseline for the FSM Platform;
2. provide an ISO/IEC 27001:2022 Statement of Applicability (SoA) covering all
   93 Annex A controls;
3. map the AICPA Trust Services Criteria (TSC) for SOC 2 to implemented
   controls and evidence;
4. give the organisation a practical risk, asset, retention and supplier
   baseline suitable for a small, self-hosted FSM vendor;
5. automate the repeatable collection of repository, CI and operational
   evidence without cloud credentials and without exposing secrets;
6. state the gaps honestly and sequence the work needed before an audit.

## 2. Scope

### 2.1 In scope

- The FSM Platform application in this repository: Next.js application,
  PostgreSQL schema, background workers, PDF/OCR pipeline, REST API, customer
  portal, PWA/offline field app and administrative functions.
- The production deployment model described in
  [docs/OPERATIONS.md](../OPERATIONS.md), [docs/AZURE.md](../AZURE.md) and
  [deploy/azure/README.md](../../deploy/azure/README.md): one application VM or
  container host, Caddy/TLS reverse proxy, PostgreSQL (local container or Azure
  Database for PostgreSQL Flexible Server), an uploads volume and encrypted
  off-site backups.
- Source code, CI/CD, container images, build dependencies and release
  artefacts on GitHub/GHCR.
- Customer data processed through the platform, including tenant/customer
  records, contacts, sites, jobs, service reports, signatures, photos,
  attachments, portal users, audit logs and backups.
- Workforce, contractors and suppliers who can access the production service,
  source code or customer data.
- Supporting services: SMTP, SMS, map/tile providers, SSO identity providers,
  DNS, TLS, monitoring and off-site backup storage.

### 2.2 Out of scope or inherited

- Physical data-centre security for cloud-hosted production. This is inherited
  from Microsoft Azure and must be evidenced by Azure attestations and the
  contractual shared-responsibility model. The organisation remains responsible
  for its own configuration, identities, keys and endpoints.
- Customer-operated self-hosted installations. The customer is the operator of
  those environments. The vendor supplies code, documentation and security
  updates; it does not control the customer's network, database, backups or
  staff.
- The native mobile application lives in the separate `fsm-mobile` repository
  and is not part of this worktree. It must be added to the ISMS scope or
  explicitly excluded before an audit.
- Payroll, accounting and HR systems other than the evidence records referenced
  here.
- Legal advice. Retention periods and lawful bases must be confirmed by counsel
  and the privacy officer.

### 2.3 Boundary statement

The certification boundary is the organisation's management system and the
production service it operates, not every customer deployment. Where the
organisation provides only software to a self-hosting customer, the relevant
SOC 2 subservice organisation is the cloud provider, not the customer. The
boundary must be written into the audit engagement letter.

## 3. Assumptions

These assumptions are part of the readiness baseline. Correct them before an
audit; an incorrect assumption invalidates the related control statement.

| ID | Assumption | Consequence if wrong |
| --- | --- | --- |
| A1 | The legal entity, registered address and jurisdiction will be filled in before approval. | Policies have no valid approver or governing law. |
| A2 | The organisation is a small vendor (fewer than 25 staff) with at least two people able to approve changes and perform destructive operations. | Segregation-of-duties compensating controls may be impossible. |
| A3 | Production is hosted in the EU/EEA (Azure West Europe/Norway East or an equivalent EU region), with data residency documented per customer. | GDPR transfer analysis and supplier terms change. |
| A4 | The primary customer base and data subjects are in Norway/EU/EEA. | Retention, privacy notices and transfer mechanisms change. |
| A5 | The platform is offered as managed hosting and/or self-hosted software. The managed service is the audit subject; self-hosted customers are responsible for their own operations. | Scope and evidence boundary change. |
| A6 | The organisation does not operate a 24/7 security operations centre. Monitoring is business-hours with automated alerting and on-call best effort. | Incident response and availability commitments may be overstated. |
| A7 | Azure is used for cloud hosting, PostgreSQL, Key Vault and backup storage where the managed option is chosen; a single-VM Docker Compose deployment is also supported. | Physical, availability and supplier evidence must be re-based. |
| A8 | Source code, CI and container images are hosted on GitHub/GHCR. | Change, access and evidence collection must be re-based. |
| A9 | The default audit-log retention is 365 days and is configurable in the application; backup retention is 30 days locally by default and longer off-site. | Records-retention and legal-hold statements are wrong. |
| A10 | No production customer data is used in development, test or CI. Test data is synthetic. | Test-information controls and data-protection risk change. |
| A11 | The organisation will appoint a Privacy Officer/DPO contact and a Security Lead before audit. One person may hold both roles temporarily. | Accountability and review independence are not evidenced. |
| A12 | The SOC 2 examination will use the Security category as mandatory, with Availability, Confidentiality, Processing Integrity and Privacy included only where the customer commitments require them. | The report scope and evidence set change. |

## 4. Certification versus readiness

| Term | Meaning | What this package provides |
| --- | --- | --- |
| **Readiness** | The organisation has documented scope, controls, owners, evidence sources and a remediation plan, and can demonstrate design. | This package, the SoA, the TSC mapping, the risk/asset registers and the evidence collector. |
| **ISO/IEC 27001 certification** | An accredited certification body has audited the ISMS against ISO/IEC 27001:2022 and issued a certificate with a scope and validity period. | Nothing. The package is input to Stage 1 and Stage 2, not a certificate. |
| **SOC 2 Type I** | A CPA firm reports on the fairness of the description of controls and their suitability of design at a point in time. | Design evidence and a control description can support a Type I, but the CPA firm must perform the examination. |
| **SOC 2 Type II** | A CPA firm reports on design and operating effectiveness over an observation period (typically 3–12 months). | The evidence checklist and collector support the period, but operating evidence must be produced and retained over time. |
| **Continuous compliance** | Controls operate, evidence is collected, exceptions are remediated and management reviews the system. | The cadence and templates, not an achieved state. |

### 4.1 Explicit disclaimer

**No statement in this repository is a certification, attestation, audit
opinion or legal conclusion.** An accredited ISO/IEC 27001 certification body
and an independent CPA firm are required. Any customer-facing statement must be
approved by the legal owner and must not describe the service as "ISO 27001
certified" or "SOC 2 compliant" until the relevant report or certificate is
issued and its scope matches the customer's use.

## 5. Roles and owners

Small organisations combine roles. Where one person holds conflicting roles,
record the compensating control (for example, a second reviewer for production
changes and destructive restores) in the risk register.

| Role | Accountability in this package | Default assignee |
| --- | --- | --- |
| Managing Director / CEO | Approves the ISMS, risk appetite, policies and management review; owns legal and contractual commitments. | `[Name]` |
| Security Lead / CISO (fractional allowed) | Owns the ISMS, SoA, risk register, internal audit programme and security exceptions. | `[Name]` |
| Platform Lead / CTO | Owns architecture, secure SDLC, change management, vulnerability management and technical evidence. | `[Name]` |
| Operations Lead / SRE | Owns hosting, access operations, backups, restore tests, monitoring, incident response and business continuity. | `[Name]` |
| Engineering Lead | Owns code review, testing, dependency hygiene and release quality. | `[Name]` |
| Privacy Officer / DPO contact | Owns GDPR records, data subject rights, DPAs, retention decisions and privacy notices. | `[Name]` |
| People/HR Lead | Owns screening, contracts, confidentiality agreements, onboarding, training and offboarding evidence. | `[Name]` |
| Finance/Admin Lead | Owns supplier contracts, invoices, insurance and business continuity funding. | `[Name]` |
| Internal Auditor (independent) | Performs the internal audit and reports to top management; may be external. | `[Name / firm]` |

Role assignments, deputies and out-of-hours contacts must be recorded in the
access-review evidence and reviewed at least annually.

## 6. Document map

| Document | Purpose |
| --- | --- |
| [ISO27001-SOA.md](ISO27001-SOA.md) | Statement of Applicability for all 93 Annex A controls, with applicability, justification, status, evidence and owner. |
| [SOC2-TSC-MAPPING.md](SOC2-TSC-MAPPING.md) | Trust Services Criteria mapping, scoped categories and evidence expectations. |
| [RISK-REGISTER.md](RISK-REGISTER.md) | Risk methodology, template and initial platform risk assessment. |
| [ASSET-REGISTER.md](ASSET-REGISTER.md) | Asset/information inventory, owners, location, classification and controls. |
| [DATA-CLASSIFICATION-RETENTION.md](DATA-CLASSIFICATION-RETENTION.md) | Classification, handling, retention and disposal matrix; pointers to the existing audit-retention and erasure runbooks. |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) | Prioritised gaps, effort, owners, dependencies and roadmap. |
| [EVIDENCE-CHECKLIST.md](EVIDENCE-CHECKLIST.md) | SOC 2 Type I/II evidence checklist over an observation period. |
| [policies/README.md](policies/README.md) | Policy index with owners, review cadence and evidence sources. |
| [templates/](templates/) | Access review, incident, supplier, training, restore-test, internal-audit and management-review templates. |
| [../../scripts/compliance/README.md](../../scripts/compliance/README.md) | Evidence collector and documentation-link checker. |

## 7. Control coverage summary

The SoA contains **93 of 93** ISO/IEC 27001:2022 Annex A controls. The SOC 2
mapping contains **51 of 51** criteria in the scoped 2017 Trust Services
Criteria set (33 common criteria plus A1, C1, PI1 and P1).

Status counts are maintained in [ISO27001-SOA.md](ISO27001-SOA.md) and
[SOC2-TSC-MAPPING.md](SOC2-TSC-MAPPING.md). The short version:

| Dimension | Count | Meaning |
| --- | --- | --- |
| ISO Annex A controls covered | 93 | Every control has an applicability decision. |
| Implemented (design + repository/document evidence) | 29 | Code, configuration, tests, runbooks or automation exists; operating effectiveness is not independently tested. |
| Partial | 50 | Some design/evidence exists; a record, cadence or supplier term is missing. |
| Planned | 11 | Applicable but not yet designed or operated. |
| Not applicable (N/A) | 3 | Justified in the SoA; revisit on a scope change. |
| Evidence basis: repository | 43 | Code, tests, CI, configuration, runbooks or automation. |
| Evidence basis: policy only | 25 | Policy/procedure exists, but no operating record. |
| Evidence basis: inherited | 11 | Cloud/provider control; attestation still required. |
| Evidence basis: none | 14 | No adequate design or evidence yet. |
| SOC 2 criteria covered | 51 | 33 common criteria plus A1, C1, PI1 and P1. |
| SOC 2 designed | 12 | Design documented and mapped. |
| SOC 2 partial | 35 | Design exists but an operating record, SLA or supplier term is missing. |
| SOC 2 gap | 4 | Not adequately addressed; remediation required. |

**Evidence-backed versus policy-only.** "Evidence-backed" in this package means
a repository artefact exists (code, test, CI workflow, configuration, runbook,
automation or dated record). It does **not** mean an independent auditor has
tested operating effectiveness. "Policy-only" means the control is described
but the organisation has not yet retained proof that it operated. The SoA has a
`Basis` column (`Repo`, `Policy`, `Inherited`, `None`) so the distinction is
visible control by control.

## 8. Timeline

The timeline is a planning estimate, not a commitment. Effort assumes one
part-time security lead, one platform engineer and part-time privacy/HR support.

| Phase | Weeks | Outcome | Exit criteria |
| --- | --- | --- | --- |
| 0. Baseline and scope | 1–2 | Scope, roles, asset and data inventory, risk register v0.1. | Management approves scope and risk appetite. |
| 1. Policy and control design | 2–6 | Policies approved; SoA v1; TSC mapping; supplier and retention decisions. | Policy owners sign; gaps have owners and dates. |
| 2. Operate and evidence | 4–12 | Access reviews, vulnerability SLAs, restore tests, incident exercises, training, supplier DPAs. | Two consecutive months of evidence for key controls. |
| 3. Internal audit and management review | 8–14 | Independent internal audit; corrective actions; management review minutes. | No open critical findings; actions tracked. |
| 4. ISO Stage 1 / Stage 2 | 12–20 | Certification audit by an accredited body. | Stage 1 readiness confirmed; Stage 2 findings closed. |
| 5. SOC 2 Type I | 8–16 | CPA Type I report at a point in time. | Control description agreed; design evidence complete. |
| 6. SOC 2 Type II | 16–32 | CPA Type II report over a 3–12 month observation period. | Operating evidence sampled and exceptions explained. |

ISO and SOC 2 can run in parallel, but do not promise a date to a customer until
the auditor or CPA firm has confirmed scope and readiness.

## 9. Review and maintenance

| Activity | Cadence | Owner | Evidence |
| --- | --- | --- | --- |
| Policy review | Annual, or after a material change/incident | Policy owner | Signed review record in the policy header or management review. |
| Risk register review | Quarterly and after material change | Security Lead | Updated register and treatment decisions. |
| Access review | Quarterly; privileged access monthly | Operations Lead | Completed access-review template. |
| Supplier review | Annual and on contract change | Finance/Admin + Security Lead | Supplier register, DPA, attestation. |
| Backup restore test | Weekly automated, quarterly full exercise | Operations Lead | Restore-test log. |
| Vulnerability review | Monthly; critical within SLA | Platform Lead | Scanner output and remediation tickets. |
| Internal audit | Annual | Internal Auditor | Audit plan, report, corrective actions. |
| Management review | Annual, plus mid-year checkpoint | Managing Director | Minutes and actions. |
| Evidence pack | Per release and at least quarterly | Security Lead | Dated pack from `npm run compliance:evidence`. |
| Documentation links | Every change to this package and in CI | Platform Lead | `npm run compliance:links`. |

## 10. How to use this package

1. Replace every `[Name]`, `[Legal entity]` and open decision with an approved
   value. Do not leave placeholders in an audited document.
2. Approve the [information security policy](policies/01-information-security-policy.md)
   and the [risk management policy](policies/16-risk-management.md) first. They
   authorise the rest.
3. Work through [GAP-ANALYSIS.md](GAP-ANALYSIS.md) in priority order. Do not
   describe a planned control as implemented in a customer questionnaire.
4. Run `npm run compliance:links` before committing documentation changes.
5. Run `npm run compliance:evidence` at least quarterly and before an audit.
   The pack is written outside version control by default and marks unavailable
   evidence explicitly.
6. Attach external evidence (contracts, screenshots, IdP exports, auditor
   reports, training records) to the pack. The collector cannot obtain it
   without credentials by design.

## 11. Related existing documentation

The compliance package does not replace the operational runbooks. It relies on
them and points to them rather than duplicating commands.

- [Security policy and secure defaults](../../SECURITY.md)
- [Operations and troubleshooting](../OPERATIONS.md)
- [Backup and restore runbook](../BACKUP-RESTORE.md)
- [Audit log retention and evidence export](../audit-retention.md)
- [Privacy erasure procedure](../privacy-erasure.md)
- [Azure deployment](../AZURE.md)
- [Monitoring and alerting](../../deploy/monitoring/README.md)
- [Systemd backup timers](../../deploy/systemd/README.md)
- [Previous security audit](../security-audit-2026-10-29.md)
- [Contributing and review expectations](../../CONTRIBUTING.md)
