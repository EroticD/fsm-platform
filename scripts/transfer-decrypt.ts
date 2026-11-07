#!/usr/bin/env node
// Dekrypterer en .fsmenc-fil til en vanlig ZIP som kan lastes opp i
// importflyten. Passfrasen leses fra TRANSFER_PASSPHRASE eller stdin.
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { decryptPackageBuffer } from "../src/lib/customer-transfer/encryption";

async function passphraseFromStdin(): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return (await rl.question("Passfrase: ")).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [, , source, target] = process.argv;
  if (!source || !target) {
    console.error(
      "Bruk: npm run transfer:decrypt -- <pakke.fsmenc> <pakke.zip>",
    );
    process.exitCode = 2;
    return;
  }
  const passphrase =
    process.env.TRANSFER_PASSPHRASE ??
    (process.argv.includes("--passphrase-stdin")
      ? await passphraseFromStdin()
      : "");
  if (!passphrase) {
    console.error("Passfrase mangler. Bruk TRANSFER_PASSPHRASE eller --passphrase-stdin.");
    process.exitCode = 2;
    return;
  }

  const envelope = await fs.readFile(path.resolve(source));
  try {
    const decrypted = decryptPackageBuffer(envelope, passphrase);
    await fs.writeFile(path.resolve(target), decrypted, { mode: 0o600 });
    console.log(
      `Dekryptert pakke skrevet til ${path.resolve(target)} (${decrypted.length} byte).`,
    );
  } catch {
    // Ikke skriv ut passfrasen eller krypto-detaljer som kan hjelpe en angriper.
    console.error("Kunne ikke dekryptere pakken. Kontroller passfrase og fil.");
    process.exitCode = 1;
  }
}

void main();
