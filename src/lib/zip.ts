import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal, deterministisk ZIP-skriver/leser for bevis- og revisjonseksport.
 *
 * Prosjektet har ingen ZIP-avhengighet, og eksporten trenger bare en liten,
 * godt definert delmengde av formatet: filer uten kryptering, med DEFLATE
 * eller STORE. Skrivelogikken setter faste tidsstempler og UTF-8-flagg, slik
 * at samme innhold gir samme arkiv. Leseren brukes av verifiseringen og
 * avviser baner med `..`, absolutte baner og altfor store oppføringer.
 */

export type ZipEntryInput = {
  /** Relativ bane inne i arkivet. Skråstrek som skilletegn. */
  path: string;
  data: Buffer;
  /** Valgfritt tidsstempel. Standard er 1980-01-01 for reproduserbare arkiv. */
  modifiedAt?: Date;
};

export type ZipEntry = {
  path: string;
  data: Buffer;
  method: number;
  crc32: number;
  /** Komprimert størrelse fra sentralkatalogen. Brukes til bombekontroll. */
  compressedSize: number;
};

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const MAX_COMPRESSION_RATIO = 100;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Avviser arkivbaner som kan skrive utenfor utpakingsmappen. */
export function isSafeZipPath(entryPath: string): boolean {
  if (!entryPath || entryPath.length > 512) return false;
  if (entryPath.startsWith("/") || entryPath.startsWith("\\")) return false;
  if (entryPath.includes("\\") || entryPath.includes("\u0000")) return false;
  const segments = entryPath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  // Windows-stasjoner og UNC-lignende navn skal aldri kunne tolkes som absolutte.
  return !/^[A-Za-z]:/.test(entryPath);
}

function dosDateTime(date: Date): { time: number; date: number } {
  const safe = Number.isNaN(date.getTime()) ? new Date(0) : date;
  const year = Math.max(1980, safe.getUTCFullYear());
  const month = safe.getUTCMonth() + 1;
  const day = safe.getUTCDate();
  const hours = safe.getUTCHours();
  const minutes = safe.getUTCMinutes();
  const seconds = Math.floor(safe.getUTCSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function writeUInt32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function writeUInt16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

/**
 * Bygger et ZIP-arkiv. Returnerer en Buffer, slik at rutene kan sende det
 * direkte uten å skrive mellomlagringsfiler på disk.
 */
export function createZip(entries: readonly ZipEntryInput[]): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error("For mange filer i arkivet");
  }

  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  let totalBytes = 0;

  for (const entry of entries) {
    if (!isSafeZipPath(entry.path)) {
      throw new Error(`Utrygg filbane i arkivet: ${entry.path}`);
    }
    if (seen.has(entry.path)) {
      throw new Error(`Duplikat filbane i arkivet: ${entry.path}`);
    }
    seen.add(entry.path);

    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    totalBytes += data.length;
    if (data.length > MAX_ENTRY_BYTES || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error("Arkivet er for stort");
    }

    const crc = crc32(data);
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    if (
      useDeflate &&
      compressed.length > 0 &&
      data.length / compressed.length > MAX_COMPRESSION_RATIO
    ) {
      throw new Error(`Kompresjonsforholdet er for høyt for ${entry.path}`);
    }
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(
      entry.modifiedAt ?? new Date(Date.UTC(1980, 0, 1)),
    );
    const name = Buffer.from(entry.path, "utf8");

    const local = Buffer.concat([
      writeUInt32(LOCAL_FILE_HEADER),
      writeUInt16(20), // version needed
      writeUInt16(UTF8_FLAG),
      writeUInt16(method),
      writeUInt16(time),
      writeUInt16(date),
      writeUInt32(crc),
      writeUInt32(payload.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0), // extra
      name,
      payload,
    ]);
    localParts.push(local);

    const central = Buffer.concat([
      writeUInt32(CENTRAL_DIRECTORY),
      writeUInt16(20), // version made by
      writeUInt16(20), // version needed
      writeUInt16(UTF8_FLAG),
      writeUInt16(method),
      writeUInt16(time),
      writeUInt16(date),
      writeUInt32(crc),
      writeUInt32(payload.length),
      writeUInt32(data.length),
      writeUInt16(name.length),
      writeUInt16(0), // extra
      writeUInt16(0), // comment
      writeUInt16(0), // disk
      writeUInt16(0), // internal attributes
      writeUInt32(0), // external attributes
      writeUInt32(offset),
      name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    writeUInt32(END_OF_CENTRAL_DIRECTORY),
    writeUInt16(0), // disk
    writeUInt16(0), // central directory disk
    writeUInt16(entries.length),
    writeUInt16(entries.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0), // comment
  ]);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= minimum; index -= 1) {
    if (buffer.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) return index;
  }
  return -1;
}

