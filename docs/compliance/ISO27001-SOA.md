# Statement of Applicability (SoA) — ISO/IEC 27001:2022

**Organisation:** `[Legal entity]`
**Scope:** FSM Platform managed service and the supporting ISMS (see
[README.md](README.md#2-scope)).
**Version:** 0.1 readiness draft, 2026-11-08.
**Owner:** Security Lead.
**Approver:** Managing Director.
**Next review:** annual, or after a material change, incident or audit finding.

> This SoA is a readiness artefact. It is not a certification. An accredited
> certification body must audit the ISMS before any certification claim is made.

## 1. How to read this SoA

The SoA covers all **93** Annex A controls in ISO/IEC 27001:2022: 37
organisational (5.x), 8 people (6.x), 14 physical (7.x) and 34 technological
(8.x). Every control has an applicability decision, even when the decision is
"not applicable" or "inherited from the cloud provider".

| Status | Definition used in this draft |
| --- | --- |
| **Implemented** | A control design exists and a repository artefact or documented operating procedure can be shown. Operating effectiveness has not been independently tested. |
| **Partial** | Some design or evidence exists, but a required element, record or cadence is missing. The linked gap in [GAP-ANALYSIS.md](GAP-ANALYSIS.md) must be closed. |
| **Planned** | The control is applicable but not yet designed or operated. Treat as an open gap. |
| **N/A** | Not applicable to the defined scope. The justification explains why. N/A does not remove the need for a decision record. |

| Basis | Meaning |
| --- | --- |
| **Repo** | Evidence exists in this repository: code, tests, CI, configuration, runbook, automation or a dated document. |
| **Policy** | The control is described in a policy or procedure, but operating evidence has not yet been retained. |
| **Inherited** | The control is performed by a supplier (primarily Microsoft Azure) under the shared-responsibility model. Attestations still need to be obtained and reviewed. |
| **None** | No adequate design or evidence exists yet. |

**Important:** `Implemented` means "designed and evidenced in the repository",
not "audited". A Type II or ISO Stage 2 audit tests operation over time. See
[EVIDENCE-CHECKLIST.md](EVIDENCE-CHECKLIST.md).

## 2. Applicability principles

1. **Managed hosting is in scope.** The organisation operates the application,
   database, uploads, backups, identities and monitoring for managed customers.
2. **Self-hosted customer installations are out of scope.** The customer is the
   operator. The vendor supplies secure software and documentation.
3. **Cloud physical controls are inherited.** Azure data-centre controls are
   inherited, but the organisation must review Azure attestations and configure
   the service correctly.
4. **No production data in test.** Synthetic seed data is used. This supports
   the test-information control and reduces privacy risk.
5. **Small-team compensation.** Where one person must hold conflicting duties,
   the compensating control is a second reviewer, audit log, or two-person rule
   for destructive actions. This is recorded as a risk, not hidden.

## 3. Status summary

Counts in this summary are maintained from the `Status` and `Basis` columns. The
evidence collector independently recomputes them into
`compliance-evidence/<timestamp>/controls/coverage-counts.md`; update this
summary when the table changes.

| Status | Count |
| --- | --- |
| Implemented | 29 |
| Partial | 50 |
| Planned | 11 |
| N/A | 3 |
| **Total** | **93** |

| Basis | Count |
| --- | --- |
| Repo | 43 |
| Policy | 25 |
| Inherited | 11 |
| None | 14 |
| **Total** | **93** |

## 4. Statement of Applicability

### 4.1 Organisational controls (5.1–5.37)

| ID | Annex A control | Applicable | Justification / scope | Status | Basis | Evidence | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5.1 | Policies for information security | Yes | The ISMS needs an approved policy set for the managed service and its suppliers. | Partial | Repo | [Information security policy](policies/01-information-security-policy.md), [SECURITY.md](../../SECURITY.md), [policies index](policies/README.md) | Security Lead |
| 5.2 | Information security roles and responsibilities | Yes | Roles and deputies are defined for a small team. | Partial | Policy | [README roles](README.md#5-roles-and-owners), [information security policy](policies/01-information-security-policy.md) | Managing Director |
| 5.3 | Segregation of duties | Yes | One person may hold multiple roles; PR review, audit logs and two-person destructive operations compensate. | Partial | Policy | [Access control policy](policies/02-access-control.md), [risk R-05](RISK-REGISTER.md) | Security Lead |
| 5.4 | Management responsibilities | Yes | Top management must approve policy, risk appetite and reviews. Approval records are not yet retained. | Partial | Policy | [Management review policy](policies/18-management-review.md), [management review template](templates/MANAGEMENT-REVIEW.md) | Managing Director |
| 5.5 | Contact with authorities | Yes | The organisation needs contacts for data-protection and law-enforcement incidents. No contact list is approved. | Planned | None | [Incident response policy](policies/06-incident-response.md) (contact table to complete) | Security Lead |
| 5.6 | Contact with special interest groups | Yes | Participation in security communities and vendor advisory channels is useful but not formalised. | Planned | None | [Vulnerability management policy](policies/05-vulnerability-management.md) | Platform Lead |
| 5.7 | Threat intelligence | Yes | Dependency advisories, container scanning and vendor bulletins are used, but there is no documented intelligence process. | Partial | Repo | [Dependabot config](../../.github/dependabot.yml), [CI workflow](../../.github/workflows/ci.yml), [vulnerability policy](policies/05-vulnerability-management.md) | Platform Lead |
| 5.8 | Information security in project management | Yes | Security requirements are applied through the PR template and CI, but not through a formal project gate. | Partial | Repo | [PR template](../../.github/PULL_REQUEST_TEMPLATE.md), [secure SDLC policy](policies/04-secure-sdlc.md) | Engineering Lead |
| 5.9 | Inventory of information and other associated assets | Yes | A baseline asset and information register exists; it is not yet reconciled to a live CMDB. | Partial | Repo | [Asset register](ASSET-REGISTER.md) | Operations Lead |
| 5.10 | Acceptable use of information and other associated assets | Yes | Staff and contractors use endpoints, source code, production access and customer data. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md) | Security Lead |
| 5.11 | Return of assets | Yes | Leavers may hold laptops, tokens, keys and repository access. The checklist exists but no completed records are retained. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md#7-return-of-assets-and-access), [access control policy](policies/02-access-control.md) | People/HR Lead |
| 5.12 | Classification of information | Yes | Customer data, credentials, source code and public material need different handling. | Partial | Policy | [Data classification and retention](DATA-CLASSIFICATION-RETENTION.md) | Security Lead |
| 5.13 | Labelling of information | Yes | Classification is defined, but labels are not consistently applied in documents, exports or the UI. | Partial | Policy | [Data classification and retention](DATA-CLASSIFICATION-RETENTION.md#12-labelling) | Security Lead |
| 5.14 | Information transfer | Yes | Data moves over TLS to customers, suppliers and backups; formal transfer rules and recipient approval are incomplete. | Partial | Policy | [Cryptography policy](policies/13-cryptography-key-management.md), [supplier policy](policies/09-supplier-management.md) | Operations Lead |
| 5.15 | Access control | Yes | Role-based access, department scoping and customer-portal isolation are implemented. | Implemented | Repo | [Access control policy](policies/02-access-control.md), [SECURITY.md](../../SECURITY.md), `src/lib/permissions` | Platform Lead |
| 5.16 | Identity management | Yes | Local accounts, SSO/OIDC and SCIM are supported with lifecycle controls. | Implemented | Repo | [Access control policy](policies/02-access-control.md), [SECURITY.md](../../SECURITY.md) | Platform Lead |
| 5.17 | Authentication information | Yes | Password hashing, 2FA, reset tokens and API-key hashing are implemented. | Implemented | Repo | [Access control policy](policies/02-access-control.md), [SECURITY.md](../../SECURITY.md), [cryptography policy](policies/13-cryptography-key-management.md) | Platform Lead |
| 5.18 | Access rights | Yes | Access is granted by role, but quarterly access reviews are not yet operated. | Partial | Repo | [Access review template](templates/ACCESS-REVIEW.md), [access control policy](policies/02-access-control.md) | Operations Lead |
| 5.19 | Information security in supplier relationships | Yes | Hosting, SMS, SMTP, maps, identity and backup suppliers process or support customer data. | Partial | Policy | [Supplier management policy](policies/09-supplier-management.md), [supplier register template](templates/SUPPLIER-REGISTER.md) | Finance/Admin Lead |
| 5.20 | Addressing information security within supplier agreements | Yes | DPAs and security schedules are required but not all are signed or on file. | Planned | None | [Supplier management policy](policies/09-supplier-management.md), [GAP G-03](GAP-ANALYSIS.md#g-03-supplier-dpas-and-subprocessor-register) | Finance/Admin Lead |
| 5.21 | Managing information security in the ICT supply chain | Yes | Dependency, image and build-chain risk exists; there is no SBOM or supplier provenance programme. | Planned | None | [Secure SDLC policy](policies/04-secure-sdlc.md), [vulnerability policy](policies/05-vulnerability-management.md) | Platform Lead |
| 5.22 | Monitoring, review and change management of supplier services | Yes | Annual supplier review is defined but not yet performed. | Partial | Policy | [Supplier management policy](policies/09-supplier-management.md#6-review-and-change-management) | Finance/Admin Lead |
| 5.23 | Information security for use of cloud services | Yes | Azure/cloud configuration is documented; shared-responsibility evidence is not yet attached. | Partial | Inherited | [Azure deployment](../AZURE.md), [physical/environmental policy](policies/15-physical-environmental.md), [supplier policy](policies/09-supplier-management.md) | Operations Lead |
| 5.24 | Incident management planning and preparation | Yes | Alerting and an incident procedure exist; no exercise or contact drill has been run. | Partial | Repo | [Incident response policy](policies/06-incident-response.md), [monitoring](../../deploy/monitoring/README.md) | Security Lead |
| 5.25 | Assessment and decision on security events | Yes | Triage criteria are defined in the incident policy; no incident log exists yet. | Partial | Policy | [Incident response policy](policies/06-incident-response.md#4-triage-and-severity) | Security Lead |
| 5.26 | Response to security incidents | Yes | Response steps, containment and notification paths are documented. | Partial | Policy | [Incident response policy](policies/06-incident-response.md#5-response-procedure), [SECURITY.md](../../SECURITY.md) | Security Lead |
| 5.27 | Learning from security incidents | Yes | Post-incident review is required by policy but has not been operated. | Planned | None | [Incident response policy](policies/06-incident-response.md#8-post-incident-review) | Security Lead |
| 5.28 | Collection of evidence | Yes | Audit-chain, evidence export and retention controls exist; incident evidence handling needs a tested procedure. | Partial | Repo | [Audit retention](../audit-retention.md), [incident policy](policies/06-incident-response.md#7-evidence) | Operations Lead |
| 5.29 | Information security during disruption | Yes | Continuity roles and manual fallbacks are described; no disruption exercise has been run. | Partial | Policy | [Business continuity policy](policies/07-business-continuity-dr.md) | Operations Lead |
| 5.30 | ICT readiness for business continuity | Yes | Backup, restore and PITR capabilities exist; a full BCP/DR exercise and BIA are missing. | Partial | Repo | [Backup and restore policy](policies/08-backup-restore.md), [BACKUP-RESTORE.md](../BACKUP-RESTORE.md) | Operations Lead |
| 5.31 | Legal, statutory, regulatory and contractual requirements | Yes | A legal register is required; only a partial list exists. | Partial | Policy | [Privacy policy](policies/11-privacy-gdpr.md), [risk register](RISK-REGISTER.md) | Privacy Officer |
| 5.32 | Intellectual property rights | Yes | The platform is BUSL-1.1 licensed and uses third-party dependencies; no formal IP review is retained. | Partial | Repo | [LICENSE](../../LICENSE), [supplier policy](policies/09-supplier-management.md) | Managing Director |
| 5.33 | Protection of records | Yes | Audit logs are hash-chained, legal holds exist and backups are encrypted; retention decisions need approval. | Implemented | Repo | [Audit retention](../audit-retention.md), [data retention](DATA-CLASSIFICATION-RETENTION.md), [backup policy](policies/08-backup-restore.md) | Operations Lead |
| 5.34 | Privacy and protection of PII | Yes | Erasure and audit procedures exist; Article 30 records, DPAs and notices are incomplete. | Partial | Repo | [Privacy erasure](../privacy-erasure.md), [privacy policy](policies/11-privacy-gdpr.md) | Privacy Officer |
| 5.35 | Independent review of information security | Yes | An independent review is required before certification; none has been performed. | Planned | None | [Internal audit policy](policies/17-internal-audit.md), [GAP G-02](GAP-ANALYSIS.md#g-02-no-independent-internal-audit) | Internal Auditor |
| 5.36 | Compliance with policies, rules and standards | Yes | Compliance monitoring is planned through internal audit and management review; no compliance review record exists. | Partial | Policy | [Internal audit policy](policies/17-internal-audit.md), [management review policy](policies/18-management-review.md) | Security Lead |
| 5.37 | Documented operating procedures | Yes | Operations, backup/restore, audit retention and erasure runbooks are documented and versioned. | Implemented | Repo | [OPERATIONS.md](../OPERATIONS.md), [BACKUP-RESTORE.md](../BACKUP-RESTORE.md), [audit-retention.md](../audit-retention.md) | Operations Lead |

### 4.2 People controls (6.1–6.8)

| ID | Annex A control | Applicable | Justification / scope | Status | Basis | Evidence | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6.1 | Screening | Yes | Staff and contractors with production or customer-data access should be screened before access. No screening records are retained. | Planned | None | [HR security section](policies/01-information-security-policy.md#7-people-security), [GAP G-05](GAP-ANALYSIS.md#g-05-no-hr-onboarding-and-offboarding-evidence) | People/HR Lead |
| 6.2 | Terms and conditions of employment | Yes | Contracts must include confidentiality, acceptable use and security responsibilities. Template clauses are not yet evidenced as signed. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md), [HR security section](policies/01-information-security-policy.md#7-people-security) | People/HR Lead |
| 6.3 | Information security awareness, education and training | Yes | Awareness is required annually and at onboarding; no training records exist. | Partial | Policy | [Training policy](policies/19-training-awareness.md), [training register](templates/TRAINING-REGISTER.md) | People/HR Lead |
| 6.4 | Disciplinary process | Yes | A disciplinary process is required for policy breaches; it is not documented. | Planned | None | [Acceptable use policy](policies/12-acceptable-use.md#9-breaches-and-disciplinary-process) | People/HR Lead |
| 6.5 | Responsibilities after termination or change of employment | Yes | Offboarding must revoke access, recover assets and preserve confidentiality; no completed checklist is retained. | Partial | Policy | [Access control policy](policies/02-access-control.md#7-joiner-mover-leaver), [acceptable use policy](policies/12-acceptable-use.md#7-return-of-assets-and-access) | People/HR Lead |
| 6.6 | Confidentiality or non-disclosure agreements | Yes | Staff, contractors and suppliers with access need signed NDAs. No signed register is retained. | Planned | None | [Supplier policy](policies/09-supplier-management.md), [acceptable use policy](policies/12-acceptable-use.md) | Managing Director |
| 6.7 | Remote working | Yes | Administrators and developers work remotely and can reach production. Endpoint and remote-access rules are defined but not attested. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md#6-remote-working), [access control policy](policies/02-access-control.md) | Security Lead |
| 6.8 | Information security event reporting | Yes | Reporting channels exist through SECURITY.md and the incident policy; staff awareness is not evidenced. | Partial | Repo | [SECURITY.md](../../SECURITY.md), [incident policy](policies/06-incident-response.md#3-reporting) | Security Lead |

### 4.3 Physical controls (7.1–7.14)

| ID | Annex A control | Applicable | Justification / scope | Status | Basis | Evidence | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 7.1 | Physical security perimeters | Yes | Production runs in Azure data centres; the customer-operated self-hosted case is out of scope. | Implemented | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md), [Azure deployment](../AZURE.md) | Operations Lead |
| 7.2 | Physical entry | Yes | Data-centre entry is controlled by the cloud provider. Office entry is controlled by the landlord/organisation. | Implemented | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md) | Operations Lead |
| 7.3 | Securing offices, rooms and facilities | Yes | Office and home-working spaces must protect endpoints and paper; cloud production is provider-controlled. | Implemented | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md), [acceptable use policy](policies/12-acceptable-use.md) | Operations Lead |
| 7.4 | Physical security monitoring | Yes | Provider monitors data centres; the organisation has no separate CCTV or intrusion monitoring evidence. | Partial | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md#4-cloud-inheritance) | Operations Lead |
| 7.5 | Protecting against physical and environmental threats | Yes | Power, cooling, fire and flood protection are provider controls. | Implemented | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md#4-cloud-inheritance) | Operations Lead |
| 7.6 | Working in secure areas | No | The organisation does not operate a secure production area; production is in provider data centres and customer sites are visited under customer supervision. | N/A | None | [Physical/environmental policy](policies/15-physical-environmental.md#3-scope-and-exclusions) | Operations Lead |
| 7.7 | Clear desk and clear screen | Yes | Remote and office work can expose screens, paper and devices. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md#5-clear-desk-and-clear-screen) | Security Lead |
| 7.8 | Equipment siting and protection | Yes | Endpoints and office equipment need physical protection; cloud equipment is provider-managed. | Partial | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md), [acceptable use policy](policies/12-acceptable-use.md) | Operations Lead |
| 7.9 | Security of assets off-premises | Yes | Laptops, phones and backup media may leave the office. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md#6-remote-working), [cryptography policy](policies/13-cryptography-key-management.md) | Security Lead |
| 7.10 | Storage media | Yes | Backups and exports are stored on encrypted media; disposal and re-use of media need a record. | Partial | Repo | [Backup policy](policies/08-backup-restore.md), [cryptography policy](policies/13-cryptography-key-management.md) | Operations Lead |
| 7.11 | Supporting utilities | Yes | Power and network utilities are provider-controlled for cloud; office utilities are landlord-controlled. | Implemented | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md#4-cloud-inheritance) | Operations Lead |
| 7.12 | Cabling security | No | Production cabling is provider-controlled; the organisation has no production cabling to protect. Office cabling is landlord-managed. | N/A | None | [Physical/environmental policy](policies/15-physical-environmental.md#3-scope-and-exclusions) | Operations Lead |
| 7.13 | Equipment maintenance | Yes | Provider maintains cloud hardware; the organisation maintains endpoints and office equipment. | Implemented | Inherited | [Physical/environmental policy](policies/15-physical-environmental.md#5-endpoint-and-office-equipment) | Operations Lead |
| 7.14 | Secure disposal or re-use of equipment | Yes | Endpoints and media may contain customer data or credentials. No disposal certificates are retained. | Partial | Policy | [Data retention and disposal](policies/10-data-retention-disposal.md#6-equipment-and-media-disposal) | Operations Lead |

### 4.4 Technological controls (8.1–8.34)

| ID | Annex A control | Applicable | Justification / scope | Status | Basis | Evidence | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8.1 | User endpoint devices | Yes | Administrators and developers use laptops/phones to access production and source code. | Partial | Policy | [Acceptable use policy](policies/12-acceptable-use.md#4-endpoint-requirements) | Security Lead |
| 8.2 | Privileged access rights | Yes | Admin roles, database roles and break-glass access exist. | Implemented | Repo | [Access control policy](policies/02-access-control.md#4-privileged-access), [SECURITY.md](../../SECURITY.md) | Platform Lead |
| 8.3 | Information access restriction | Yes | Department scoping, role permissions and customer-portal isolation are implemented. | Implemented | Repo | [Access control policy](policies/02-access-control.md), `src/lib/permissions`, [SECURITY.md](../../SECURITY.md) | Platform Lead |
| 8.4 | Access to source code | Yes | Source is private on GitHub and changes require PR review; branch protection settings are not evidenced in-repo. | Implemented | Repo | [Change management policy](policies/03-change-management.md), [PR template](../../.github/PULL_REQUEST_TEMPLATE.md) | Engineering Lead |
| 8.5 | Secure authentication | Yes | Password hashing, 2FA, OIDC, session invalidation and API keys are implemented. | Implemented | Repo | [Access control policy](policies/02-access-control.md#3-authentication), [SECURITY.md](../../SECURITY.md) | Platform Lead |
| 8.6 | Capacity management | Yes | Metrics, memory limits, disk alerts and backup sizing exist; no formal capacity plan. | Partial | Repo | [Operations monitoring](../OPERATIONS.md#overvåking-og-varsling), [monitoring](../../deploy/monitoring/README.md) | Operations Lead |
| 8.7 | Protection against malware | Yes | Container image scanning and dependency controls exist; endpoint anti-malware is not mandated. | Partial | Repo | [CI workflow](../../.github/workflows/ci.yml), [vulnerability policy](policies/05-vulnerability-management.md) | Platform Lead |
| 8.8 | Management of technical vulnerabilities | Yes | Dependabot, npm audit and Trivy run; remediation SLAs and a vulnerability register are missing. | Partial | Repo | [Dependabot](../../.github/dependabot.yml), [CI](../../.github/workflows/ci.yml), [vulnerability policy](policies/05-vulnerability-management.md) | Platform Lead |
| 8.9 | Configuration management | Yes | Compose, env templates and systemd units are versioned; no configuration baseline or drift check. | Partial | Repo | [OPERATIONS.md](../OPERATIONS.md), [docker-compose.prod.yml](../../docker-compose.prod.yml), [.env.example](../../.env.example) | Operations Lead |
| 8.10 | Information deletion | Yes | Customer erasure and audit-log retention are implemented. | Implemented | Repo | [Privacy erasure](../privacy-erasure.md), [audit retention](../audit-retention.md) | Privacy Officer |
| 8.11 | Data masking | Yes | Access control limits exposure, but no masking/tokenisation layer for support or analytics. | Partial | Repo | [Access control policy](policies/02-access-control.md), [privacy policy](policies/11-privacy-gdpr.md) | Platform Lead |
| 8.12 | Data leakage prevention | Yes | Data can leave through exports, email, SMS, logs and support copies; no DLP control. | Planned | None | [Data classification and retention](DATA-CLASSIFICATION-RETENTION.md), [GAP G-12](GAP-ANALYSIS.md#g-12-no-dlp-and-limited-export-monitoring) | Security Lead |
| 8.13 | Information backup | Yes | Daily encrypted backups, checksums, off-site copy and weekly restore test are documented. | Implemented | Repo | [Backup policy](policies/08-backup-restore.md), [BACKUP-RESTORE.md](../BACKUP-RESTORE.md), [scripts/backup.sh](../../scripts/backup.sh) | Operations Lead |
| 8.14 | Redundancy of information processing facilities | Yes | Single-VM deployment is not highly available; Azure PITR and backups reduce data loss but not downtime. | Partial | Inherited | [Business continuity policy](policies/07-business-continuity-dr.md), [BACKUP-RESTORE.md](../BACKUP-RESTORE.md#3-rpo-og-rto) | Operations Lead |
| 8.15 | Logging | Yes | Structured application logs, audit log, access logs and monitoring are implemented. | Implemented | Repo | [Logging policy](policies/14-logging-monitoring.md), [audit retention](../audit-retention.md), [OPERATIONS.md](../OPERATIONS.md#logger) | Operations Lead |
| 8.16 | Monitoring activities | Yes | Metrics, alerts and readiness checks cover availability, backups, queues and disk. | Implemented | Repo | [Monitoring policy](policies/14-logging-monitoring.md), [monitoring](../../deploy/monitoring/README.md) | Operations Lead |
| 8.17 | Clock synchronization | Yes | Host and database clocks are synchronized by the platform/provider; application ordering uses database sequence. | Implemented | Inherited | [Logging policy](policies/14-logging-monitoring.md#5-clock-synchronization), [audit retention](../audit-retention.md) | Operations Lead |
| 8.18 | Use of privileged utility programs | Yes | Break-glass, restore and database maintenance utilities are restricted but not inventoried. | Partial | Repo | [Access control policy](policies/02-access-control.md#4-privileged-access), [break-glass script](../../scripts/break-glass-2fa.mjs) | Operations Lead |
| 8.19 | Installation of software on operational systems | Yes | Only approved images/packages should be installed on production hosts; no allowlist. | Partial | Policy | [Change management policy](policies/03-change-management.md), [acceptable use policy](policies/12-acceptable-use.md) | Operations Lead |
| 8.20 | Networks security | Yes | TLS, reverse proxy, firewall/NSG, private database access and rate limits are documented. | Implemented | Repo | [Network section](policies/13-cryptography-key-management.md), [SECURITY.md](../../SECURITY.md), [Azure deployment](../AZURE.md) | Operations Lead |
| 8.21 | Security of network services | Yes | Caddy/TLS, security headers, body limits and proxy configuration are versioned. | Implemented | Repo | [deploy/proxy](../../deploy/proxy), [SECURITY.md](../../SECURITY.md) | Operations Lead |
| 8.22 | Segregation of networks | Yes | Azure VNet/NSG separation and localhost-bound database ports are documented. | Implemented | Repo | [Azure deployment](../AZURE.md), [docker-compose.prod.yml](../../docker-compose.prod.yml) | Operations Lead |
| 8.23 | Web filtering | Yes | Endpoints can reach arbitrary internet sites; no web filtering is deployed. | Planned | None | [Acceptable use policy](policies/12-acceptable-use.md), [GAP G-14](GAP-ANALYSIS.md#g-14-endpoint-hardening-and-web-filtering-not-evidenced) | Security Lead |
| 8.24 | Use of cryptography | Yes | TLS, age backup encryption, bcrypt, HMAC and SHA-256 audit chains are used. | Implemented | Repo | [Cryptography policy](policies/13-cryptography-key-management.md), [SECURITY.md](../../SECURITY.md) | Platform Lead |
| 8.25 | Secure development life cycle | Yes | PR review, CI, tests and release pinning exist; formal security gates and threat modelling are incomplete. | Partial | Repo | [Secure SDLC policy](policies/04-secure-sdlc.md), [CI](../../.github/workflows/ci.yml) | Engineering Lead |
| 8.26 | Application security requirements | Yes | Authentication, authorization, upload, PDF sanitisation and API requirements are documented. | Implemented | Repo | [SECURITY.md](../../SECURITY.md), [secure SDLC policy](policies/04-secure-sdlc.md) | Platform Lead |
| 8.27 | Secure system architecture and engineering principles | Yes | Architecture and security defaults are documented; no maintained threat model. | Partial | Repo | [SECURITY.md](../../SECURITY.md), [PLATFORM-ANALYSIS.md](../PLATFORM-ANALYSIS.md) | Platform Lead |
| 8.28 | Secure coding | Yes | TypeScript, lint, tests and review are used; no written secure-coding standard. | Partial | Repo | [CONTRIBUTING.md](../../CONTRIBUTING.md), [CI](../../.github/workflows/ci.yml) | Engineering Lead |
| 8.29 | Security testing in development and acceptance | Yes | Unit, integration, E2E, accessibility, dependency and image scans run in CI; no penetration test. | Implemented | Repo | [CI](../../.github/workflows/ci.yml), [SECURITY.md](../../SECURITY.md) | Engineering Lead |
| 8.30 | Outsourced development | No | Development is performed by the organisation; no outsourced development supplier is in scope. Revisit if contractors write production code. | N/A | None | [Secure SDLC policy](policies/04-secure-sdlc.md#2-scope) | Engineering Lead |
| 8.31 | Separation of development, test and production environments | Yes | CI uses an ephemeral PostgreSQL service; production is separate and image-pinned. | Implemented | Repo | [CI](../../.github/workflows/ci.yml), [OPERATIONS.md](../OPERATIONS.md#produksjonssett-image-pinning) | Platform Lead |
| 8.32 | Change management | Yes | PR review, CI gates, image pinning and rollback are documented. | Implemented | Repo | [Change management policy](policies/03-change-management.md), [OPERATIONS.md](../OPERATIONS.md#rollback) | Engineering Lead |
| 8.33 | Test information | Yes | CI and E2E use synthetic seed data. | Implemented | Repo | [seed-e2e.mjs](../../scripts/seed-e2e.mjs), [CI](../../.github/workflows/ci.yml) | Engineering Lead |
| 8.34 | Protection of information systems during audit testing | Yes | Audit access should be read-only and logged; no audit-testing procedure or environment is defined. | Partial | Policy | [Internal audit policy](policies/17-internal-audit.md#6-audit-testing-rules) | Internal Auditor |

## 5. Exclusions and N/A rationale

| Control | Rationale | Revisit trigger |
| --- | --- | --- |
| 7.6 Working in secure areas | The organisation does not operate a secure production area. Customer sites are visited under customer supervision. | Opening an office with a server room or processing paper records in a secure area. |
| 7.12 Cabling security | Production cabling is provider-controlled and the organisation has no production cabling. | Operating own hardware in an office or co-location. |
| 8.30 Outsourced development | No outsourced development is in scope. | Engaging a contractor or agency to write production code. |

All other controls are applicable. Cloud-inherited controls remain applicable to
the organisation; they are not excluded. The organisation must obtain and review
the provider's attestations and retain the review record.

## 6. Approval

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Managing Director | `[Name]` |  |  |
| Security Lead | `[Name]` |  |  |
| Privacy Officer | `[Name]` |  |  |
| Operations Lead | `[Name]` |  |  |

By approving this SoA, the organisation accepts the scope, the applicability
decisions and the open gaps. Approval does not assert that every control is
operating effectively.
