#!/usr/bin/env node
/**
 * Read-only compliance evidence collector.
 *
 *   node scripts/compliance/collect-evidence.mjs
 *   node scripts/compliance/collect-evidence.mjs --out /secure/evidence --label q4
 *   node scripts/compliance/collect-evidence.mjs --run-tests
 *   node scripts/compliance/collect-evidence.mjs --skip-audit
 *
 * The collector writes a dated pack outside version control by default. It:
 *   - reads only whitelisted repository files;
 *   - never reads `.env`, backups, uploads or key material;
 *   - never prints or stores secret values;
 *   - marks evidence that needs credentials or external systems as unavailable.
 *
 * It does not certify anything and does not replace an auditor's sampling.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const collectorVersion = "0.1.0";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const label = options.label ? `-${slug(options.label)}` : "";
const outputRoot = path.isAbsolute(options.out)
  ? options.out
  : path.resolve(repoRoot, options.out);
const packDir = path.join(outputRoot, `${stamp}${label}`);

const unavailable = [];
const warnings = [];
let collected = 0;

fs.mkdirSync(packDir, { recursive: true });

main();

function main() {
  const metadata = collectMetadata();
  writeJson("metadata.json", metadata);
  collectGitEvidence(metadata);
  collectPolicySnapshot();
  collectDependencies();
  collectCi();
  collectOperations();
  collectAuditRetention();
  collectAccessReview();
  collectSecretScanning();
  collectTechnicalControls();
  collectCoverageCounts();
  writeUnavailable();
  writePackReadme(metadata);
  writeManifest();
  printSummary(metadata);
}

function parseArgs(argv) {
  const result = {
    out: "compliance-evidence",
    label: "",
    runTests: false,
    skipAudit: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--run-tests") {
      result.runTests = true;
    } else if (arg === "--skip-audit") {
      result.skipAudit = true;
    } else if (arg === "--out") {
      result.out = requireValue(argv, (index += 1), "--out");
    } else if (arg === "--label") {
      result.label = requireValue(argv, (index += 1), "--label");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Compliance evidence collector ${collectorVersion}

Usage:
  node scripts/compliance/collect-evidence.mjs [options]

Options:
  --out <dir>     Output root, relative to the repo or absolute.
                  Default: compliance-evidence (outside version control).
  --label <name>  Suffix for the dated pack, e.g. --label q4.
  --run-tests     Run the local test suite and record the result. This is
                  optional and can take several minutes.
  --skip-audit    Skip the npm audit network call.
  -h, --help      Show this help.

The collector is read-only against the repository. It never reads .env files,
backups, uploads or key material, and it never prints secret values.
`);
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function write(relativePath, content) {
  const target = safePackPath(relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  collected += 1;
}

function writeJson(relativePath, value) {
  write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyRepo(relativeSource, relativeDestination = relativeSource) {
  if (!isSafeRepoPath(relativeSource)) {
    throw new Error(`Refusing to read unsafe path: ${relativeSource}`);
  }
  const source = path.join(repoRoot, relativeSource);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    return false;
  }
  const destination = safePackPath(path.join("snapshot", relativeDestination));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  collected += 1;
  return true;
}

function copyRepoTree(relativeRoot) {
  if (!isSafeRepoPath(relativeRoot)) return;
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return;
  for (const file of walk(absoluteRoot)) {
    const relative = path.relative(repoRoot, file);
    if (relative.split(path.sep).includes(".git")) continue;
    copyRepo(relative, relative);
  }
}

function readRepo(relativePath, maxBytes = 1_000_000) {
  if (!isSafeRepoPath(relativePath)) {
    throw new Error(`Refusing to read unsafe path: ${relativePath}`);
  }
  const absolute = path.join(repoRoot, relativePath);
  const stat = fs.statSync(absolute);
  if (stat.size > maxBytes) {
    throw new Error(`File too large to snapshot safely: ${relativePath}`);
  }
  return fs.readFileSync(absolute, "utf8");
}

function isSafeRepoPath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  const base = path.basename(normalized).toLowerCase();
  if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) {
    return false;
  }
  if (base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12")) {
    return false;
  }
  return true;
}

function safePackPath(relativePath) {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Refusing to write outside the pack: ${relativePath}`);
  }
  return path.join(packDir, normalized);
}

function walk(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileSha256(relativePath) {
  try {
    return sha256(fs.readFileSync(path.join(repoRoot, relativePath)));
  } catch {
    return null;
  }
}

function run(command, args, runOptions = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: runOptions.timeout ?? 120_000,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      ...(runOptions.env ?? {}),
    },
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? String(result.error.message) : "",
  };
}

function sanitize(value) {
  let text = String(value ?? "");
  text = text.replace(
    /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
    "$1[redacted]@",
  );
  text = text.replace(
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
    "[redacted-private-key]",
  );
  text = text.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g,
    "[redacted-token]",
  );
  text = text.replace(
    /\b([A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY|PASS|CREDENTIAL)[A-Z0-9_]*)\s*=\s*[^\s]+/g,
    "$1=[redacted]",
  );
  text = text.replace(
    /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
    "postgresql://[redacted]",
  );
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated]` : text;
}

function excerpt(value, maxLines = 40) {
  return sanitize(String(value ?? "").split("\n").slice(0, maxLines).join("\n"));
}

function markUnavailable(id, item, reason, owner, source) {
  unavailable.push({ id, item, reason, owner, source });
}

function collectMetadata() {
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  const describe = git(["describe", "--tags", "--always", "--dirty"]).stdout.trim();
  const commitDate = git(["log", "-1", "--format=%cI"]).stdout.trim();
  const status = git(["status", "--porcelain"]).stdout.trim();
  const remoteRaw = git(["config", "--get", "remote.origin.url"]).stdout.trim();
  const remote = remoteRaw.replace(/\/\/[^/@]+@/, "//[redacted]@");

  return {
    schemaVersion: 1,
    collectorVersion,
    generatedAt: now.toISOString(),
    label: options.label || null,
    repository: {
      name: path.basename(repoRoot),
      remote,
      branch,
      head,
      describe,
      commitDate,
      dirty: status.length > 0,
    },
    runtime: {
      node: process.version,
      npm: run("npm", ["--version"], { timeout: 15_000 }).stdout.trim(),
      platform: process.platform,
      arch: process.arch,
    },
    package: readPackageMetadata(),
  };
}

function readPackageMetadata() {
  try {
    const pkg = JSON.parse(readRepo("package.json"));
    return {
      name: pkg.name ?? null,
      version: pkg.version ?? null,
      license: pkg.license ?? null,
      scripts: Object.keys(pkg.scripts ?? {}).sort(),
    };
  } catch {
    return { name: null, version: null, license: null, scripts: [] };
  }
}

function git(args) {
  return run("git", args, { timeout: 30_000 });
}

function collectGitEvidence(metadata) {
  const log = git([
    "log",
    "--since=180.days",
    "--date=short",
    "--pretty=format:%h%x1f%ad%x1f%an%x1f%s",
  ]);

  const rows = log.stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, 500)
    .map((line) => {
      const [hash, date, author, subject] = line.split("\x1f");
      return `| ${cell(hash)} | ${cell(date)} | ${cell(author)} | ${cell(subject)} |`;
    });

  write(
    "git/change-log.md",
    `# Change log (last 180 days)\n\n` +
      `Generated from git history at ${now.toISOString()}.\n\n` +
      `| Commit | Date | Author | Subject |\n| --- | --- | --- | --- |\n` +
      `${rows.join("\n")}\n\n` +
      `A git log is change evidence, not proof of approval. Pair it with pull requests, CI runs and deployment records.\n`,
  );

  write("git/branches.txt", git(["branch", "-a", "--no-color"]).stdout);
  write("git/tags.txt", git(["tag", "--sort=-creatordate"]).stdout.split("\n").slice(0, 50).join("\n") + "\n");
  write(
    "git/status.txt",
    `# Working tree status\n\n` +
      `Branch: ${metadata.repository.branch}\n` +
      `HEAD: ${metadata.repository.head}\n` +
      `Dirty: ${metadata.repository.dirty ? "yes" : "no"}\n\n` +
      `${git(["status", "--short", "--branch"]).stdout || "(clean)\n"}`,
  );
  write(
    "git/diff-stat.txt",
    `# Uncommitted diff stat\n\n${git(["diff", "--stat"]).stdout || "(none)\n"}\n\n` +
      `# Staged diff stat\n\n${git(["diff", "--cached", "--stat"]).stdout || "(none)\n"}`,
  );

  const ciHash = fileSha256(".github/workflows/ci.yml");
  const prHash = fileSha256(".github/PULL_REQUEST_TEMPLATE.md");
  const dependabotHash = fileSha256(".github/dependabot.yml");
  const codeowners = fs.existsSync(path.join(repoRoot, ".github/CODEOWNERS"));
  const branchProtection = git(["config", "--get", "branch.main.protection"]).stdout.trim();

  write(
    "git/commit-policy-snapshot.md",
    `# Commit and pull-request policy snapshot\n\n` +
      `| Item | Value |\n| --- | --- |\n` +
      `| HEAD | \`${metadata.repository.head}\` |\n` +
      `| Branch | \`${cell(metadata.repository.branch)}\` |\n` +
      `| Describe | \`${cell(metadata.repository.describe)}\` |\n` +
      `| Commit date | ${metadata.repository.commitDate} |\n` +
      `| Working tree dirty | ${metadata.repository.dirty ? "yes" : "no"} |\n` +
      `| CI workflow SHA-256 | \`${ciHash ?? "missing"}\` |\n` +
      `| PR template SHA-256 | \`${prHash ?? "missing"}\` |\n` +
      `| Dependabot SHA-256 | \`${dependabotHash ?? "missing"}\` |\n` +
      `| CODEOWNERS present | ${codeowners ? "yes" : "no"} |\n` +
      `| Local branch-protection config | ${branchProtection ? `\`${cell(branchProtection)}\`` : "not available locally"} |\n\n` +
      `## Required review policy (from repository evidence)\n\n` +
      `- Pull requests use \`.github/PULL_REQUEST_TEMPLATE.md\` with typecheck, test, lint, build, migration, authorization, sanitisation and secret checks.\n` +
      `- CI runs dependency audit, migration consistency, type check, tests, build, E2E, lint and i18n checks (see \`.github/workflows/ci.yml\`).\n` +
      `- Releases are image-pinned; the previous known-good image is recorded in the ops runbook.\n\n` +
      `## Unavailable in this snapshot\n\n` +
      `GitHub branch protection, required reviewers, required status checks, organization 2FA enforcement and secret-scanning alerts require a GitHub admin export or API call. The collector does not use credentials. Attach the export separately.\n`,
  );

  markUnavailable(
    "U-01",
    "GitHub branch protection and organization settings",
    "Requires GitHub admin/API access. The collector does not use credentials.",
    "Platform Lead",
    "GitHub repository settings export",
  );
  markUnavailable(
    "U-02",
    "GitHub Actions run history and deployment approvals",
    "Hosted history is not stored in git and requires GitHub access.",
    "Engineering Lead",
    "GitHub Actions export",
  );
  markUnavailable(
    "U-03",
    "GitHub secret-scanning alerts and audit log",
    "Requires GitHub security settings/admin access.",
    "Platform Lead",
    "GitHub security settings export",
  );
}

function collectPolicySnapshot() {
  for (const relative of [
    "SECURITY.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
    ".env.example",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/dependabot.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/docker-publish.yml",
    "docker-compose.yml",
    "docker-compose.prod.yml",
    "Dockerfile",
    "docker-entrypoint.sh",
    "prisma/schema.prisma",
    "vitest.config.ts",
    "playwright.config.ts",
  ]) {
    copyRepo(relative);
  }

  copyRepoTree("docs/compliance");
  copyRepoTree("deploy");
  for (const relative of [
    "docs/OPERATIONS.md",
    "docs/BACKUP-RESTORE.md",
    "docs/audit-retention.md",
    "docs/privacy-erasure.md",
    "docs/AZURE.md",
    "docs/SECURITY.md",
  ]) {
    copyRepo(relative);
  }

  const policyFiles = walk(path.join(repoRoot, "docs/compliance"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.relative(repoRoot, file))
    .sort();

  const rows = policyFiles.map((relative) => {
    const hash = fileSha256(relative);
    return `| \`${relative}\` | \`${hash ?? "missing"}\` |`;
  });

  write(
    "policies/policy-hashes.md",
    `# Policy and document hashes\n\n` +
      `Generated at ${now.toISOString()}. These hashes prove the version in the pack, not approval.\n\n` +
      `| Document | SHA-256 |\n| --- | --- |\n${rows.join("\n")}\n`,
  );
}

function collectDependencies() {
  copyRepo("package.json");
  copyRepo("package-lock.json", "package-lock.json");
  write(
    "dependencies/package-lock.sha256",
    `${fileSha256("package-lock.json") ?? "missing"}  package-lock.json\n`,
  );

  const dependabot = safeExists(".github/dependabot.yml")
    ? excerpt(readRepo(".github/dependabot.yml"), 80)
    : "Dependabot configuration not found.";

  write(
    "dependencies/dependabot.md",
    `# Dependency update policy snapshot\n\n\`\`\`yaml\n${dependabot}\n\`\`\`\n\n` +
      `CI also runs \`npm audit --omit=dev\`. The image build is scanned with Trivy for Critical/High OS and library vulnerabilities.\n`,
  );

  if (options.skipAudit) {
    write(
      "dependencies/npm-audit-summary.md",
      `# npm audit\n\nStatus: **not run** (\`--skip-audit\` was used).\n\nRun \`npm audit --omit=dev --json\` or rerun the collector without \`--skip-audit\` in an environment with registry access.\n`,
    );
    markUnavailable(
      "U-04",
      "Dependency audit for this evidence pack",
      "Collector was run with --skip-audit.",
      "Platform Lead",
      "npm audit output",
    );
    return;
  }

  const audit = run("npm", ["audit", "--omit=dev", "--json"], {
    timeout: 180_000,
  });
  const jsonText = extractJsonObject(audit.stdout);
  let summary = "";
  let counts = null;

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      counts = parsed.metadata?.vulnerabilities ?? null;
      const vulnerabilities = parsed.vulnerabilities ?? {};
      const advisories = [];
      for (const [name, entry] of Object.entries(vulnerabilities)) {
        const via = Array.isArray(entry.via)
          ? entry.via
              .map((item) => (typeof item === "string" ? item : item.title || item.url || "advisory"))
              .join("; ")
          : String(entry.via ?? "");
        advisories.push({
          name,
          severity: entry.severity ?? "unknown",
          direct: Boolean(entry.isDirect),
          via: cell(via).slice(0, 300),
          fix: entry.fixAvailable
            ? typeof entry.fixAvailable === "object"
              ? `upgrade to ${entry.fixAvailable.name}@${entry.fixAvailable.version}`
              : "available"
            : "none",
        });
      }
      summary =
        `# npm audit (production dependencies)\n\n` +
        `Command: \`npm audit --omit=dev --json\`\n` +
        `Exit status: ${audit.status ?? "unknown"}\n` +
        `Generated: ${now.toISOString()}\n\n` +
        `| Severity | Count |\n| --- | --- |\n` +
        ["critical", "high", "moderate", "low", "info"]
          .map((severity) => `| ${severity} | ${counts?.[severity] ?? 0} |`)
          .join("\n") +
        `\n\n` +
        (advisories.length > 0
          ? `| Package | Severity | Direct | Advisory | Fix |\n| --- | --- | --- | --- | --- |\n` +
            advisories
              .map(
                (item) =>
                  `| ${cell(item.name)} | ${cell(item.severity)} | ${item.direct ? "yes" : "no"} | ${item.via} | ${cell(item.fix)} |`,
              )
              .join("\n") +
            `\n`
          : `No vulnerabilities reported in production dependencies.\n`) +
        `\nA clean audit is a point-in-time result, not a vulnerability management programme. Record the dated result and any accepted exceptions.\n`;
      writeJson("dependencies/npm-audit.json", {
        generatedAt: now.toISOString(),
        exitStatus: audit.status,
        counts,
        advisories,
      });
    } catch (error) {
      summary = `# npm audit\n\nStatus: **unavailable** — the output could not be parsed.\n\n${sanitize(error.message)}\n`;
    }
  } else {
    summary =
      `# npm audit\n\nStatus: **unavailable** — no JSON result was returned.\n\n` +
      `Exit status: ${audit.status ?? "unknown"}\n\n` +
      `\`\`\`\n${excerpt(audit.stderr || audit.stdout, 30)}\n\`\`\`\n\n` +
      `Run \`npm audit --omit=dev --json\` with registry access and attach the result.\n`;
    markUnavailable(
      "U-04",
      "Dependency audit for this evidence pack",
      "npm audit did not return JSON (network/registry or execution failure).",
      "Platform Lead",
      "npm audit output",
    );
  }

  write("dependencies/npm-audit-summary.md", summary);

  if (counts && (counts.critical > 0 || counts.high > 0)) {
    warnings.push(
      `npm audit reports ${counts.critical ?? 0} critical and ${counts.high ?? 0} high production vulnerabilities.`,
    );
  }
}

function extractJsonObject(value) {
  const text = String(value ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function collectCi() {
  const ci = safeExists(".github/workflows/ci.yml")
    ? readRepo(".github/workflows/ci.yml")
    : "";
  const jobs = [...ci.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)]
    .map((match) => match[1])
    .filter((name) => !["services", "env", "permissions", "concurrency"].includes(name));
  const steps = [...ci.matchAll(/^\s+- name:\s+(.+)$/gm)].map((match) => match[1].trim());

  write(
    "ci/ci-workflow-summary.md",
    `# CI workflow summary\n\n` +
      `Source: \`.github/workflows/ci.yml\`\n` +
      `SHA-256: \`${fileSha256(".github/workflows/ci.yml") ?? "missing"}\`\n\n` +
      `## Jobs detected\n\n${jobs.length > 0 ? jobs.map((job) => `- \`${job}\``).join("\n") : "- (none parsed)"}\n\n` +
      `## Steps detected\n\n${steps.length > 0 ? steps.map((step) => `- ${step}`).join("\n") : "- (none parsed)"}\n\n` +
      `## Important limitation\n\n` +
      `This is the committed workflow, not proof that it ran. The hosted run history is unavailable without GitHub credentials and must be exported separately.\n`,
  );

  if (safeExists("coverage/coverage-summary.json")) {
    try {
      const coverage = JSON.parse(readRepo("coverage/coverage-summary.json", 5_000_000));
      const total = coverage.total ?? {};
      const row = (key) =>
        `| ${key} | ${total[key]?.pct ?? "n/a"}% | ${total[key]?.covered ?? 0} | ${total[key]?.total ?? 0} |`;
      write(
        "ci/coverage-summary.md",
        `# Coverage summary\n\n` +
          `Source: \`coverage/coverage-summary.json\`\n\n` +
          `| Metric | Percent | Covered | Total |\n| --- | --- | --- | --- |\n` +
          `${row("lines")}\n${row("statements")}\n${row("functions")}\n${row("branches")}\n`,
      );
      copyRepo("coverage/coverage-summary.json");
    } catch (error) {
      warnings.push(`Coverage summary could not be parsed: ${sanitize(error.message)}`);
    }
  } else {
    write(
      "ci/coverage-summary.md",
      `# Coverage summary\n\nStatus: **unavailable** — no \`coverage/coverage-summary.json\` was present.\n\nRun \`npm run test:coverage\` and rerun the collector, or attach the CI coverage artifact.\n`,
    );
  }

  const testResultFiles = fs.existsSync(path.join(repoRoot, "test-results"))
    ? walk(path.join(repoRoot, "test-results"))
        .map((file) => path.relative(repoRoot, file))
        .sort()
    : [];

  write(
    "ci/test-artifacts.md",
    `# Test artifacts\n\n` +
      `Present locally: ${testResultFiles.length} file(s) under \`test-results/\`.\n\n` +
      (testResultFiles.length > 0
        ? testResultFiles.map((file) => `- \`${file}\``).join("\n")
        : "No local test artifacts were found. CI artifacts are external and must be exported.") +
      `\n\nA test artifact is evidence only if it is tied to the commit, environment and date.\n`,
  );

  if (options.runTests) {
    runLocalTests();
  } else {
    write(
      "ci/local-test-run.md",
      `# Local test run\n\nStatus: **not run** in this collector invocation.\n\n` +
        `Use \`--run-tests\` to run the local suite. CI is the authoritative gate; export the hosted run for audit evidence.\n`,
    );
    markUnavailable(
      "U-05",
      "Fresh local test result",
      "Collector was run without --run-tests.",
      "Engineering Lead",
      "CI artifact or npm test output",
    );
  }

  markUnavailable(
    "U-06",
    "CI/CD hosted run history and branch protection",
    "Requires GitHub access; not stored in the repository.",
    "Engineering Lead",
    "GitHub Actions export",
  );
}

function runLocalTests() {
  const resultPath = safePackPath("ci/vitest-results.json");
  const testRun = run(
    "npm",
    ["test", "--", "--reporter=json", `--outputFile=${resultPath}`],
    { timeout: 900_000 },
  );

  let summary = `# Local test run\n\nCommand: \`npm test -- --reporter=json\`\nExit status: ${testRun.status ?? "unknown"}\nGenerated: ${now.toISOString()}\n\n`;

  if (fs.existsSync(resultPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      summary +=
        `| Metric | Value |\n| --- | --- |\n` +
        `| Test files | ${parsed.numTotalTestSuites ?? "n/a"} |\n` +
        `| Tests | ${parsed.numTotalTests ?? "n/a"} |\n` +
        `| Passed | ${parsed.numPassedTests ?? "n/a"} |\n` +
        `| Failed | ${parsed.numFailedTests ?? "n/a"} |\n` +
        `| Pending | ${parsed.numPendingTests ?? "n/a"} |\n`;
      if ((parsed.numFailedTests ?? 0) > 0) {
        warnings.push("Local test run has failing tests.");
      }
    } catch (error) {
      summary += `\nThe JSON result could not be parsed: ${sanitize(error.message)}\n`;
    }
  } else {
    summary += `\nNo JSON result file was produced.\n`;
    markUnavailable(
      "U-05",
      "Fresh local test result",
      "The local test command did not produce a JSON result.",
      "Engineering Lead",
      "npm test output",
    );
  }

  if (!testRun.ok) {
    summary += `\n\`\`\`\n${excerpt(testRun.stderr || testRun.stdout, 60)}\n\`\`\`\n`;
  }

  write("ci/local-test-run.md", summary);
}

function collectOperations() {
  const envExample = safeExists(".env.example") ? readRepo(".env.example") : "";
  const keys = [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)]
    .map((match) => match[1])
    .filter((key) =>
      /^(BACKUP_|RETENTION_|AUDIT_|DATABASE_|NEXTAUTH_|APP_URL|REQUIRE_2FA|METRICS_|UPLOAD_|SMS_|SMTP_|TRUST_|ALLOW_DB_|API_KEY_|SCIM_|SSO_|CRON_|READY_|LOG_LEVEL|NODE_ENV|COMPOSE_FILE|POSTGRES_|UPLOADS_|TZ)/.test(
        key,
      ),
    )
    .filter((key, index, all) => all.indexOf(key) === index)
    .sort();

  const backupScript = safeExists("scripts/backup.sh") ? readRepo("scripts/backup.sh") : "";
  const backupLines = backupScript
    .split("\n")
    .filter((line) =>
      /BACKUP_|RETENTION_DAYS|NODE_ENV|umask|pg_dump|tar czf|sha256sum|rclone|REQUIRE_BACKUP_ENCRYPTION|AGE_RECIPIENT|AGE_IDENTITY/.test(
        line,
      ),
    )
    .slice(0, 80)
    .join("\n");

  const timers = fs.existsSync(path.join(repoRoot, "deploy/systemd"))
    ? fs
        .readdirSync(path.join(repoRoot, "deploy/systemd"))
        .filter((name) => name.endsWith(".timer"))
        .sort()
        .map((name) => {
          const content = fs.readFileSync(path.join(repoRoot, "deploy/systemd", name), "utf8");
          const calendar = content
            .split("\n")
            .filter((line) => /OnCalendar=|Persistent=|Unit=/.test(line))
            .join("; ");
          return `| \`${name}\` | ${cell(calendar || "no schedule parsed")} |`;
        })
        .join("\n")
    : "";

  write(
    "operations/backup-config.md",
    `# Backup configuration snapshot\n\n` +
      `Generated at ${now.toISOString()} from repository files only.\n\n` +
      `## Relevant environment variable names\n\n` +
      `${keys.length > 0 ? keys.map((key) => `- \`${key}\``).join("\n") : "- (none parsed)"}\n\n` +
      `Only names are listed; values are not read from \`.env\`. Placeholder values in \`.env.example\` are not production configuration.\n\n` +
      `## Backup script controls\n\n\`\`\`bash\n${excerpt(backupLines, 80)}\n\`\`\`\n\n` +
      `## Systemd timers\n\n| Timer | Schedule / unit |\n| --- | --- |\n${timers || "| (none) | (not found) |"}\n\n` +
      `## File hashes\n\n` +
      [
        "scripts/backup.sh",
        "scripts/restore-test.sh",
        "scripts/backup-freshness.sh",
        "deploy/systemd/fsm-backup.timer",
        "deploy/systemd/fsm-backup-check.timer",
        "deploy/systemd/fsm-restore-test.timer",
      ]
        .map((file) => `- \`${file}\`: \`${fileSha256(file) ?? "missing"}\``)
        .join("\n") +
      `\n\n## RPO/RTO and encryption\n\n` +
      `The target values and restore procedure are in \`docs/BACKUP-RESTORE.md\` and \`docs/OPERATIONS.md\`. Production backup encryption is enforced by \`scripts/backup.sh\` when \`NODE_ENV=production\` or \`REQUIRE_BACKUP_ENCRYPTION=true\` and \`BACKUP_AGE_RECIPIENT\` is missing.\n\n` +
      `## Runtime status unavailable\n\n` +
      `The latest backup status, checksum, age and restore-test result live on the production host. Attach \`backup-status.json\`, the relevant \`journalctl\` output and the restore-test log.\n`,
  );

  markUnavailable(
    "U-07",
    "Production backup status and freshness",
    "Requires host access; the repository only contains configuration.",
    "Operations Lead",
    "Backup status file and journal",
  );
  markUnavailable(
    "U-08",
    "Restore-test and DR exercise results",
    "Requires operations records; no dated result is stored in the repository.",
    "Operations Lead",
    "Restore-test log / DR report",
  );
  markUnavailable(
    "U-09",
    "Azure resource configuration and attestations",
    "Requires Azure portal/API access.",
    "Operations Lead",
    "Azure Service Trust Portal and portal export",
  );
  markUnavailable(
    "U-10",
    "TLS certificate and external attack-surface scan",
    "Requires production network access.",
    "Operations Lead",
    "TLS scan and external scan report",
  );

  const rpo = extractSection("docs/BACKUP-RESTORE.md", "### 3.1 Anbefalte mål", 20);
  if (rpo) {
    write(
      "operations/rpo-rto-excerpt.md",
      `# RPO/RTO excerpt\n\nSource: \`docs/BACKUP-RESTORE.md\` §3.1.\n\n\`\`\`markdown\n${sanitize(rpo)}\n\`\`\`\n\nPlanning targets are not measured results. Record the measured RTO from an exercise.\n`,
    );
  }
}

function extractSection(relativePath, heading, maxLines) {
  if (!safeExists(relativePath)) return "";
  const lines = readRepo(relativePath).split("\n");
  const start = lines.findIndex((line) => line.trim() === heading.trim());
  if (start === -1) return "";
  const result = [];
  for (let index = start; index < lines.length && result.length < maxLines; index += 1) {
    const line = lines[index];
    if (index > start && /^#{2,3}\s/.test(line)) break;
    result.push(line);
  }
  return result.join("\n");
}

function collectAuditRetention() {
  const code = safeExists("src/server/audit-retention.ts")
    ? readRepo("src/server/audit-retention.ts")
    : "";
  const relevant = code
    .split("\n")
    .filter((line) =>
      /DEFAULT|365|AUDIT_RETENTION_DAYS|retentionDays|clampRetentionDays|legalHold|AuditHold|tombstone|purge/i.test(
        line,
      ),
    )
    .slice(0, 80)
    .join("\n");

  const schema = safeExists("prisma/schema.prisma")
    ? readRepo("prisma/schema.prisma")
    : "";
  const models = ["AuditLog", "AuditHold", "AuditPurgedHash", "AuditRetentionSetting"]
    .map((model) => {
      const regex = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
      const match = schema.match(regex);
      return match ? `### ${model}\n\n\`\`\`prisma\n${match[0]}\n\`\`\`` : `### ${model}\n\nModel not found.`;
    })
    .join("\n\n");

  write(
    "operations/audit-retention.md",
    `# Audit-retention configuration snapshot\n\n` +
      `Generated at ${now.toISOString()} from code and documentation, not from the production database.\n\n` +
      `## Defaults and code references\n\n\`\`\`ts\n${excerpt(relevant, 80)}\n\`\`\`\n\n` +
      `## Schema models\n\n${models}\n\n` +
      `## Runtime value\n\n` +
      `The actual \`AuditRetentionSetting.retentionDays\` value is in the production database. It is not read by this collector. Export it from **Innstillinger → Revisjonslogg** or query the setting read-only.\n\n` +
      `## Controls\n\n` +
      `- Default retention is 365 days unless configured otherwise.\n` +
      `- Audit holds and report/job \`legalHold\` override deletion.\n` +
      `- The retention job writes tombstones so the hash chain remains verifiable.\n` +
      `- Runtime may insert audit rows but should not update or delete them.\n\n` +
      `## File hashes\n\n` +
      [
        "src/server/audit-retention.ts",
        "src/lib/audit.ts",
        "src/server/audit-export.ts",
        "src/server/evidence-export.ts",
        "docs/audit-retention.md",
        "docs/privacy-erasure.md",
      ]
        .map((file) => `- \`${file}\`: \`${fileSha256(file) ?? "missing"}\``)
        .join("\n") +
      `\n`,
  );

  markUnavailable(
    "U-11",
    "Production audit-retention setting",
    "Requires database/application access; the collector does not read production data.",
    "Operations Lead",
    "Settings export or read-only query",
  );
  markUnavailable(
    "U-12",
    "Audit-chain verification result for production",
    "Requires database access and the production audit dataset.",
    "Operations Lead",
    "npm run audit:verify output",
  );
}

function collectAccessReview() {
  const template = safeExists("docs/compliance/templates/ACCESS-REVIEW.md")
    ? readRepo("docs/compliance/templates/ACCESS-REVIEW.md")
    : "# Access review template unavailable\n";
  write(
    "access-review/access-review-template.md",
    `# Access review working copy\n\n` +
      `Generated ${now.toISOString()}. Complete it with the production population and exports.\n\n` +
      `Period: \`[YYYY-QN]\`\nReviewer: \`[Name]\`\nApprover: \`[Name]\`\n\n` +
      `---\n\n${template}\n`,
  );

  markUnavailable(
    "U-13",
    "Completed access review and identity exports",
    "Requires IdP/application/cloud/GitHub access; no completed review is stored in the repository.",
    "Operations Lead",
    "Access-review export and signed template",
  );
}

function collectSecretScanning() {
  const configFiles = [
    ".gitleaks.toml",
    ".github/secret_scanning.yml",
    ".trufflehog.yml",
    ".pre-commit-config.yaml",
    "detect-secrets.cfg",
  ].filter((file) => safeExists(file));

  const trackedSensitive = git(["ls-files"], { timeout: 30_000 })
    .stdout.split("\n")
    .filter((file) =>
      /(^|\/)(\.env($|\.)|[^/]+\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials(\.(json|ya?ml|txt))?)$/i.test(
        file,
      ),
    )
    .filter((file) => !file.endsWith(".env.example") && !file.endsWith(".env.e2e.example"));

  const patterns = [
    ["aws-access-key", "AKIA[0-9A-Z]{16}"],
    ["github-token", "gh[pousr]_[A-Za-z0-9]{20,}"],
    ["github-pat", "github_pat_[A-Za-z0-9_]{20,}"],
    ["stripe-live-key", "sk_live_[0-9a-zA-Z]{16,}"],
    ["slack-token", "xox[baprs]-[A-Za-z0-9-]{10,}"],
    ["private-key", "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"],
    ["google-api-key", "AIza[0-9A-Za-z_-]{35}"],
    ["npm-token", "npm_[A-Za-z0-9]{20,}"],
    ["postgres-url-with-password", "postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@"],
  ];

  const findings = [];
  for (const [name, pattern] of patterns) {
    const result = run("git", ["grep", "-I", "-c", "-E", "-e", pattern, "--", "."], {
      timeout: 30_000,
    });
    if (result.stdout.trim()) {
      const files = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const lastColon = line.lastIndexOf(":");
          return lastColon > 0
            ? `\`${line.slice(0, lastColon)}\` (${line.slice(lastColon + 1)} match(es))`
            : `\`${line}\``;
        });
      findings.push({ name, files });
    }
    // A non-zero exit with no stdout is the normal "no match" case.
  }

  const gitignore = safeExists(".gitignore") ? readRepo(".gitignore") : "";
  const ignoreLines = gitignore
    .split("\n")
    .filter((line) => /env|backup|upload|secret|key|pem/i.test(line))
    .slice(0, 40)
    .join("\n");

  write(
    "security/secret-scanning.md",
    `# Secret-scanning status\n\n` +
      `Generated at ${now.toISOString()}.\n\n` +
      `## Tool configuration found in the repository\n\n` +
      `${configFiles.length > 0 ? configFiles.map((file) => `- \`${file}\``).join("\n") : "- No gitleaks/trufflehog/detect-secrets/pre-commit secret-scanning configuration found."}\n\n` +
      `## GitHub secret scanning\n\n` +
      `**Unavailable.** GitHub secret-scanning alerts, push protection and the audit log require GitHub admin access. Export them separately.\n\n` +
      `## Tracked files that look sensitive\n\n` +
      `${trackedSensitive.length > 0 ? trackedSensitive.map((file) => `- \`${file}\``).join("\n") : "- None detected by filename pattern (excluding example env files)."}\n\n` +
      `## Heuristic content scan (paths and counts only)\n\n` +
      `This is a local pattern scan, not a substitute for GitHub secret scanning or gitleaks. It never prints matched content. Documentation examples and test fixtures can produce false positives; review the paths, do not assume a live secret. In particular, \`postgres-url-with-password\` matches in \`.env.example\`, CI, deployment examples and docs are expected placeholders unless the file is a real runtime configuration.\n\n` +
      (findings.length > 0
        ? findings
            .map((finding) => `### ${finding.name}\n\n${finding.files.map((file) => `- ${file}`).join("\n")}`)
            .join("\n\n")
        : "No pattern matches were reported by the heuristic scan.") +
      `\n\n## Relevant .gitignore rules\n\n\`\`\`gitignore\n${excerpt(ignoreLines, 40)}\n\`\`\`\n\n` +
      `## Required evidence\n\n` +
      `- GitHub secret-scanning alert export (including zero-alert confirmation).\n` +
      `- Push-protection setting.\n` +
      `- Any gitleaks/trufflehog CI run result.\n` +
      `- Secret rotation record for any confirmed finding.\n`,
  );

  markUnavailable(
    "U-14",
    "GitHub secret-scanning alerts and push protection",
    "Requires GitHub security settings/admin access.",
    "Platform Lead",
    "GitHub security export",
  );
  if (findings.some((finding) => finding.name !== "postgres-url-with-password")) {
    warnings.push(
      `Heuristic secret scan reported matches in ${findings.length} pattern group(s); review paths in security/secret-scanning.md.`,
    );
  }
}

function collectTechnicalControls() {
  const files = [
    ["Access control and permissions", "src/lib/permissions.ts"],
    ["Authentication options", "src/lib/auth-options.ts"],
    ["API authentication", "src/lib/api-auth.ts"],
    ["Upload handling", "src/lib/uploads.ts"],
    ["Audit hash chain", "src/lib/audit.ts"],
    ["Audit retention", "src/server/audit-retention.ts"],
    ["Evidence export", "src/server/evidence-export.ts"],
    ["Database schema", "prisma/schema.prisma"],
    ["Backup script", "scripts/backup.sh"],
    ["Restore test", "scripts/restore-test.sh"],
    ["Backup freshness", "scripts/backup-freshness.sh"],
    ["Break-glass 2FA", "scripts/break-glass-2fa.mjs"],
    ["CI pipeline", ".github/workflows/ci.yml"],
    ["Release workflow", ".github/workflows/docker-publish.yml"],
    ["Dependency updates", ".github/dependabot.yml"],
    ["Security policy", "SECURITY.md"],
    ["Operations runbook", "docs/OPERATIONS.md"],
    ["Backup/restore runbook", "docs/BACKUP-RESTORE.md"],
    ["Audit retention runbook", "docs/audit-retention.md"],
    ["Privacy erasure runbook", "docs/privacy-erasure.md"],
    ["Monitoring guide", "deploy/monitoring/README.md"],
    ["Systemd backup units", "deploy/systemd/README.md"],
    ["Proxy configuration", "deploy/proxy/Caddyfile"],
    ["Production compose", "docker-compose.prod.yml"],
  ];

  const rows = files.map(([label, file]) => {
    const exists = safeExists(file);
    return `| ${cell(label)} | \`${file}\` | ${exists ? "yes" : "no"} | \`${exists ? fileSha256(file) : "missing"}\` |`;
  });

  write(
    "controls/technical-evidence.md",
    `# Technical control evidence index\n\n` +
      `Generated at ${now.toISOString()} from repository files. A hash proves the file version in this pack; it does not prove the control operated in production.\n\n` +
      `| Control area | File | Present | SHA-256 |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n` +
      `## Notes\n\n` +
      `- Access control, audit, backup, CI and monitoring evidence is repository-backed.\n` +
      `- Production configuration, cloud settings, IdP exports, access reviews and restore results must be attached from the owning system.\n` +
      `- See \`docs/compliance/ISO27001-SOA.md\` for the control-by-control status and basis.\n`,
  );
}

function collectCoverageCounts() {
  const soaPath = "docs/compliance/ISO27001-SOA.md";
  const socPath = "docs/compliance/SOC2-TSC-MAPPING.md";
  if (!safeExists(soaPath) || !safeExists(socPath)) return;

  const soaRows = readRepo(soaPath)
    .split("\n")
    .filter((line) => /^\| (5|6|7|8)\.\d+ \|/.test(line));
  const socRows = readRepo(socPath)
    .split("\n")
    .filter((line) => /^\| (CC\d|A1|C1|PI1|P1)[^|]*\|/.test(line));

  const count = (rows, index) => {
    const result = {};
    for (const row of rows) {
      const columns = row.split("|").map((value) => value.trim());
      const key = columns[index] || "(blank)";
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  };

  const soaStatus = count(soaRows, 5);
  const soaBasis = count(soaRows, 6);
  const socStatus = count(socRows, 4);
  const socCategory = {};
  for (const row of socRows) {
    const id = row.split("|")[1].trim();
    const category = id.startsWith("CC") ? "Security (CC)" : id.split(".")[0];
    socCategory[category] = (socCategory[category] || 0) + 1;
  }

  const table = (values) =>
    Object.entries(values)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `| ${cell(key)} | ${value} |`)
      .join("\n");

  write(
    "controls/coverage-counts.md",
    `# Control coverage counts\n\n` +
      `Computed from the SoA and SOC 2 mapping at ${now.toISOString()}. These are design/readiness counts, not audit results.\n\n` +
      `## ISO/IEC 27001:2022 Annex A\n\n` +
      `Controls found: **${soaRows.length}** (expected 93).\n\n` +
      `| Status | Count |\n| --- | --- |\n${table(soaStatus)}\n\n` +
      `| Evidence basis | Count |\n| --- | --- |\n${table(soaBasis)}\n\n` +
      `## SOC 2 Trust Services Criteria\n\n` +
      `Criteria found: **${socRows.length}** (expected 51).\n\n` +
      `| Status | Count |\n| --- | --- |\n${table(socStatus)}\n\n` +
      `| Category | Criteria |\n| --- | --- |\n${table(socCategory)}\n\n` +
      `A count is not a certification. See \`docs/compliance/GAP-ANALYSIS.md\` for open gaps.\n`,
  );
}

function writeUnavailable() {
  write(
    "unavailable.md",
    `# Evidence not collected by this pack\n\n` +
      `Generated at ${now.toISOString()}. These items require credentials, production\n` +
      `access, external systems or human records. They are marked unavailable by design;\n` +
      `do not treat their absence as a failed control without checking the source system.\n\n` +
      `| ID | Evidence | Why unavailable | Owner | Source to attach |\n| --- | --- | --- | --- | --- |\n` +
      unavailable
        .map(
          (item) =>
            `| ${cell(item.id)} | ${cell(item.item)} | ${cell(item.reason)} | ${cell(item.owner)} | ${cell(item.source)} |`,
        )
        .join("\n") +
      `\n\n## Evidence that must never be placed in this pack\n\n` +
      `- passwords, API keys, session cookies or private keys;\n` +
      `- unredacted customer personal data;\n` +
      `- raw production database dumps;\n` +
      `- backup files or age identities;\n` +
      `- HR records beyond a redacted extract.\n`,
  );
}

function writePackReadme(metadata) {
  const files = listPackFiles();
  const policyCount = files.filter(
    (file) =>
      (file.startsWith("policies/") || file.startsWith("snapshot/docs/compliance/")) &&
      file.endsWith(".md"),
  ).length;
  const warningText =
    warnings.length > 0
      ? `\n## Warnings\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n`
      : "\n## Warnings\n\nNone.\n";

  write(
    "EVIDENCE-PACK.md",
    `# Compliance evidence pack\n\n` +
      `**Generated:** ${now.toISOString()}\n` +
      `**Collector version:** ${collectorVersion}\n` +
      `**Repository:** \`${metadata.repository.name}\`\n` +
      `**Branch:** \`${metadata.repository.branch}\`\n` +
      `**Commit:** \`${metadata.repository.head}\`\n` +
      `**Working tree dirty:** ${metadata.repository.dirty ? "yes" : "no"}\n` +
      `**Label:** ${metadata.label ? `\`${metadata.label}\`` : "(none)"}\n\n` +
      `## What this pack is\n\n` +
      `A dated snapshot of repository, git, CI configuration, dependency, backup,\n` +
      `audit-retention, access-review and secret-scanning evidence for the FSM\n` +
      `Platform. It is **not** a certification, audit opinion or legal conclusion.\n` +
      `An accredited ISO/IEC 27001 certification body and an independent CPA firm are\n` +
      `required. See \`docs/compliance/GAP-ANALYSIS.md\`.\n\n` +
      `## Contents\n\n` +
      `| Area | Files |\n| --- | --- |\n` +
      `| Metadata and git | \`metadata.json\`, \`git/\` |\n` +
      `| Policies and snapshots | \`policies/\`, \`snapshot/\` |\n` +
      `| Dependencies | \`dependencies/\` |\n` +
      `| CI and tests | \`ci/\` |\n` +
      `| Operations | \`operations/\` |\n` +
      `| Access review working copy | \`access-review/\` |\n` +
      `| Secret scanning | \`security/\` |\n` +
      `| Technical controls | \`controls/\` |\n` +
      `| Unavailable evidence | \`unavailable.md\` |\n` +
      `| Integrity | \`MANIFEST.sha256\`, \`manifest.json\` |\n\n` +
      `Policy files hashed: ${policyCount}. Total generated files: ${files.length}. Write operations: ${collected}.\n` +
      warningText +
      `\n## Safety\n\n` +
      `The collector reads whitelisted repository files only. It does not read\n` +
      `\`.env\`, backups, uploads, private keys or production data, and it does not use\n` +
      `cloud credentials. Generated reports are sanitized and do not print secret\n` +
      `values. Snapshot files are byte-identical repository copies (excluding\n` +
      `\`.env\`/keys); they may contain test placeholders, so review the pack before\n` +
      `sharing it outside the organisation.\n\n` +
      `## What this pack does not prove\n\n` +
      `- that a control operated throughout an observation period;\n` +
      `- that access was reviewed, a supplier DPA was signed or training happened;\n` +
      `- that a restore succeeded, an incident was handled or a vulnerability was\n` +
      `  remediated within SLA;\n` +
      `- that GitHub branch protection, secret scanning or cloud configuration is\n` +
      `  correct. Attach those exports.\n\n` +
      `## Verification\n\n` +
      `From this directory:\n\n` +
      `\`\`\`bash\nsha256sum -c MANIFEST.sha256\n\`\`\`\n\n` +
      `The manifest excludes itself. Compare the commit and branch with the\n` +
      `deployment record before relying on the pack.\n`,
  );
}

function listPackFiles() {
  return walk(packDir)
    .map((file) => path.relative(packDir, file))
    .filter((file) => file !== "MANIFEST.sha256" && file !== "manifest.json")
    .sort();
}

function writeManifest() {
  const entries = listPackFiles().map((relative) => {
    const absolute = path.join(packDir, relative);
    const content = fs.readFileSync(absolute);
    return {
      path: relative,
      bytes: content.length,
      sha256: sha256(content),
    };
  });

  writeJson("manifest.json", {
    generatedAt: now.toISOString(),
    collectorVersion,
    files: entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  });

  const lines = entries.map((entry) => `${entry.sha256}  ${entry.path}`);
  fs.writeFileSync(path.join(packDir, "MANIFEST.sha256"), `${lines.join("\n")}\n`, "utf8");
}

function printSummary(metadata) {
  const totalFiles = listPackFiles().length;
  console.log(`Compliance evidence pack written to: ${packDir}`);
  console.log(`Commit: ${metadata.repository.head} (${metadata.repository.branch})`);
  console.log(`Files: ${totalFiles}; unavailable items: ${unavailable.length}; warnings: ${warnings.length}`);
  if (warnings.length > 0) {
    for (const warning of warnings) console.log(`WARNING: ${warning}`);
  }
  console.log("This pack is not a certification or audit report.");
}

function safeExists(relativePath) {
  try {
    return fs.existsSync(path.join(repoRoot, relativePath));
  } catch {
    return false;
  }
}

function cell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}
