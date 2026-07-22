import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const appRoot = resolve(dirname(currentFile), "..");
const args = new Set(process.argv.slice(2));
const failures = [];

await checkCurrentRuntime();

expectFile("START_CHUNGBUK_APP.cmd");
expectFile("VERIFY_CHUNGBUK_APP.cmd");
if (args.has("--require-launcher-exe")) {
  expectFile("ChungbukInventory.exe", { minimumBytes: 10_000 });
}
expectFile("package.json");
expectFile("runtime/node/node.exe", { minimumBytes: 50_000_000 });
expectFile("scripts/start-portable.mjs");
expectFile("src/app/server.js");
expectFile("src/ui/index.html");
expectFile("docs/user-guide-ko.md");
expectDirectory("user-data/backups");

if (existsSync(join(appRoot, "data"))) {
  failures.push("배포 폴더에는 개발용 data/ 폴더가 들어가면 안 됩니다.");
}

for (const file of listFiles(join(appRoot, "user-data"))) {
  if (file.endsWith(".sqlite") || file.endsWith(".db")) {
    failures.push(`처음 전달하는 폴더에는 데이터베이스 파일이 없어야 합니다: ${file}`);
  }
}

if (failures.length > 0) {
  console.error("배포 폴더 확인에 실패했습니다:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Node 런타임: ${process.version}`);
console.log("node:sqlite: 사용 가능");
console.log("필수 앱 파일: 확인됨");
console.log("초기 user-data 폴더: 깨끗함");

async function checkCurrentRuntime() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 25) {
    failures.push(`Node.js 25 이상이 필요합니다. 현재 버전: ${process.version}`);
  }
  try {
    await import("node:sqlite");
  } catch {
    failures.push("현재 Node 런타임에서 node:sqlite를 사용할 수 없습니다.");
  }
}

function expectFile(relativePath, options = {}) {
  const target = join(appRoot, relativePath);
  if (!existsSync(target) || !statSync(target).isFile()) {
    failures.push(`파일이 없습니다: ${relativePath}`);
    return;
  }
  if (options.minimumBytes && statSync(target).size < options.minimumBytes) {
    failures.push(`파일 크기가 예상보다 작습니다: ${relativePath}`);
  }
}

function expectDirectory(relativePath) {
  const target = join(appRoot, relativePath);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    failures.push(`폴더가 없습니다: ${relativePath}`);
  }
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
