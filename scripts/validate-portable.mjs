import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFile), "..");
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const zipArgIndex = rawArgs.indexOf("--zip");
const zipTarget = zipArgIndex === -1 ? null : rawArgs[zipArgIndex + 1];
const targetArg = rawArgs.find((arg, index) => {
  if (arg.startsWith("--")) {
    return false;
  }
  return index !== zipArgIndex + 1;
});
const portableRoot = resolve(
  targetArg ?? join(projectRoot, "dist", "chungbuk-inventory-portable")
);
const requireRuntime = args.has("--require-runtime");
const requireLauncherExe = args.has("--require-launcher-exe");

const failures = [];

if (args.has("--zip")) {
  validatePortableZip(resolve(zipTarget ?? ""));
} else {
  validatePortableFolder(portableRoot);
  await validatePortableModules(portableRoot);
}

if (failures.length > 0) {
  console.error("배포 폴더 검사에 실패했습니다:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  args.has("--zip")
    ? `배포 zip 검사 완료: ${resolve(zipTarget ?? "")}`
    : `배포 폴더 검사 완료: ${portableRoot}`
);

function validatePortableFolder(root) {
  expectFile(root, "START_CHUNGBUK_APP.cmd");
  expectFile(root, "VERIFY_CHUNGBUK_APP.cmd");
  expectFile(root, "BUILD_WINDOWS_LAUNCHER.cmd");
  expectWindowsBatchLineEndings(root, "START_CHUNGBUK_APP.cmd");
  expectWindowsBatchLineEndings(root, "VERIFY_CHUNGBUK_APP.cmd");
  expectWindowsBatchLineEndings(root, "BUILD_WINDOWS_LAUNCHER.cmd");
  expectFile(root, "package.json");
  expectFile(root, "APP_VERSION");
  expectFile(root, "사용자_사용안내.md");
  expectFile(root, "launcher/ChungbukInventoryLauncher.cs");
  expectFile(root, "src/app/server.js");
  expectFile(root, "src/db/repositories.js");
  expectFile(root, "src/db/schema.js");
  expectFile(root, "src/services/import-usage-history.js");
  expectFile(root, "src/services/read-models.js");
  expectFile(root, "src/services/xlsb-workbook-reader.js");
  expectFile(root, "src/services/xlsx-usage-history-parser.js");
  expectFile(root, "src/services/inventory-xlsx-export.js");
  expectFile(root, "src/ui/index.html");
  expectFile(root, "scripts/build-windows-launcher.ps1");
  expectFile(root, "scripts/start-portable.mjs");
  expectFile(root, "scripts/apply-windows-update.ps1");
  expectFile(root, "scripts/safe-database-copy.mjs");
  expectFile(root, "scripts/health-check-portable.mjs");
  expectFile(root, "scripts/verify-release-version.mjs");
  expectFile(root, "scripts/verify-portable-runtime.mjs");
  expectDirectory(root, "user-data/backups");
  validateVersionValues(
    readFileSync(join(root, "APP_VERSION"), "utf8"),
    readFileSync(join(root, "package.json"), "utf8")
  );

  if (existsSync(join(root, "data"))) {
    failures.push("배포 폴더에는 개발용 data/ 폴더가 들어가면 안 됩니다.");
  }

  for (const file of listFiles(join(root, "user-data"))) {
    if (file.endsWith(".sqlite") || file.endsWith(".db")) {
      failures.push(`배포용 user-data에는 데이터베이스 파일이 없어야 합니다: ${file}`);
    }
  }

  const runtimePath = join(root, "runtime", "node", "node.exe");
  if (requireRuntime && !existsSync(runtimePath)) {
    failures.push("배포 폴더에는 runtime/node/node.exe가 필요합니다.");
  }
  if (requireLauncherExe && !existsSync(join(root, "ChungbukInventory.exe"))) {
    failures.push("배포 폴더에는 ChungbukInventory.exe가 필요합니다.");
  }
}

function validatePortableZip(zipPath) {
  if (!zipTarget) {
    failures.push("--zip에는 압축 파일 경로가 필요합니다.");
    return;
  }
  if (!existsSync(zipPath) || !statSync(zipPath).isFile()) {
    failures.push(`zip 파일을 찾을 수 없습니다: ${zipPath}`);
    return;
  }

  const entries = listZipEntryNames(zipPath);
  const entrySet = new Set(entries);
  expectZipEntry(entrySet, "START_CHUNGBUK_APP.cmd");
  expectZipEntry(entrySet, "VERIFY_CHUNGBUK_APP.cmd");
  expectZipEntry(entrySet, "BUILD_WINDOWS_LAUNCHER.cmd");
  expectZipEntry(entrySet, "package.json");
  expectZipEntry(entrySet, "APP_VERSION");
  expectZipEntry(entrySet, "사용자_사용안내.md");
  expectZipEntry(entrySet, "launcher/ChungbukInventoryLauncher.cs");
  expectZipEntry(entrySet, "src/app/server.js");
  expectZipEntry(entrySet, "src/db/repositories.js");
  expectZipEntry(entrySet, "src/db/schema.js");
  expectZipEntry(entrySet, "src/services/import-usage-history.js");
  expectZipEntry(entrySet, "src/services/read-models.js");
  expectZipEntry(entrySet, "src/services/xlsb-workbook-reader.js");
  expectZipEntry(entrySet, "src/services/xlsx-usage-history-parser.js");
  expectZipEntry(entrySet, "src/services/inventory-xlsx-export.js");
  expectZipEntry(entrySet, "src/ui/index.html");
  expectZipEntry(entrySet, "scripts/build-windows-launcher.ps1");
  expectZipEntry(entrySet, "scripts/start-portable.mjs");
  expectZipEntry(entrySet, "scripts/apply-windows-update.ps1");
  expectZipEntry(entrySet, "scripts/safe-database-copy.mjs");
  expectZipEntry(entrySet, "scripts/health-check-portable.mjs");
  expectZipEntry(entrySet, "scripts/verify-release-version.mjs");
  expectZipEntry(entrySet, "scripts/verify-portable-runtime.mjs");
  expectZipEntry(entrySet, "user-data/backups/");
  try {
    validateVersionValues(
      readStoredZipEntry(zipPath, "APP_VERSION").toString("utf8"),
      readStoredZipEntry(zipPath, "package.json").toString("utf8")
    );
  } catch (error) {
    failures.push(`zip 버전 값을 확인하지 못했습니다: ${error.message}`);
  }

  if (entries.some((entry) => entry === "data/" || entry.startsWith("data/"))) {
    failures.push("배포 zip에는 개발용 data/ 폴더가 들어가면 안 됩니다.");
  }

  for (const entry of entries) {
    if (entry.startsWith("user-data/") && (entry.endsWith(".sqlite") || entry.endsWith(".db"))) {
      failures.push(`배포 zip의 user-data에는 데이터베이스 파일이 없어야 합니다: ${entry}`);
    }
  }

  if (requireRuntime && !entrySet.has("runtime/node/node.exe")) {
    failures.push("배포 zip에는 runtime/node/node.exe가 필요합니다.");
  }
  if (requireLauncherExe && !entrySet.has("ChungbukInventory.exe")) {
    failures.push("배포 zip에는 ChungbukInventory.exe가 필요합니다.");
  }
}

function validateVersionValues(appVersionText, packageJsonText) {
  const appVersion = appVersionText.trim();
  const packageVersion = JSON.parse(packageJsonText).version;
  if (!/^\d+\.\d+\.\d+$/.test(appVersion) || appVersion !== packageVersion) {
    failures.push(
      `버전이 일치하지 않습니다: APP_VERSION=${appVersion}, package.json=${packageVersion}`
    );
  }
}

function readStoredZipEntry(zipPath, requestedName) {
  const buffer = readFileSync(zipPath);
  const endRecordOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endRecordOffset + 10);
  let offset = buffer.readUInt32LE(endRecordOffset + 16);
  for (let index = 0; index < entryCount; index += 1) {
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === requestedName) {
      if (compression !== 0) throw new Error(`unsupported compression for ${requestedName}`);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      return buffer.subarray(start, start + compressedSize);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`missing zip entry: ${requestedName}`);
}

