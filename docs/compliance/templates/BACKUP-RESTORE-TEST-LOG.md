# Backup and Restore Test Log

**Owner:** Operations Lead
**Frequency:** weekly automated restore, quarterly full database restore, annual
full disaster exercise
**Retention:** current audit cycle + 1 year (3 years recommended)

> Do not record encryption keys, passwords or customer data in this log. Record
> backup IDs, timestamps, results and deviations.

## Test record

| Date | Test type | Backup ID / timestamp | Environment | Operator | Start | End | RTO measured | Data verified | Result | Deviations / actions | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | Weekly restore |  | Isolated DB |  |  |  |  | Row counts, latest record, audit chain | Pass/Fail |  | Log/hash |
|  | Quarterly full DB |  | New DB/host |  |  |  |  | Migrations, sample queries |  |  |  |
|  | Annual DR |  | New host + uploads |  |  |  |  | App ready, uploads, DNS/TLS simulation |  |  |  |

## Checklist

- [ ] Backup file exists and is non-empty.
- [ ] SHA-256 checksum matches.
- [ ] Encryption identity is the correct one; decryption succeeds.
- [ ] Restore target is isolated from production.
- [ ] `psql` runs with `ON_ERROR_STOP=1`.
- [ ] Migrations match the application version.
- [ ] `/api/ready` is green (or equivalent smoke test).
- [ ] Row counts and latest records are plausible.
- [ ] Audit chain verifies (`npm run audit:verify`) or the expected state is documented.
- [ ] A sample upload/document opens.
- [ ] No production traffic was routed to the test target.
- [ ] Test environment and data are removed after verification.
- [ ] Measured RTO/RPO recorded and compared with targets.
- [ ] Failures are recorded as incidents/actions, not silently retried.

## Test environment

| Item | Value |
| --- | --- |
| Backup source | local / off-site |
| Database engine/version |  |
| Application image/digest |  |
| Key identity source | offline copy / protected host copy |
| Isolated network |  |
| Data handling after test | deleted / retained until date |

## Summary

| Period | Tests planned | Passed | Failed | Mean RTO | Open actions |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

A restore is not proven until the database starts and a real query succeeds.
