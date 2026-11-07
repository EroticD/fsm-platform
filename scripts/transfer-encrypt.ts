#!/usr/bin/env node
// Krypterer en ferdig kundepakke (ZIP) til en passfrasebeskyttet .fsmenc-fil.
// Passfrasen leses fra TRANSFER_PASSPHRASE, eller fra stdin med
// --passphrase-stdin. Den skrives aldri til disk eller logg.
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  MIN_PASSPHRASE_LENGTH,
  encryptPackageBuffer,
} from "../src/lib/customer-transfer/encryption";

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
      "Bruk: npm run transfer:encrypt -- <pakke.zip> <pakke.fsmenc>",
    );
    process.exitCode = 2;
    return;
  }
  const passphrase =
    process.env.TRANSFER_PASSPHRASE ??
    (process.argv.includes("--passphrase-stdin")
      ? await passphraseFromStdin()
      : "");
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    console.error(
      `Passfrasen må være minst ${MIN_PASSPHRASE_LENGTH} tegn. Bruk TRANSFER_PASSPHRASE eller --passphrase-stdin.`,
    );
    process.exitCode = 2;
    return;
  }

  const buffer = await fs.readFile(path.resolve(source));
  const encrypted = encryptPackageBuffer(buffer, passphrase);
  await fs.writeFile(path.resolve(target), encrypted, { mode: 0o600 });
  console.log(
    `Kryptert pakke skrevet til ${path.resolve(target)} (${encrypted.length} byte).`,
  );
}

void main();
