# POL-01 Information Security Policy

| Field | Value |
| --- | --- |
| Policy ID | POL-01 |
| Version | 0.1 readiness draft |
| Owner | Managing Director |
| Approver | Managing Director |
| Effective date | `[YYYY-MM-DD]` |
| Review cadence | Annual, and after a material change or incident |
| Scope | FSM Platform managed service, workforce, contractors, suppliers and the ISMS |
| Related ISO Annex A | 5.1, 5.2, 5.4, 5.8, 5.31, 5.36, 6.1–6.6 |
| Related SOC 2 | CC1.1–CC1.5, CC2.1–CC2.3, CC5.3 |
| Evidence | Signed approval, acknowledgements, management review minutes, policy index |

## 1. Purpose

This policy establishes the organisation's commitment to protect the
confidentiality, integrity and availability of the FSM Platform, customer data,
source code, credentials and supporting information. It authorises the ISMS, the
risk management process and the supporting policies.

## 2. Scope

It applies to:

- all employees, contractors, interns and temporary workers;
- anyone with access to production, source code, customer data, backups or
  administrative systems;
- suppliers and subprocessors that process or support customer data;
- the managed service and the software supply chain in this repository.

Self-hosted customer installations are outside the organisation's operational
control. The organisation still provides secure software, documentation and
timely security updates for those installations.

## 3. Policy statements

1. **Leadership commitment.** Top management owns the ISMS, approves the risk
   appetite and reviews security performance at least annually.
2. **Risk-based controls.** Controls are selected from the risk assessment and
   recorded in the [Statement of Applicability](../ISO27001-SOA.md). A control is
   not added only because a framework lists it; the justification is recorded.
3. **Compliance.** The organisation complies with applicable law, contracts and
   its own policies. Where a requirement cannot be met, an approved exception
   and compensating control are recorded.
4. **Least privilege.** Access is granted for a defined purpose, reviewed
   quarterly, and removed when no longer needed.
5. **Secure by default.** Production defaults are safe: TLS, encryption,
   authentication, least-privilege database roles, rate limits and backup
   encryption. Overrides require a documented decision.
6. **Evidence.** Controls must be operable and evidenced. A policy statement
   without a record is a gap, not proof.
7. **Reporting.** Anyone who suspects a security or privacy incident must report
   it promptly through the channels in [POL-06](06-incident-response.md). No one
   is penalised for good-faith reporting.
8. **Continuous improvement.** Incidents, audit findings, vulnerabilities and
   supplier changes feed corrective action and management review.

## 4. Roles and responsibilities

| Role | Responsibility |
| --- | --- |
| Managing Director | Approves the ISMS, policies, risk appetite and risk acceptances; provides resources; chairs management review. |
| Security Lead | Operates the ISMS, maintains the SoA/risk register, coordinates audits, incidents and awareness. |
| Platform Lead | Owns architecture, secure development, vulnerability management and technical evidence. |
| Operations Lead | Owns hosting, access operations, backups, restore tests, monitoring and continuity. |
| Privacy Officer | Owns GDPR records, notices, DPAs, data-subject rights and retention decisions. |
| People/HR Lead | Owns screening, contracts, confidentiality agreements, onboarding, training and exit. |
| Engineering Lead | Owns code review, testing, dependency hygiene and release quality. |
| All workers | Follow policy, protect credentials and data, report incidents, complete training, return assets. |

## 5. ISMS framework

The ISMS consists of:

- this policy set and the [policy index](README.md);
- the [scope and assumptions](../README.md#2-scope);
- the [risk register](../RISK-REGISTER.md) and risk treatment plans;
- the [Statement of Applicability](../ISO27001-SOA.md);
- the [asset register](../ASSET-REGISTER.md) and
  [data classification/retention matrix](../DATA-CLASSIFICATION-RETENTION.md);
- the [SOC 2 mapping](../SOC2-TSC-MAPPING.md) and
  [evidence checklist](../EVIDENCE-CHECKLIST.md);
- the operational runbooks ([OPERATIONS.md](../../../docs/OPERATIONS.md),
  [BACKUP-RESTORE.md](../../../docs/BACKUP-RESTORE.md),
  [audit-retention.md](../../../docs/audit-retention.md),
  [privacy-erasure.md](../../../docs/privacy-erasure.md));
- internal audit, management review and corrective action records.

## 6. Legal, contractual and regulatory requirements

The organisation maintains a legal and contractual register covering at least:

- GDPR and Norwegian data-protection law;
- customer contracts, DPAs and security schedules;
- bookkeeping, accounting and service-documentation obligations;
- employment, tax and company law;
- intellectual-property and open-source licence obligations;
- sector-specific customer requirements.

The Privacy Officer and Managing Director review the register annually. This
policy does not create a legal opinion; counsel must confirm retention periods
and transfer mechanisms.

## 7. People security

1. Workers with access to restricted data are screened to the extent permitted
   by law and proportionate to the role.
2. Contracts include confidentiality, acceptable use, security
   responsibilities and the duty to report incidents.
3. Onboarding includes policy acknowledgement, security training, access
   provisioning and asset issue.
4. Offboarding includes same-day access revocation, session invalidation, asset
   return, key return and a confidentiality reminder.
5. Contractors and suppliers are bound by equivalent confidentiality and
   security terms.

## 8. Exceptions and non-compliance

- An exception is requested from the Security Lead, risk-assessed and approved
  by the Managing Director for High/Critical risk.
- Exceptions have an expiry date (maximum 12 months) and a compensating control.
- A suspected policy breach is handled under the disciplinary process and, where
  relevant, the incident response procedure. Do not destroy evidence.
- Repeated or wilful breaches may lead to contract termination or disciplinary
  action, subject to employment law.

## 9. Review and evidence

| Evidence | Source | Frequency |
| --- | --- | --- |
| Approved policy and version history | Git history, signed approval | Annual |
| Worker acknowledgements | HR/training register | Onboarding + annual |
| Risk register and treatment plans | Risk register | Quarterly |
| Management review minutes | Management review template | Annual |
| Internal audit report and actions | Internal audit | Annual |
| Incident and corrective-action records | Incident register | As incurred |

The Security Lead reports the status of this policy to management review. A
review that does not consider incidents, audit findings, risk changes and
training completion is incomplete.

## 10. Related documents

- [Access control](02-access-control.md)
- [Risk management](16-risk-management.md)
- [Incident response](06-incident-response.md)
- [Supplier management](09-supplier-management.md)
- [Privacy and GDPR](11-privacy-gdpr.md)
- [SECURITY.md](../../../SECURITY.md)
