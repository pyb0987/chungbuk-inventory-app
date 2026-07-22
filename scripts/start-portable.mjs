import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const appRoot = resolve(dirname(currentFile), "..");
const dataDir = resolve(process.env.CHUNGBUK_DATA_DIR ?? join(appRoot, "user-data"));
const port = Number(process.env.PORT ?? 5177);
const logDir = join(dataDir, "logs");
const logPath = join(logDir, "app.log");

mkdirSync(join(dataDir, "backups"), { recursive: true });
mkdirSync(logDir, { recursive: true });
installFileLogging(logPath);

let app = null;

try {
  console.log(`충북 재고관리 앱을 시작합니다: ${appRoot}`);
  const { startAppServer } = await import("../src/app/server.js");
  app = await startAppServer({ port, dataDir });
  console.log(`충북 재고관리 앱이 실행 중입니다: ${app.url}`);
  console.log(`데이터베이스: ${app.databasePath}`);
  console.log("앱을 종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.");
  openBrowser(app.url);
} catch (error) {
  console.error("충북 재고관리 앱을 시작하지 못했습니다.");
  console.error(error.message ?? error);
  process.exitCode = 1;
}

process.on("SIGINT", stopApp);
process.on("SIGTERM", stopApp);
process.on("uncaughtException", (error) => {
  console.error("처리되지 않은 오류");
  console.error(error);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("처리되지 않은 비동기 오류");
  console.error(reason);
  process.exit(1);
});

if (app) {
  await new Promise(() => {
    // Keep the process alive until the user closes the launcher.
  });
}

async function stopApp() {
  if (app) {
    await app.close();
    app = null;
  }
  process.exit(0);
}

function openBrowser(url) {
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function installFileLogging(filePath) {
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);

  const write = (level, values) => {
    const rendered = values.map(renderLogValue).join(" ");
    appendFileSync(filePath, `[${new Date().toISOString()}] ${level} ${rendered}\n`, "utf8");
  };

  console.log = (...values) => {
    write("INFO", values);
    originalLog(...values);
  };

  console.error = (...values) => {
    write("ERROR", values);
    originalError(...values);
  };
}

function renderLogValue(value) {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