/**
 * Leser et ZIP-arkiv laget av `createZip` (eller et vanlig ukomprimert/
 * deflatert arkiv). Kaster en feil ved ugyldig struktur eller utrygge baner.
 */
export function readZip(buffer: Buffer): ZipEntry[] {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error("Ugyldig ZIP-arkiv");
  }
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw new Error("Fant ikke ZIP-sentralkatalogen");
  // Arkivet skal slutte nøyaktig ved EOCD. Data etter sentralkatalogen kan
  // være en sammenslått eller manipulert ZIP og avvises.
  if (endOffset + 22 !== buffer.length) {
    throw new Error("Ugyldig ZIP-arkiv");
  }

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  if (entryCount > MAX_ENTRIES) throw new Error("For mange filer i arkivet");
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (centralOffset >= buffer.length) throw new Error("Ugyldig sentralkatalog");

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let cursor = centralOffset;
  const seenPaths = new Set<string>();

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY) {
      throw new Error("Ugyldig oppføring i sentralkatalogen");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    // Bit 0 markerer krypterte oppføringer. V1 støtter ikke krypterte ZIP-er;
    // en «passordbeskyttet» ZIP er svak kryptering og avvises bevisst.
    if ((flags & 0x0001) !== 0) {
      throw new Error("Krypterte arkiv støttes ikke");
    }
    // Unix-modus ligger i de øvre 16 bitene av external attributes. Symlinker
    // (0xA000) skal aldri pakkes ut eller følges.
    const unixMode = (buffer.readUInt32LE(cursor + 38) >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error("Symlink i arkivet støttes ikke");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error("Ugyldig filnavn i arkivet");
    const entryPath = buffer.subarray(nameStart, nameEnd).toString("utf8");
    if (!isSafeZipPath(entryPath)) {
      throw new Error(`Utrygg filbane i arkivet: ${entryPath}`);
    }
    if (seenPaths.has(entryPath)) {
      throw new Error(`Duplikat filbane i arkivet: ${entryPath}`);
    }
    seenPaths.add(entryPath);

    if (localOffset + 30 > buffer.length) throw new Error("Ugyldig lokal header");
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new Error("Ugyldig lokal filheader");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("Ugyldig fildata i arkivet");

    const payload = buffer.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(payload);
    } else if (method === 8) {
      data = inflateRawSync(payload);
    } else {
      throw new Error(`Ukjent komprimeringsmetode: ${method}`);
    }

    if (data.length !== uncompressedSize || data.length > MAX_ENTRY_BYTES) {
      throw new Error("Feil størrelse i arkivet");
    }
    // Kompresjonsbombe: svært høy ratio regnes som ondsinnet. JSON komprimeres
    // typisk 5–20x, så 100:1 er romslig for legitime pakker.
    if (
      compressedSize > 0 &&
      data.length / compressedSize > MAX_COMPRESSION_RATIO
    ) {
      throw new Error(`Kompresjonsforholdet er for høyt for ${entryPath}`);
    }
    if (crc32(data) !== crc) throw new Error(`CRC-feil for ${entryPath}`);
    totalBytes += data.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Arkivet er for stort");

    entries.push({
      path: entryPath,
      data,
      method,
      crc32: crc,
      compressedSize,
    });
    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}
