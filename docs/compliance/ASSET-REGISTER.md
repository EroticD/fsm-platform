# Asset and Information Register

**Organisation:** `[Legal entity]`
**Scope:** FSM Platform managed service, supporting infrastructure and
information assets (see [README scope](README.md#2-scope)).
**Version:** 0.1 readiness draft, 2026-11-08.
**Owner:** Operations Lead.
**Data owner:** Privacy Officer for personal data; Security Lead for the
register itself.
**Review cadence:** quarterly and on material change.

> The register is a baseline, not a reconciled CMDB. The evidence collector
> records a snapshot of repository assets; production inventory, cloud resource
> IDs and supplier contract IDs must be attached from the relevant console or
> contract system.

## 1. How to use the register

Each asset has an **owner** accountable for its confidentiality, integrity and
availability. An asset without an owner is an open finding.

- **Classification:** Public, Internal, Confidential, Restricted. See
  [DATA-CLASSIFICATION-RETENTION.md](DATA-CLASSIFICATION-RETENTION.md).
- **CIA:** Confidentiality / Integrity / Availability criticality: H, M, L.
- **Location:** where the asset lives (repository, Azure, GitHub, supplier,
  office, endpoint).
- **Retention:** link to the retention matrix; do not invent a legal period.
- **Controls:** the main control families, not every individual setting.

## 2. Asset inventory

| ID | Asset / information | Type | Owner | Location / supplier | Classification | C | I | A | Key controls | Retention / disposal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | FSM Platform source code and history | Information system | Engineering Lead | GitHub private repository | Confidential | H | H | M | Private repo, branch protection, PR review, 2FA, CI, secret scanning | Retain while product is maintained; archive on retirement |
| A-02 | Container images and release artefacts | Information system | Platform Lead | GitHub Container Registry (GHCR) | Confidential | M | H | H | Pinned tags/digests, Trivy scan, CI provenance, restricted publish | Keep released versions for support window; delete unsupported images |
| A-03 | Production application host / container runtime | Infrastructure | Operations Lead | Azure VM or customer-independent container host | Confidential | H | H | H | OS patching, firewall/NSG, TLS proxy, least-privilege SSH, monitoring | Life of service; secure wipe at decommission |
| A-04 | PostgreSQL production database | Data store | Operations Lead | Azure Database for PostgreSQL Flexible Server or local PostgreSQL volume | Restricted | H | H | H | Private access, TLS, DML runtime role, migrations by DDL role, PITR/backups | Customer data per contract; backups per retention matrix |
| A-05 | Uploads volume (PDFs, photos, signatures, attachments) | Data store | Operations Lead | Encrypted Azure disk or Docker volume | Restricted | H | H | H | Access-checked file serving, per-file ownership, quotas, encrypted disk, backup | Customer data per contract; erasure procedure |
| A-06 | Encrypted backups (local and off-site) | Data store | Operations Lead | Backup host + Azure Blob or rclone remote | Restricted | H | H | M | age encryption, checksums, freshness alerts, immutability/soft delete, offline key | Local 30 days default; off-site per contract/lifecycle |
| A-07 | Secrets and keys (`.env`, Key Vault, age identity, signing keys) | Credential | Security Lead | Azure Key Vault, host filesystem (0600), offline key copy | Restricted | H | H | H | Key Vault RBAC/managed identity, 0600, rotation, no git, break-glass | Rotate on schedule/compromise; retain key history only as needed |
| A-08 | Application audit log (`AuditLog`, tombstones, holds) | Records | Operations Lead | PostgreSQL, hash-chained | Restricted | H | H | H | Append-only runtime grant, hash chain, legal hold, export with manifest/HMAC | Default 365 days; legal hold overrides; export per audit-retention.md |
| A-09 | Customer and tenant master data | Personal data | Privacy Officer | PostgreSQL | Restricted | H | H | H | RBAC, department scoping, erasure, audit, backup | Contract + retention matrix; erasure/anonymisation |
| A-10 | Customer contact and portal-user data | Personal data | Privacy Officer | PostgreSQL | Restricted | H | H | M | Portal isolation, 2FA, invite expiry, access review | Contract + retention matrix; erasure |
| A-11 | Jobs, sites, equipment and service history | Business records | Operations Lead | PostgreSQL | Confidential | M | H | H | Transactional integrity, authorization, audit, backup | Contract + retention matrix |
| A-12 | Signed service reports, report PDFs, signatures and photos | Business records | Operations Lead | PostgreSQL + uploads volume | Restricted | H | H | H | Immutable signed PDF evidence, access control, backup, retention | Assumed 5 years after service, subject to legal confirmation; legal hold |
| A-13 | Documents and extracted OCR text | Business records | Operations Lead | Uploads volume + database | Confidential | H | M | M | Access control, quarantine/PDF sanitisation, backup, deletion | Customer-controlled; delete with customer request |
| A-14 | Application logs and metrics | Operational records | Operations Lead | Container logs, `/api/metrics`, Prometheus | Confidential | M | M | M | Log rotation, secret redaction, access restriction, retention | 30 MB/container local default; metrics per monitoring retention |
| A-15 | CI/CD configuration, test results and build logs | Operational records | Engineering Lead | GitHub Actions | Confidential | M | H | M | Pinned Actions, least-privilege token, no secrets in logs, artifact retention | GitHub retention + evidence pack |
| A-16 | Workforce accounts, roles and permissions | Identity data | Operations Lead | Application DB + identity provider | Restricted | H | H | H | 2FA, RBAC, joiner/mover/leaver, access review, session invalidation | Employment + audit retention; delete/anonymise after leaver |
| A-17 | Employee and contractor HR records | Personal data | People/HR Lead | HR system / restricted folder | Restricted | H | H | M | Access restricted, confidentiality, retention schedule, secure disposal | Per HR/legal schedule; not in this repository |
| A-18 | Supplier contracts, DPAs and attestations | Contract records | Finance/Admin Lead | Contract repository | Confidential | H | H | M | Supplier register, access restriction, annual review, retention | Contract term + limitation period |
| A-19 | Administrator and developer endpoints | Endpoint | Security Lead | Laptops/phones, office/home | Confidential | H | M | M | Disk encryption, screen lock, patching, MDM/remote wipe, no local customer data | Life of device; secure wipe/certificate |
| A-20 | Network, DNS, TLS and proxy configuration | Infrastructure | Operations Lead | Azure VNet/NSG, Caddy, DNS registrar | Confidential | M | H | H | Private DB, TLS, security headers, change control, DNS registrar 2FA | Life of service; documented on change |
| A-21 | Monitoring and alerting configuration | Infrastructure | Operations Lead | `deploy/monitoring`, Prometheus/Alertmanager | Internal | L | M | H | Versioned config, secret token, alert routing, review | Life of service; version history |
| A-22 | Backup encryption keys and recovery material | Credential | Security Lead | Offline safe / password manager / Key Vault | Restricted | H | H | H | Split knowledge, offline copy, access log, annual recovery test | Retain while backups exist; destroy with certificate |
| A-23 | Customer-facing documentation and notices | Information | Managing Director | Repository / website | Public or Internal | L | M | M | Review and approval, version control | Current version + archive |
| A-24 | Third-party dependencies and SBOM data | Supply chain | Platform Lead | npm, package-lock, CI | Confidential | M | H | M | Dependabot, npm audit, lockfile, Trivy, license review | Per release; retain SBOM for supported versions |

## 3. Supplier and subprocessor assets

| Supplier | Service | Data exposure | Criticality | Contract / DPA | Evidence to obtain |
| --- | --- | --- | --- | --- | --- |
| Microsoft Azure | VM, PostgreSQL, Key Vault, Blob, DNS/network | Hosting and backups; may process personal data | Critical | DPA + Microsoft Product Terms | Current SOC 2/ISO attestations, region, subprocessor list, shared-responsibility matrix |
| GitHub / GHCR | Source, CI, container registry | Source code, build metadata, possibly test data | Critical | GitHub DPA/terms | Org 2FA enforcement, audit log export, secret-scanning status, branch-protection export |
| SMTP provider | Transactional email | Names, email addresses, message content | High | DPA required | Security terms, subprocessors, retention |
| SMS provider (Link Mobility/PSWinCom/Twilio) | SMS delivery | Phone numbers, message content | High | DPA required | Security terms, delivery logs, subprocessors |
| Map/tile provider (OpenStreetMap, MapTiler, Mapbox, etc.) | Map display/geocoding | Address/coordinates, IP address | Medium | Terms + privacy review | Data-processing terms, whether addresses are sent, region |
| Identity provider (Entra ID/Keycloak/Authentik/Zitadel) | SSO | Identity attributes, authentication events | High | DPA/terms | Security configuration, MFA enforcement, audit logs |
| DNS registrar / TLS CA | DNS and certificates | Domain metadata | High | Terms | Registrar 2FA, certificate transparency, renewal |
| Off-site backup storage | Backup copy | Encrypted customer data | Critical | DPA + storage terms | Immutability, region, encryption, deletion certificate |
| Monitoring/alerting provider (if external) | Metrics/alerts | Operational metadata, possibly personal data in logs | Medium | DPA if personal data | Retention, access, region |

The supplier register template is in
[templates/SUPPLIER-REGISTER.md](templates/SUPPLIER-REGISTER.md). A supplier
without a completed row is an open gap under
[GAP G-03](GAP-ANALYSIS.md#g-03-supplier-dpas-and-subprocessor-register).

## 4. Information flows (summary)

| Flow | Source → destination | Data | Protection |
| --- | --- | --- | --- |
| Customer browser → app | Internet → Caddy → Next.js | Credentials, customer data, uploads | TLS, security headers, rate limits, RBAC |
| App → PostgreSQL | App container → database | All application data | Private network/localhost, TLS for external DB, DML role |
| App → uploads | App → volume | Files, photos, signatures | Access-checked serving, quotas, encrypted disk |
| App → SMTP/SMS | App → supplier API | Contact details, notifications | TLS, provider DPA, minimal content |
| App → map/geocode | Browser/app → map provider | Address/coordinates, IP | HTTPS, privacy review; avoid sending more than needed |
| Backup job → backup storage | Host → local + off-site | Encrypted database/uploads | age encryption, checksum, TLS, immutability |
| Audit export → admin download | App → admin browser | Audit records/evidence ZIP | Admin-only, TLS, manifest/HMAC, download logging |
| GitHub → production | CI → GHCR → host | Code/image | Pinned digest, review, scan, restricted publish |
| Admin → production | VPN/SSH/proxy → host | Commands, logs | Named account, 2FA, least privilege, audit |

## 5. Asset lifecycle

| Stage | Requirement | Evidence |
| --- | --- | --- |
| Acquisition | Approved supplier, classification, owner, security requirements | Supplier row, contract/DPA, asset register entry |
| Deployment | Hardened configuration, secrets in approved store, monitoring | Change record, config hash, screenshot/export |
| Operation | Owner review, patching, access review, backup | Quarterly register review, scan results, restore test |
| Change | Impact assessment, approval, rollback | PR/change ticket, risk note |
| Retirement | Data migration/deletion, media sanitisation, access removal | Deletion certificate, final backup decision, register update |

## 6. Register review record

| Date | Reviewer | Assets added/changed/retired | Supplier changes | Actions |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

The register is not complete until production resource IDs, supplier contract
IDs and data-flow owners have been reconciled with the live environment.
