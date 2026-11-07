#!/usr/bin/env node
// Kjører avstemming og opprydding av kundeoverføringer manuelt. Trygg å
// gjenta: bare filer i en transferjobs egen filliste vurderes, og refererte
// filer slettes aldri.
import { cleanupExpiredTransfers } from "../src/lib/customer-transfer/jobs";
import { reconcileTransferFiles } from "../src/lib/customer-transfer/reconcile";

async function main(): Promise<void> {
  const reconciled = await reconcileTransferFiles();
  const expired = await cleanupExpiredTransfers();
  console.log(
    JSON.stringify(
      {
        reconciled,
        expiredJobs: expired,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(
    "Avstemming feilet:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
