import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFile), "..");
const outputRoot = join(projectRoot, "dist");
const portableRoot = join(outputRoot, "chungbuk-inventory-portable");
const args = new Set(process.argv.slice(2));
const releaseMode = args.has("--release");
const archiveName = releaseMode
  ? "chungbuk-inventory-portable-release.zip"
  : "chungbuk-inventory-portable-dev.zip";
const archivePath = join(outputRoot, archiveName);
const crcTable = createCrcTable();

runNodeScript("prepare-portable.mjs");
runNodeScript(
  "validate-portable.mjs",
  releaseMode ? ["--require-runtime", "--require-launcher-exe"] : []
);

mkdirSync(outputRoot, { recursive: true });
writeZipArchive(portableRoot, archivePath);
runNodeScript(
  "validate-portable.mjs",
  ["--zip", archivePath, ...(releaseMode ? ["--require-runtime", "--require-launcher-exe"] : [])]
);
console.log(`Portable archive written: ${archivePath}`);

function runNodeScript(scriptName, scriptArgs = []) {
  const result = spawnSync(process.execPath, [join(projectRoot, "scripts", scriptName), ...scriptArgs], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function writeZipArchive(sourceRoot, targetPath) {
  const entries = listZipEntries(sourceRoot);
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const localHeader = createLocalFileHeader(entry);
    fileParts.push(localHeader, entry.data);
    centralParts.push(createCentralDirectoryHeader(entry, offset));
    offset += localHeader.length + entry.data.length;
  }

  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = createEndOfCentralDirectory(entries.length, centralDirectory.length, centralOffset);
  writeFileSync(targetPath, Buffer.concat([...fileParts, centralDirectory, endRecord]));
}

function listZipEntries(sourceRoot) {
  const entries = [];
  visit(sourceRoot);
  return entries.sort((left, right) => left.name.localeCompare(right.name));

  function visit(currentPath) {
    for (const dirent of readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = join(currentPath, dirent.name);
      const archiveName = toArchivePath(relative(sourceRoot, fullPath));
      if (dirent.isDirectory()) {
        const directoryName = `${archiveName}/`;
        entries.push(createEntry(directoryName, Buffer.alloc(0), true));
        visit(fullPath);
      } else if (dirent.isFile()) {
        entries.push(createEntry(archiveName, readFileSync(fullPath), false, statSync(fullPath).mode));
      }
    }
  }
}

function createEntry(name, data, isDirectory, mode = 0o100644) {
  return {
    name,
    nameBuffer: Buffer.from(name, "utf8"),
    data,
    crc: isDirectory ? 0 : crc32(data),
    mode: isDirectory ? 0o40755 : mode
  };
}

function toArchivePath(path) {
  return path.split(sep).join("/");
}

function createLocalFileHeader(entry) {
  const header = Buffer.alloc(30 + entry.nameBuffer.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(entry.nameBuffer.length, 26);
  header.writeUInt16LE(0, 28);
  entry.nameBuffer.copy(header, 30);
  return header;
}

function createCentralDirectoryHeader(entry, offset) {
  const header = Buffer.alloc(46 + entry.nameBuffer.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(entry.nameBuffer.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(((entry.mode & 0xffff) * 0x10000) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  entry.nameBuffer.copy(header, 46);
  return header;
}

function createEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
