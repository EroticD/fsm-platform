# POL-09 Supplier and Subprocessor Management

| Field | Value |
| --- | --- |
| Policy ID | POL-09 |
| Version | 0.1 readiness draft |
| Owner | Finance/Admin Lead |
| Approver | Managing Director |
| Review cadence | Annual, and on contract, subprocessor or service change |
| Scope | Cloud, backup, email, SMS, maps, identity, CI, DNS/TLS and support suppliers |
| Related ISO Annex A | 5.19–5.23, 5.31 |
| Related SOC 2 | CC9.2, CC6.4, P1.6, CC2.3 |
| Evidence | Supplier register, DPA, security schedule, attestation review, subprocessor list |

## 1. Purpose

Ensure that suppliers and subprocessors are selected, contracted, monitored and
offboarded in a way that protects customer data and supports the organisation's
compliance commitments.

## 2. Supplier classification

| Class | Definition | Examples | Due diligence |
| --- | --- | --- | --- |
| **Critical** | Can access or store restricted data, or a failure stops the service. | Azure hosting/database/backup, GitHub/GHCR, off-site backup, identity provider | Full security review, DPA, current attestation, subprocessor list, exit plan |
| **High** | Processes personal data or supports a security-critical function. | SMTP, SMS, monitoring provider, support tool with production access | DPA, security terms, access controls, annual review |
| **Medium** | Limited data or operational dependency. | Map/tile/geocoding provider, domain registrar, analytics | Terms/privacy review, data-flow check |
| **Low** | No personal data or production access. | Office supplies, professional services without data access | Normal contract review |

The register template is
[templates/SUPPLIER-REGISTER.md](../templates/SUPPLIER-REGISTER.md).

## 3. Due diligence before onboarding

1. Define the service, data categories, data subjects, locations and
   subprocessors.
2. Confirm the supplier's security posture: current SOC 2/ISO attestation,
   penetration-test summary, security page, incident history and breach
   notification terms.
3. Confirm data residency and transfer mechanism (EEA/SCCs).
4. Confirm encryption in transit and at rest, access control, logging and
   deletion.
5. Confirm the supplier's own subprocessor list and change notification.
6. Complete a DPA where personal data is processed, including controller/
   processor roles, instructions, confidentiality, security, breach
   notification, audit and deletion.
7. Record the decision and any residual risk in the risk register.
8. Only then grant access or send production data.

## 4. Contract requirements

Critical and High suppliers must have:

- confidentiality and security obligations;
- a DPA or equivalent data-processing terms;
- breach notification without undue delay;
- subprocessor disclosure and approval mechanism;
- audit/assurance rights or acceptance of current attestations;
- data return/deletion on termination;
- liability/insurance appropriate to the risk;
- service levels and support escalation;
- data-residency and transfer terms;
- termination and transition assistance.

A supplier without a signed DPA for personal data is an open gap (G-03). Do not
claim "GDPR compliant supplier" without the signed terms.

## 5. Access management

- Supplier support access is named, time-bound and approved by the Operations
  Lead.
- Supplier accounts require MFA where supported.
- Supplier access is logged and reviewed after use.
- Shared supplier credentials are prohibited.
- Access is removed at contract end or when the engagement changes.

## 6. Review and change management

| Review | Frequency | Owner | Evidence |
| --- | --- | --- | --- |
| Critical supplier attestation | Annual | Security Lead | Report date, scope, exceptions |
| DPA/subprocessor list | Annual and on change | Privacy Officer | Signed DPA, current list |
| Access review | Quarterly | Operations Lead | Supplier access list |
| Performance/incident review | Annual | Finance/Admin Lead | Scorecard, incidents |
| Exit/transition test | On termination | Finance/Admin Lead | Data deletion/return record |

If a supplier changes subprocessors, location or security terms, reassess before
continuing to send data.

## 7. Cloud shared responsibility

For Azure:

- Inherit physical, environmental and hypervisor controls from Microsoft.
- The organisation remains responsible for identity, network configuration,
  database roles, encryption keys, backups, logging, patching of its own images
  and customer data classification.
- Obtain the current Azure SOC 2/ISO attestations and the shared-responsibility
  matrix; record the review.
- Do not treat "Azure is certified" as evidence that the organisation's
  configuration is secure.

## 8. Offboarding

1. Stop sending data and revoke access.
2. Export required data in a usable format.
3. Confirm deletion/return per contract and obtain a certificate where
   available.
4. Remove the supplier from the register or mark it terminated.
5. Update the data-flow map, privacy notice and customer subprocessor list.
6. Retain the contract and deletion evidence per the retention matrix.

## 9. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Critical suppliers with current attestation | 100% | Register |
| Suppliers processing personal data with signed DPA | 100% | Register |
| Supplier access reviews completed | 100% quarterly | Access review |
| Subprocessor list current | 100% | Register |
| Suppliers without an owner | 0 | Register |

## 10. Related documents

- [Privacy and GDPR](11-privacy-gdpr.md)
- [Data retention and disposal](10-data-retention-disposal.md)
- [Information security policy](01-information-security-policy.md)
- [Asset register](../ASSET-REGISTER.md)
- [Azure deployment](../../../docs/AZURE.md)
