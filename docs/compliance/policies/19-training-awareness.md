# POL-19 Security Awareness and Training

| Field | Value |
| --- | --- |
| Policy ID | POL-19 |
| Version | 0.1 readiness draft |
| Owner | People/HR Lead |
| Approver | Managing Director |
| Review cadence | Annual, and when the threat or role changes |
| Scope | Employees, contractors, interns, temporary workers and relevant suppliers |
| Related ISO Annex A | 6.1, 6.3 |
| Related SOC 2 | CC1.4, CC2.2 |
| Evidence | Training register, completion records, phishing exercise, onboarding checklist |

## 1. Purpose

Ensure everyone who can access the FSM Platform, source code or customer data
understands their security and privacy responsibilities and can recognise and
report incidents.

## 2. Required training

| Audience | Training | Frequency | Evidence |
| --- | --- | --- | --- |
| All workers | Information security essentials, acceptable use, incident reporting, privacy basics | Onboarding + annual | Completion record + acknowledgement |
| Developers | Secure coding, OWASP Top 10, secrets, dependency risk, secure review | Onboarding + annual | Completion + code-review checklist |
| Operations/administrators | Access control, backup/restore, incident response, key management, cloud hardening | Onboarding + annual | Completion + exercise participation |
| Support/customer-facing | Privacy, DSR handling, social engineering, data minimisation | Onboarding + annual | Completion + scenario |
| Managers | Risk, disciplinary process, incident escalation, review duties | Onboarding + annual | Completion |
| Contractors/suppliers with access | Organisation policy, confidentiality, incident reporting, access rules | Before access + annual | Signed acknowledgement |

## 3. Onboarding

Before access to restricted data:

1. Sign the confidentiality/acceptable-use acknowledgement.
2. Complete security and privacy awareness.
3. Read the incident reporting procedure.
4. Receive the access control and endpoint rules.
5. Confirm device encryption and MFA.
6. Record completion in the training register.

Access is not granted solely because training is "assigned"; it must be
completed or an approved exception recorded.

## 4. Annual and role-specific training

- Annual refresher for all workers.
- Role-specific deep dives for engineering, operations and support.
- Update content after a material incident, audit finding, new supplier or
  regulatory change.
- Include real examples from the organisation (redacted) where useful.
- Track completion by person and role; chase overdue training.

## 5. Phishing and social engineering

At least annually, run a safe simulation or awareness exercise (or tabletop for a
small team). Do not shame individuals. Record:

- scenario and date;
- participation;
- click/report rate (aggregate, not public shaming);
- lessons and changes;
- follow-up training.

A simulation must not use real customer data or a real credential-harvesting
site without approval.

## 6. Effectiveness

Measure more than completion:

- quiz/scenario results;
- incident reporting behaviour;
- phishing report rate;
- access-review and policy exceptions;
- repeat findings;
- feedback from audits.

If a role repeatedly fails a control, provide targeted coaching or change the
process; do not only re-assign the same module.

## 7. Records

The training register records:

| Field | Content |
| --- | --- |
| Person/role | Name or staff ID, role, department |
| Training | Module/version |
| Date assigned/completed | Date |
| Result | Pass/attendance/scenario |
| Acknowledgement | Signed policy acknowledgement |
| Exceptions | Reason, approver, expiry |
| Next due | Annual date |

Retain records for employment + 3 years (confirm with HR/legal). Do not put
sensitive personal data in the evidence pack; use aggregate completion and
redacted extracts.

## 8. Roles

| Role | Responsibility |
| --- | --- |
| People/HR Lead | Owns the register, onboarding/offboarding, completion chase. |
| Security Lead | Defines content, delivers technical training, reviews effectiveness. |
| Managers | Ensure their people complete training and apply it. |
| All workers | Complete training, acknowledge policies, report incidents. |

## 9. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Onboarding training before access | 100% | Onboarding checklist |
| Annual training completion | 100% | Training register |
| Policy acknowledgement | 100% | Register |
| Phishing exercise completed | Annual | Exercise report |
| Overdue training | 0 or approved exception | Register |

## 10. Related documents

- [Information security policy](01-information-security-policy.md)
- [Acceptable use](12-acceptable-use.md)
- [Incident response](06-incident-response.md)
- [Privacy and GDPR](11-privacy-gdpr.md)
- [Training register template](../templates/TRAINING-REGISTER.md)
