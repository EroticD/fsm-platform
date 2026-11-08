# SOC 2 Evidence Checklist (Type I and Type II)

**Organisation:** `[Legal entity]`
**Service:** FSM Platform managed service.
**Owner:** Security Lead.
**Version:** 0.1 readiness draft, 2026-11-08.
**Auditor:** `[CPA firm]` — not engaged at the time of this draft.

> This checklist supports an examination. It does not replace the CPA firm's
> requests or opinion. A Type I report covers design at a point in time; a Type II
> report covers design and operating effectiveness over an observation period.

## 1. Evidence principles

Every piece of evidence must be:

| Quality | Requirement |
| --- | --- |
| **Relevant** | It tests the stated control and period, not a different control. |
| **Attributable** | It shows who produced/approved it and when. |
| **Complete** | It covers the full population or a documented sample. |
| **Integrity-protected** | Hash, immutable storage, ticket ID or system export. |
| **Retained** | Kept for the audit period plus the required retention. |
| **Redacted** | No secrets, credentials or unnecessary personal data. |
| **Reproducible** | The collector or procedure can produce it again. |

A screenshot without a date, system and owner is weak evidence. A policy without
an approval and an operating record is design-only.

## 2. Automated evidence pack

Run:

```bash
npm run compliance:evidence
```

The collector writes a dated pack outside version control (default
`compliance-evidence/<timestamp>/`) and includes:

- repository and commit metadata;
- commit/PR policy snapshot and change log;
- dependency audit summary;
- CI workflow and available test/coverage results;
- backup configuration and retention settings;
- audit-retention configuration and code references;
- access-review template;
- secret-scanning status and a path-only heuristic scan;
- policy hashes and copies;
- a manifest with SHA-256 hashes;
- an explicit `unavailable.md` for evidence that needs credentials or external
  systems.

It does **not** require cloud credentials, does not read `.env`, and does not
print secret values. It cannot replace production exports, signed contracts, HR
records or auditor sampling.

`npm run compliance:links` validates local Markdown links and paths in this
package.

## 3. Type I evidence (point in time)

Type I evidence demonstrates that the control is designed and exists at the
description date.

| ID | Evidence | Control / TSC | Owner | Source | Collected by script? |
| --- | --- | --- | --- | --- | --- |
| T1-01 | Approved scope, system description and control narrative | All | Security Lead | Document | No |
| T1-02 | Approved policies and acknowledgements | CC1, CC5 | Security Lead / HR | Policy index, HR | Partial |
| T1-03 | Role matrix, org chart and deputy assignments | CC1.3 | Managing Director | README/HR | Partial |
| T1-04 | Risk register, appetite and treatment plans | CC3, CC5, CC9 | Security Lead | Risk register | Partial |
| T1-05 | Asset/data inventory and data-flow diagram | CC2.1, CC6.1 | Operations/Privacy | Asset register | Partial |
| T1-06 | Access control design: roles, MFA, SSO/SCIM, API keys | CC6.1–CC6.3 | Platform Lead | Code/docs | Partial |
| T1-07 | Privileged access and break-glass design | CC6.1, CC6.3 | Operations Lead | Docs/code | Partial |
| T1-08 | Change management design: PR, CI, migrations, rollback | CC8.1 | Engineering Lead | Docs/CI | Yes |
| T1-09 | SDLC and security requirements | CC8.1, PI1.2 | Engineering Lead | Policy/docs | Partial |
| T1-10 | Vulnerability and patch process | CC7.1, CC6.8 | Platform Lead | Policy/CI | Yes |
| T1-11 | Backup, restore and DR design | A1.2, A1.3 | Operations Lead | Policy/runbook | Yes |
| T1-12 | Monitoring and incident response design | CC7.2–CC7.5 | Operations Lead | Policy/config | Partial |
| T1-13 | Supplier register, DPAs and attestations | CC9.2, P1.6 | Finance/Privacy | Contract files | No |
| T1-14 | Privacy notices, Article 30 record, DSR procedure | P1 | Privacy Officer | Privacy files | No |
| T1-15 | Physical/cloud inheritance and Azure attestation | CC6.4, A1.2 | Operations Lead | Azure portal | No |
| T1-16 | Training and HR onboarding design | CC1.4 | People/HR | HR files | No |
| T1-17 | Internal audit plan and management review design | CC4 | Internal Auditor/MD | Templates | No |
| T1-18 | Branch protection, GitHub org and secret-scanning settings | CC6.1, CC8.1 | Platform Lead | GitHub export | No (requires export) |
| T1-19 | Production configuration snapshot (redacted) | CC5.2, CC6.6 | Operations Lead | Host/cloud export | Partial |
| T1-20 | Current TLS/header/proxy configuration | CC6.6, CC6.7 | Operations Lead | Config/scan | Partial |

