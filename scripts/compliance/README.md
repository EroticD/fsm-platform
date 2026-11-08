# Compliance Evidence Scripts

Read-only helpers for the ISO/IEC 27001:2022 and SOC 2 readiness package in
[`docs/compliance/`](../../docs/compliance/README.md).

| Script | Purpose | Writes |
| --- | --- | --- |
| [`collect-evidence.mjs`](collect-evidence.mjs) | Collect a dated repository/CI/operations evidence pack. | `compliance-evidence/<timestamp>/` outside version control |
| [`check-doc-links.mjs`](check-doc-links.mjs) | Validate local Markdown links and paths. | Nothing |

## Quick start

```bash
# Validate documentation links (also suitable for CI).
npm run compliance:links

# Collect a dated evidence pack. No cloud credentials required.
npm run compliance:evidence

# Optional: run the local test suite and record the result (slow).
node scripts/compliance/collect-evidence.mjs --run-tests

# Optional: write to a protected location and label the pack.
node scripts/compliance/collect-evidence.mjs \
  --out /secure/evidence/fsm \
  --label soc2-q4
```

The collector exits 0 when a pack is produced, even if some evidence is marked
unavailable. Review `unavailable.md` in the pack; absence is not automatically a
control failure, but it must be explained and replaced with an export from the
owning system.

## What the pack contains

```
compliance-evidence/<timestamp>/
├── EVIDENCE-PACK.md
├── MANIFEST.sha256
├── manifest.json
├── metadata.json
├── unavailable.md
├── git/
│   ├── change-log.md
│   ├── commit-policy-snapshot.md
│   ├── branches.txt
│   ├── tags.txt
│   ├── status.txt
│   └── diff-stat.txt
├── dependencies/
│   ├── npm-audit-summary.md
│   ├── npm-audit.json (when available)
│   ├── dependabot.md
│   └── package-lock.sha256
├── ci/
│   ├── ci-workflow-summary.md
│   ├── coverage-summary.md
│   ├── test-artifacts.md
│   └── local-test-run.md (or vitest-results.json with --run-tests)
├── operations/
│   ├── backup-config.md
│   ├── audit-retention.md
│   └── rpo-rto-excerpt.md
├── access-review/
│   └── access-review-template.md
├── security/
│   └── secret-scanning.md
├── controls/
│   └── technical-evidence.md
├── policies/
│   └── policy-hashes.md
└── snapshot/
    ├── docs/compliance/...
    ├── deploy/...
    ├── .github/workflows/...
    ├── prisma/schema.prisma
    └── ...
```

## Safety properties

- **Read-only.** The collector does not modify the repository, production
  systems or configuration. It only writes to the output directory.
- **No `.env` reads.** `.env`, `.env.*` (except the example), private keys and
  backups are skipped. The collector reads whitelisted repository files.
- **No credentials.** It does not call cloud APIs, GitHub admin APIs or the
  database. Evidence that needs those is marked unavailable.
- **No secret output in generated reports.** Generated text is sanitised and
  secret-like values are redacted. Snapshot files are byte-identical repository
  copies (excluding `.env` and keys); they may contain test placeholders. Review
  the pack before sharing it outside the organisation.
- **Path-only secret heuristic.** The local secret scan reports file paths and
  match counts, never matched content. It is not a substitute for GitHub secret
  scanning.
- **No production data.** It does not read uploads, database dumps or backup
  files.
- **Integrity.** Every file in the pack is hashed into `MANIFEST.sha256` and
  `manifest.json`.

Verify a pack:

```bash
cd compliance-evidence/<timestamp>
sha256sum -c MANIFEST.sha256
```

## What it does not prove

The pack is **design and repository evidence**. It does not prove that:

- a control operated over an observation period;
- access was reviewed, a supplier DPA was signed or training happened;
- a restore succeeded, an incident was handled or a vulnerability was fixed
  within SLA;
- GitHub branch protection, secret scanning or cloud configuration is correct.

Attach the external evidence listed in
[`unavailable.md`](../../docs/compliance/EVIDENCE-CHECKLIST.md#6-evidence-that-cannot-be-collected-from-the-repository)
and in the generated pack.

## Optional flags

| Flag | Effect |
| --- | --- |
| `--out <dir>` | Output root (relative or absolute). Default `compliance-evidence`. |
| `--label <name>` | Suffix for the dated directory. |
| `--run-tests` | Run the local test suite and record the result. |
| `--skip-audit` | Skip the `npm audit` network call (useful offline). |
| `--help` | Show help. |

## Link checker

`check-doc-links.mjs` walks `docs/compliance` by default and checks:

- relative file and directory paths;
- local anchors (warnings when the heading cannot be matched, because GitHub
  slug rules differ for punctuation);
- skips external URLs, code blocks and HTML comments.

Use `--path <dir>` to check another documentation tree.

## Adding evidence sources

When a new control or evidence source is added:

1. Add the file to the whitelist in `collect-evidence.mjs`.
2. Add a row to [`docs/compliance/EVIDENCE-CHECKLIST.md`](../../docs/compliance/EVIDENCE-CHECKLIST.md).
3. If the evidence needs credentials, add it to `markUnavailable` with the owner
   and source.
4. Run `npm run compliance:links` and `npm run compliance:evidence`.
5. Inspect the generated pack for secrets before sharing it.

Do not add a script that writes to production, calls an authenticated API by
default, or prints raw environment values.