function expectFile(root, relativePath) {
  const target = join(root, relativePath);
  if (!existsSync(target) || !statSync(target).isFile()) {
    failures.push(`파일이 없습니다: ${relativePath}`);
  }
}

function expectDirectory(root, relativePath) {
  const target = join(root, relativePath);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    failures.push(`폴더가 없습니다: ${relativePath}`);
  }
}

function expectZipEntry(entries, relativePath) {
  if (!entries.has(relativePath)) {
    failures.push(`zip 안에 항목이 없습니다: ${relativePath}`);
  }
}

function expectWindowsBatchLineEndings(root, relativePath) {
  const target = join(root, relativePath);
  if (!existsSync(target) || !statSync(target).isFile()) {
    return;
  }
  const text = readFileSync(target, "utf8");
  const hasBareLf = /(^|[^\r])\n/.test(text);
  if (hasBareLf) {
    failures.push(`Windows 배치 파일은 CRLF 줄바꿈이어야 합니다: ${relativePath}`);
  }
}

async function validatePortableModules(root) {
  try {
    await import(pathToFileURL(join(root, "src/app/server.js")).href);
  } catch (error) {
    failures.push(`배포 서버 모듈을 불러오지 못했습니다: ${error.message}`);
  }
}

function listZipEntryNames(zipPath) {
  const buffer = readFileSync(zipPath);
  const endRecordOffset = findEndOfCentralDirectory(buffer);
  if (endRecordOffset === -1) {
    failures.push("zip 파일의 끝 기록을 찾을 수 없습니다.");
    return [];
  }

  const entryCount = buffer.readUInt16LE(endRecordOffset + 10);
  const centralOffset = buffer.readUInt32LE(endRecordOffset + 16);
  const entries = [];
  let offset = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      failures.push(`zip 중앙 디렉터리 항목이 올바르지 않습니다: ${index}`);
      return entries;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    entries.push(buffer.subarray(nameStart, nameEnd).toString("utf8"));
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minimumOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  return -1;
}

function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const entries = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFiles(fullPath));
    } else {
      entries.push(fullPath);
    }
  }
  return entries;
}