## 4. Type II observation period

### 4.1 Before the period starts

- [ ] P0 gaps in [GAP-ANALYSIS.md](GAP-ANALYSIS.md) are closed.
- [ ] CPA firm engaged; scope, categories, period and sampling agreed.
- [ ] System description and control matrix approved.
- [ ] Evidence owners and storage location assigned.
- [ ] Evidence collector scheduled (at least quarterly; monthly for key controls).
- [ ] Access reviews, vulnerability reviews, restore tests and incident log are
      operating.
- [ ] Backup/restore and DR exercise completed.
- [ ] Supplier DPAs and attestations on file.
- [ ] HR/training records current.
- [ ] No known Critical finding without an approved remediation plan.

### 4.2 During the period

| Cadence | Evidence | Owner | Record |
| --- | --- | --- | --- |
| Continuous | Audit log, access logs, alerts, incidents | Operations/Security | System logs |
| Per change | PR review, CI result, approval, deployment digest, rollback | Engineering Lead | PR/CI/deploy record |
| Weekly | Backup status, checksum, freshness, restore test | Operations Lead | Status/restore log |
| Monthly | Privileged access review, vulnerability review, capacity/availability | Operations/Security | Review record |
| Quarterly | All-user access review, supplier access review, risk review, evidence pack, alert tuning | Operations/Security | Signed reviews |
| Quarterly | Full database restore; DR exercise (at least annual) | Operations Lead | Test log/report |
| Annual | Policy review, management review, internal audit, training, DR exercise, supplier attestation, penetration test | Respective owners | Signed records |
| Per incident | Timeline, containment, notification, post-incident review | Incident Lead | Incident register |
| Per DSR | Request, identity check, decision, response, evidence | Privacy Officer | DSR log |
| Per supplier change | Reassessment, DPA/subprocessor update | Finance/Privacy | Supplier register |

### 4.3 Period-end

- [ ] Evidence pack for the full period is complete and indexed.
- [ ] Exceptions and deviations are documented with impact.
- [ ] Management review covers the period.
- [ ] Internal audit findings are closed or tracked.
- [ ] CPA firm receives the population and sample support.
- [ ] Evidence is retained and access-restricted.

## 5. Evidence index

