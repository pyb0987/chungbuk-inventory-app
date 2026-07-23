import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFile), "..");
const outputRoot = join(projectRoot, "dist");
const portableRoot = join(outputRoot, "chungbuk-inventory-portable");

const directoriesToCopy = ["src", "docs", "scripts", "launcher"];
const filesToCopy = [
  "package.json",
  "APP_VERSION",
  "README.md",
  "사용자_사용안내.md",
  "START_CHUNGBUK_APP.cmd",
  "VERIFY_CHUNGBUK_APP.cmd",
  "BUILD_WINDOWS_LAUNCHER.cmd"
];
const windowsBatchFiles = [
  "START_CHUNGBUK_APP.cmd",
  "VERIFY_CHUNGBUK_APP.cmd",
  "BUILD_WINDOWS_LAUNCHER.cmd"
];

rmSync(portableRoot, { recursive: true, force: true });
mkdirSync(portableRoot, { recursive: true });

for (const directory of directoriesToCopy) {
  cpSync(join(projectRoot, directory), join(portableRoot, directory), {
    recursive: true,
    filter: (source) => !source.includes(`${join(projectRoot, "data")}`)
  });
}

if (existsSync(join(projectRoot, "runtime"))) {
  cpSync(join(projectRoot, "runtime"), join(portableRoot, "runtime"), {
    recursive: true
  });
}

for (const file of filesToCopy) {
  copyFileSync(join(projectRoot, file), join(portableRoot, file));
}
for (const file of windowsBatchFiles) {
  normalizeWindowsBatchFile(join(portableRoot, file));
}

if (existsSync(join(projectRoot, "ChungbukInventory.exe"))) {
  copyFileSync(join(projectRoot, "ChungbukInventory.exe"), join(portableRoot, "ChungbukInventory.exe"));
}

mkdirSync(join(portableRoot, "user-data", "backups"), { recursive: true });
writeFileSync(
  join(portableRoot, "user-data", "README.txt"),
  [
    "이 폴더에는 로컬 SQLite 데이터베이스와 백업 파일이 저장됩니다.",
    "실제 재고 데이터를 가져온 뒤에는 이 폴더를 삭제하지 마세요.",
    "배포 폴더는 오래된 재고 데이터 없이 시작하도록 만들어져 있습니다.",
    ""
  ].join("\r\n")
);

if (!existsSync(join(portableRoot, "runtime", "node", "node.exe"))) {
  mkdirSync(join(portableRoot, "runtime", "node"), { recursive: true });
  writeFileSync(
    join(portableRoot, "runtime", "node", "PUT_NODE_RUNTIME_HERE.txt"),
    [
      "Windows 전달용으로 Windows Node.js 25 이상 런타임을 node.exe 이름으로 여기에 넣어 주세요.",
      "START_CHUNGBUK_APP.cmd는 시스템에 설치된 Node로 자동 대체하지 않습니다.",
      "개발용으로 실행할 때는 원본 폴더에서 npm start를 사용해 주세요.",
      ""
    ].join("\r\n")
  );
}

console.log(`배포 폴더 준비 완료: ${portableRoot}`);

function normalizeWindowsBatchFile(filePath) {
  const text = readFileSync(filePath, "utf8");
  writeFileSync(filePath, text.replace(/\r?\n/g, "\r\n"), "utf8");
}
