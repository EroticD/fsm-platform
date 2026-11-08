# POL-03 Change Management

| Field | Value |
| --- | --- |
| Policy ID | POL-03 |
| Version | 0.1 readiness draft |
| Owner | Engineering Lead |
| Approver | Managing Director |
| Review cadence | Annual, and after a failed change or rollback |
| Scope | Application code, database schema, configuration, infrastructure, CI/CD and production deployment |
| Related ISO Annex A | 8.19, 8.32, 8.25, 8.31 |
| Related SOC 2 | CC8.1, CC7.1, CC3.4 |
| Evidence | Pull requests, CI runs, approvals, deployment records, migration logs, rollback records |

## 1. Purpose

Ensure that changes to production are authorised, reviewed, tested, documented,
reversible and traceable, without slowing down low-risk work unnecessarily.

## 2. Change types

| Type | Examples | Approval | Evidence |
| --- | --- | --- | --- |
| Standard | Documentation, translation, dependency patch with green CI, low-risk UI text | PR review by a second person | PR, CI run |
| Normal | Feature, schema migration, configuration, dependency major update | PR review + Engineering Lead approval; security review if auth/data | PR, CI, risk note, deployment record |
| Emergency | Critical security fix, outage mitigation | Incident lead + one additional approver; retrospective within 5 business days | Incident record, PR, post-change review |
| Infrastructure | Network, TLS, database role, backup, cloud resource | Operations Lead + Security Lead; change window | Change ticket, config diff, rollback plan |

If a change affects customer commitments, privacy, data residency or a
subprocessor, the Privacy Officer must review it before release.

## 3. Standard change procedure

1. **Request and scope.** The PR describes the change, why it is needed, risk,
   affected data/systems and rollback.
2. **Review.** At least one person other than the author reviews the code and
   the security implications. The reviewer checks authorization, input
   validation, secrets, migrations and tests.
3. **Automated gates.** CI must pass dependency audit, migration consistency,
   type check, tests, build, E2E, lint and i18n checks. The Docker image is
   scanned for Critical/High vulnerabilities.
4. **Approval.** The Engineering Lead (or delegate) approves merge. Branch
   protection must require review and green checks; the hosted setting is
   exported as evidence because it is not stored in the repository.
5. **Deploy.** Deploy a pinned image tag or digest, never `latest`. Run
   migrations with the migration role before starting the new application.
6. **Verify.** Check `/api/ready`, smoke tests, logs, error rate and key metrics.
7. **Record.** Link the deployment to the PR/commit, image digest, operator,
   time and result.
8. **Rollback.** If verification fails, follow
   [OPERATIONS.md](../../../docs/OPERATIONS.md#rollback). Record the decision and
   the restored version.

## 4. Database changes

- Migrations are immutable once applied to production. Add a new migration
  instead of editing history.
- Every migration is tested on an empty database and checked against
  `schema.prisma` in CI.
- Destructive migrations require a backup, a rollback plan and explicit
  approval.
- Runtime uses a DML role; migrations use the DDL/migration role. Do not grant
  DDL to the runtime role to make a deployment pass.
- Long-running or locking migrations require a maintenance window and a
  measured rollback point.

## 5. Release and deployment integrity

- Images are built in CI from a reviewed commit, scanned, and published by the
  release workflow only after CI is green.
- Production uses a pinned version or digest. The previous known-good image is
  recorded before deployment.
- GitHub Actions are pinned to commit SHAs; workflow tokens are read-only unless
  a job needs more.
- Release notes state security-relevant changes, migrations and required
  configuration.
- The organisation should add image signing/provenance and an SBOM before a
  SOC 2 Type II period. This is an open gap (G-15).

## 6. Emergency changes

1. Declare an incident and assign an incident lead.
2. Make the smallest safe change, with a second approver if available.
3. Preserve logs and evidence; do not bypass audit logging.
4. Deploy with a rollback point and monitor.
5. Within five business days, complete a retrospective: root cause, review,
   tests added, documentation updated, and whether the emergency path was
   justified.
6. Record the emergency change in the change log and management review.

## 7. Configuration and infrastructure changes

- Environment variables are documented in `.env.example`; real values live in
  the approved secret store. Never commit `.env`.
- Changes to TLS, proxy, firewall/NSG, database roles, backup keys, retention or
  monitoring require a rollback plan and an evidence snapshot.
- Destructive operations follow the two-person rule.
- Configuration drift is reviewed at least quarterly against the documented
  baseline. A full automated drift check is a gap (G-15).

## 8. Roles and responsibilities

| Role | Responsibility |
| --- | --- |
| Author | Describes risk, tests, rollback; responds to review. |
| Reviewer | Independent code/security review; blocks unsafe changes. |
| Engineering Lead | Approves normal changes; owns release quality. |
| Operations Lead | Approves infrastructure changes; executes/observes deployment. |
| Security Lead | Reviews security-sensitive changes and emergency retrospectives. |
| Privacy Officer | Reviews changes affecting personal data, retention or suppliers. |

## 9. Evidence and metrics

| Metric | Target | Source |
| --- | --- | --- |
| Production changes with independent review | 100% | PR history |
| Changes with green CI before merge | 100% | CI run history |
| Emergency changes with retrospective within 5 days | 100% | Change log |
| Failed deployments with recorded rollback | 100% | Deployment record |
| Migrations tested on empty DB | 100% | CI log |
| Mean time to restore after failed change | Measure and trend | Incident/change record |

## 10. Exceptions

A change may bypass a gate only for an emergency, with an incident record and
retrospective. A permanent bypass (for example, disabling a required check)
requires a risk acceptance approved by the Managing Director and must be
reviewed at management review.

## 11. Related documents

- [Secure SDLC](04-secure-sdlc.md)
- [Vulnerability management](05-vulnerability-management.md)
- [Incident response](06-incident-response.md)
- [OPERATIONS.md](../../../docs/OPERATIONS.md)
- [CONTRIBUTING.md](../../../CONTRIBUTING.md)