| ID | Evidence | Type | Frequency | Owner | Storage | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| E-01 | Policy approval and version history | Governance | Annual/on change | Security Lead | Git + signed approval | Include approval date |
| E-02 | Policy acknowledgements | Governance | Onboarding + annual | People/HR | HR/training register | Redacted extract |
| E-03 | Risk register and treatment plans | Risk | Quarterly | Security Lead | Restricted register | Include decisions |
| E-04 | Risk acceptance records | Risk | As incurred | Managing Director | Restricted register | Expiry required |
| E-05 | Management review minutes | Governance | Annual + mid-year | Managing Director | Restricted | Actions tracked |
| E-06 | Internal audit plan/report/actions | Assurance | Annual | Internal Auditor | Restricted | Independence evidence |
| E-07 | Asset/data inventory and flows | Operations | Quarterly | Operations/Privacy | Register | Reconcile to live |
| E-08 | Access review (all users) | Access | Quarterly | Operations Lead | Restricted | Signed + export |
| E-09 | Privileged access review | Access | Monthly | Security Lead | Restricted | Include DB/cloud/GitHub |
| E-10 | Joiner/mover/leaver records | Access/HR | Per event | People/HR | HR system | Same-day revocation |
| E-11 | MFA/SSO/SCIM configuration | Access | On change | Platform Lead | Config export | No secrets |
| E-12 | API/SCIM key inventory | Access | Quarterly | Platform Lead | Key inventory | Names/scopes only |
| E-13 | PR and review history | Change | Per change | Engineering Lead | GitHub | Export/sample |
| E-14 | CI run results | Change | Per change | Engineering Lead | GitHub | Link/commit |
| E-15 | Release/deployment records | Change | Per release | Operations Lead | Deploy log | Image digest |
| E-16 | Migration and rollback records | Change | Per change | Engineering Lead | PR/ops log | Include failures |
| E-17 | Emergency change retrospectives | Change | Per event | Security Lead | Incident/change log | Within 5 days |
| E-18 | Dependency audit (npm audit) | Vulnerability | Per CI/monthly | Platform Lead | CI/evidence pack | Dated |
| E-19 | Container scan (Trivy) | Vulnerability | Per build | Platform Lead | CI/registry | Critical/High |
| E-20 | Vulnerability register/reviews | Vulnerability | Monthly | Platform Lead | Register | SLAs/due dates |
| E-21 | Patch/upgrade records | Vulnerability | Per patch | Operations Lead | Change log | Deployed version |
| E-22 | Backup status/checksums | Availability | Daily | Operations Lead | Status files | Freshness |
| E-23 | Restore-test log | Availability | Weekly/quarterly | Operations Lead | Test log | Measured RTO |
| E-24 | DR exercise report | Availability | Annual | Operations Lead | Report | Gaps/actions |
| E-25 | Monitoring/alert configuration | Operations | On change | Operations Lead | Git/config | Alert test |
| E-26 | Alert acknowledgement/incident | Operations | Per event | Operations Lead | Incident log | Response time |
| E-27 | Incident register/post-incident reviews | Incident | Per event | Security Lead | Restricted | Root cause/actions |
| E-28 | Incident exercise report | Incident | Annual | Security Lead | Report | Attendance/gaps |
| E-29 | Supplier register and DPAs | Supplier | Annual/on change | Finance/Privacy | Contract files | Signed |
| E-30 | Azure/GitHub attestations | Supplier | Annual | Security Lead | Evidence store | Scope/date |
| E-31 | Subprocessor list | Supplier/Privacy | On change | Privacy Officer | Register | Customer-facing |
| E-32 | Article 30 record | Privacy | Annual/on change | Privacy Officer | Restricted | Complete |
| E-33 | Privacy notice and consent records | Privacy | On change | Privacy Officer | Published/records | Versioned |
| E-34 | DSR log | Privacy | Per request | Privacy Officer | Restricted | Timeliness |
| E-35 | DPIA records | Privacy | Per high-risk change | Privacy Officer | Restricted | Approval |
| E-36 | Breach assessment/notification | Privacy | Per event | Privacy Officer | Incident file | Decision recorded |
| E-37 | Retention settings and deletion records | Privacy/Records | On change/per event | Privacy Officer | Config/audit log | Legal hold check |
| E-38 | Audit-chain verification | Records | Monthly/quarterly | Operations Lead | Log/export | `audit:verify` |
| E-39 | Audit/evidence export | Records | Per audit/incident | Operations Lead | Immutable storage | Manifest/HMAC |
| E-40 | HR screening/NDA/onboarding | People | Per hire | People/HR | HR file | Redacted |
| E-41 | Training register | People | Onboarding/annual | People/HR | Register | Completion |
| E-42 | Phishing exercise | People | Annual | Security Lead | Report | Aggregate |
| E-43 | Device inventory/encryption/patch | Endpoint | Quarterly | Security Lead | MDM/inventory | Attestation |
| E-44 | Office access/visitor log | Physical | Per event/quarterly | Operations Lead | Log | Reviewed |
| E-45 | Media/endpoint disposal records | Physical | Per event | Operations Lead | Certificate/log | Sanitisation |
| E-46 | Capacity/availability report | Availability | Monthly/quarterly | Operations Lead | Metrics/report | Trend |
| E-47 | Code of conduct/conflict register | Governance | Annual | Managing Director | Restricted | Conflicts |
| E-48 | Customer complaints/questionnaires | Governance | As incurred | Managing Director | Register | Responses approved |

