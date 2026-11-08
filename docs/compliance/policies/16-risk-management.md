# POL-16 Risk Management

| Field | Value |
| --- | --- |
| Policy ID | POL-16 |
| Version | 0.1 readiness draft |
| Owner | Security Lead |
| Approver | Managing Director |
| Review cadence | Annual; risk review quarterly and after material change |
| Scope | Information security, privacy, availability, supplier and compliance risk |
| Related ISO Annex A | 5.1, 6.1 (ISO risk), 5.7, 8.8 |
| Related SOC 2 | CC3.1–CC3.4, CC5.1, CC9.1–CC9.2 |
| Evidence | Risk register, treatment plans, acceptance records, review minutes |

## 1. Purpose

Identify, assess, treat and monitor risks to the confidentiality, integrity and
availability of the FSM Platform and to the organisation's objectives.

## 2. Method

The detailed scoring, appetite and initial assessment are in
[RISK-REGISTER.md](../RISK-REGISTER.md). The method is:

1. **Establish context.** Scope, objectives, interested parties, legal and
   contractual requirements.
2. **Identify risk.** Asset, threat, vulnerability, cause and consequence.
3. **Analyse.** Likelihood 1–5 × impact 1–5; consider existing controls.
4. **Evaluate.** Compare with appetite; decide treatment.
5. **Treat.** Mitigate, transfer, avoid or accept; assign owner, action and due
   date.
6. **Monitor.** Quarterly review, incident triggers, audit findings and changes.
7. **Record.** Risk ID, owner, score, treatment, residual, acceptance and review.

## 3. Roles

| Role | Responsibility |
| --- | --- |
| Managing Director | Approves appetite, Critical/High acceptance and resources. |
| Security Lead | Maintains the register, facilitates assessment, reports trends. |
| Risk owners | Implement treatment, provide evidence, review residual score. |
| Privacy Officer | Owns privacy/legal risks and DPIAs. |
| Operations Lead | Owns hosting, backup, continuity and supplier operational risks. |
| Internal Auditor | Tests whether the process operates; does not own the risks. |

## 4. Risk identification sources

- asset and data inventory;
- incidents, near misses and audit findings;
- vulnerability scans and advisories;
- supplier changes and attestations;
- customer complaints, contracts and questionnaires;
- legal/regulatory changes;
- architecture and change reviews;
- business continuity exercises;
- threat intelligence and industry advisories.

## 5. Treatment rules

- Critical risks require containment and an executive decision within 7 days.
- High risks require a treatment plan within 30 days.
- A treatment must have an owner, action, due date and evidence of completion.
- Residual risk is not "low" merely because a policy exists; it is low when the
  control is operated and evidenced.
- Acceptance must be within appetite and approved by the Managing Director for
  High/Critical risk.
- A risk accepted for more than 12 months is reviewed again; a permanent
  acceptance is a change to the risk appetite.

## 6. Integration with other processes

| Process | Link |
| --- | --- |
| SoA | Controls selected from risk treatment are recorded in the [SoA](../ISO27001-SOA.md). |
| Change management | High-risk changes require a risk note and approval. |
| Incident | Incidents update likelihood/impact and can create new risks. |
| Supplier | Supplier failure and data-processing risks are recorded. |
| Privacy | DPIAs feed the register; high residual risk may require consultation. |
| Internal audit | Audit findings create corrective actions and risk updates. |
| Management review | Reviews the risk profile, treatments and acceptances. |

## 7. Review

The quarterly review considers:

- changes to scope, assets, suppliers, law or architecture;
- new incidents and vulnerabilities;
- treatment progress and overdue actions;
- risks above appetite;
- closed risks and whether the treatment is effective.

The review record states what changed and what was decided. A register with only
date changes is not evidence of operation.

## 8. Evidence

- Current register with owners and scores.
- Treatment plans and completion evidence.
- Acceptance records.
- Quarterly review notes.
- Internal audit and management review references.

## 9. Related documents

- [Risk register](../RISK-REGISTER.md)
- [Information security policy](01-information-security-policy.md)
- [Internal audit](17-internal-audit.md)
- [Management review](18-management-review.md)
- [Supplier management](09-supplier-management.md)