## 6. Evidence that cannot be collected from the repository

The collector marks these unavailable by design. Obtain them from the owning
system and attach them to the pack:

| Evidence | Why unavailable | Source | Owner |
| --- | --- | --- | --- |
| GitHub branch protection and org settings | Requires GitHub admin/API export; no credentials in collector | GitHub settings/API | Platform Lead |
| GitHub secret-scanning alerts and audit log | Requires GitHub admin access | GitHub security settings | Platform Lead |
| GitHub Actions run history | API/retention; not in git | GitHub Actions | Engineering Lead |
| Azure attestations and resource configuration | Requires Azure portal/API access | Azure Service Trust Portal/portal | Operations Lead |
| Production audit-retention runtime value | Requires database access | Application settings/DB | Operations Lead |
| Signed customer contracts, DPAs, subprocessor terms | Contract repository | Finance/Privacy | Finance/Privacy |
| Payroll/HR screening, NDA, onboarding/offboarding | HR system | HR | People/HR |
| Training completion and phishing results | LMS/register | HR/Security | People/HR |
| Access-review completions and IdP exports | IdP/application | IdP/admin | Operations Lead |
| Restore-test results and DR exercise | Ops logs | Backup host | Operations Lead |
| Incident records and post-incident reviews | Incident register | Security | Security Lead |
| Internal audit report and management review minutes | Restricted records | Auditor/MD | Internal Auditor/MD |
| Penetration-test report | External provider | Security | Security Lead |
| SOC 2 Type I/II report | CPA firm | CPA firm | Managing Director |
| ISO certificate | Accreditation body | Certification body | Managing Director |

## 7. Sampling guidance

- Define the population for the period (all changes, all users, all incidents,
  all backups, all DSRs).
- Use a risk-based sample across the full period, not just recent months.
- Record the selection method and sample size.
- For access, include joiners, leavers, privileged users and service accounts.
- For changes, include normal, emergency, database and configuration changes.
- For backups, include successful and failed tests.
- For incidents, include near misses and closed items.
- If a sample fails, expand the sample or record a finding. Do not discard the
  exception.

## 8. Evidence quality review

Before submitting to the auditor:

- [ ] Each evidence item has an ID, date, owner and control link.
- [ ] The population and sample are documented.
- [ ] Redaction is applied; no secrets or unnecessary personal data.
- [ ] Screenshots show system, date and scope.
- [ ] Signed approvals are legible and attributable.
- [ ] Exceptions are explained, not hidden.
- [ ] The evidence pack manifest verifies.
- [ ] The auditor's requests are mapped to evidence IDs.
- [ ] Retention and access restrictions are applied.

## 9. Readiness gate

Do not start a Type II observation period until:

1. P0 gaps are closed and verified.
2. At least two consecutive months of key-control evidence exist.
3. The incident, access, vulnerability and restore processes have operated at
   least once.
4. Internal audit and management review have been performed.
5. The CPA firm has agreed the scope, period and sampling.

## 10. Sign-off

| Role | Name | Date | Confirms |
| --- | --- | --- | --- |
| Security Lead |  |  | Evidence index complete |
| Operations Lead |  |  | Operations evidence accurate |
| Privacy Officer |  |  | Privacy evidence redacted and lawful |
| Managing Director |  |  | Scope and resources approved |
