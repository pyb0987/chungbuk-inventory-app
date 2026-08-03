import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, createAppDatabase } from "../db/database.js";
import {
  createItem,
  createPerson,
  createSerialNumber,
  createStockAdjustment,
  deactivateSerialNumber,
  deleteTransaction,
  createBackupRecord,
  getBackupRecord,
  listItems,
  listPeople,
  permanentlyDeleteItem,
  recordTransaction,
  restoreSerialNumber,
  restoreTransaction,
  setItemActive,
  setPersonActive,
  updateSerialNumber,
  updateTransaction
} from "../db/repositories.js";
import {
  Buckets,
  TransactionLabels,
  TransactionTypes,
  normalizeTransactionType
} from "../domain/stock-engine.js";
import { createDatabaseBackup, ensureDailyBackup, restoreDatabaseFile } from "../services/backups.js";
import { importCurrentStockRows } from "../services/import-current-stock.js";
import { importUsageHistoryRows } from "../services/import-usage-history.js";
import {
  getBackupListView,
  getAuditLogView,
  getDashboardView,
  getImportRunListView,
  getInventoryWorkbookView,
  getLegacyUsageHistoryView,
  getSerialNumberView,
  getTransactionHistoryView
} from "../services/read-models.js";
import { parseCurrentStockWorkbook } from "../services/xlsx-current-stock-parser.js";
import { parseUsageHistoryWorkbook } from "../services/xlsx-usage-history-parser.js";
import { buildInventoryWorkbook } from "../services/inventory-xlsx-export.js";
import { resetApplicationData } from "../services/reset-application-data.js";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFile, "../../..");
const defaultUiDir = resolve(projectRoot, "src/ui");
const defaultDataDir = resolve(projectRoot, "data");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ico", "image/x-icon"]
]);

export function startAppServer(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.PORT ?? 5177);
  const dataDir = resolve(options.dataDir ?? process.env.CHUNGBUK_DATA_DIR ?? defaultDataDir);
  const backupDir = resolve(options.backupDir ?? join(dataDir, "backups"));
  const databasePath = resolve(options.databasePath ?? join(dataDir, "chungbuk-inventory.sqlite"));
  const uiDir = resolve(options.uiDir ?? defaultUiDir);

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });

  let db = createAppDatabase(databasePath);
  const server = createServer((request, response) => {
    const startedAt = Date.now();
    const mutation = request.method !== "GET";
    if (mutation) {
      console.log(`요청 시작: ${request.method} ${request.url}`);
    }
    handleRequest({
      request,
      response,
      getDb: () => db,
      setDb: (nextDb) => {
        db = nextDb;
      },
      databasePath,
      uiDir,
      backupDir
    }).then(() => {
      if (mutation) {
        console.log(`요청 완료: ${request.method} ${request.url} (${Date.now() - startedAt}ms)`);
      }
    }).catch((error) => {
      console.error(`요청 실패: ${request.method} ${request.url}`);
      console.error(error);
      if (!response.headersSent) {
        sendJson(response, httpStatusForError(error), {
          error: publicErrorMessage(error, getDbSafely(db))
        });
      } else {
        response.end();
      }
    });
  });

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, host, () => {
      server.off("error", rejectStart);
      const address = server.address();
      resolveStart({
        server,
        get db() {
          return db;
        },
        databasePath,
        backupDir,
        url: `http://${host}:${address.port}`,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((error) => {
              try {
                closeDatabase(db);
              } catch {
                // The server may be closed by tests after an initialization failure.
              }
              if (error) {
                rejectClose(error);
              } else {
                resolveClose();
              }
            });
          })
      });
    });
  });
}

async function handleRequest(context) {
  const { request, response } = context;
  const url = new URL(request.url, "http://localhost");

  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(context, url);
    return;
  }

  serveStaticFile(response, context.uiDir, url.pathname);
}

async function handleApiRequest({ request, response, getDb, setDb, databasePath, backupDir }, url) {
  const route = `${request.method} ${url.pathname}`;
  const db = getDb();

  if (route === "GET /api/state") {
    sendJson(response, 200, buildState(db));
    return;
  }

  if (route === "GET /api/inventory-export.xlsx") {
    const workbook = buildInventoryWorkbook(getInventoryWorkbookView(db));
    const filename = `chungbuk-inventory-${todayIsoDate()}.xlsx`;
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": workbook.length
    });
    response.end(workbook);
    return;
  }

  if (route === "POST /api/items") {
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const item = createItem(db, { name: input.name });
    sendJson(response, 201, { item, state: buildState(db) });
    return;
  }

  if (route === "POST /api/people") {
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const person = createPerson(db, { name: input.name });
    sendJson(response, 201, { person, state: buildState(db) });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/items/")) {
    const id = parseEntityId(url, "item");
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const item = setItemActive(db, id, Boolean(input.isActive), {
      reason: input.reason ?? "UI update"
    });
    sendJson(response, 200, { item, state: buildState(db) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/items/")) {
    const id = parseEntityId(url, "item");
    const input = await readOptionalJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const item = input.permanent
      ? permanentlyDeleteItem(db, id, { reason: input.reason ?? "UI permanent delete" })
      : setItemActive(db, id, false, { reason: input.reason ?? "UI delete" });
    sendJson(response, 200, { item, state: buildState(db) });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/people/")) {
    const id = parseEntityId(url, "person");
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const person = setPersonActive(db, id, Boolean(input.isActive), {
      reason: input.reason ?? "UI update"
    });
    sendJson(response, 200, { person, state: buildState(db) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/people/")) {
    const id = parseEntityId(url, "person");
    const input = await readOptionalJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const person = setPersonActive(db, id, false, { reason: input.reason ?? "UI delete" });
    sendJson(response, 200, { person, state: buildState(db) });
    return;
  }

  if (route === "POST /api/serials") {
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const serial = createSerialNumber(db, {
      itemId: Number(input.itemId),
      serialText: input.serialText,
      holderText: input.holderText,
      note: input.note
    });
    sendJson(response, 201, { serial, state: buildState(db) });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/serials/")) {
    const id = parseEntityId(url, "serial number");
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const serial = updateSerialNumber(db, id, {
      itemId: input.itemId === undefined ? undefined : Number(input.itemId),
      serialText: input.serialText,
      holderText: input.holderText,
      note: input.note,
      reason: input.reason ?? "UI update"
    });
    sendJson(response, 200, { serial, state: buildState(db) });
    return;
  }

  if (request.method === "POST" && /^\/api\/serials\/\d+\/restore$/.test(url.pathname)) {
    const id = parseNestedEntityId(url, "serial number", -2);
    const input = await readOptionalJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const serial = restoreSerialNumber(db, id, { reason: input.reason ?? "UI restore" });
    sendJson(response, 200, { serial, state: buildState(db) });
    return;
  }

  if (route === "POST /api/stock-adjustments") {
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const adjustment = createStockAdjustment(db, {
      occurredOn: requireText(input.occurredOn, "date"),
      itemId: Number(input.itemId),
      bucket: input.bucket,
      holderId: input.holderId ? Number(input.holderId) : null,
      quantityDelta: Number(input.quantityDelta),
      reason: input.reason
    });
    sendJson(response, 201, { adjustment, state: buildState(db) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/serials/")) {
    const id = parseEntityId(url, "serial number");
    const input = await readOptionalJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const serial = deactivateSerialNumber(db, id, { reason: input.reason ?? "UI delete" });
    sendJson(response, 200, { serial, state: buildState(db) });
    return;
  }

  if (route === "POST /api/transactions") {
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const transaction = recordTransaction(db, normalizeTransactionInput(input));
    sendJson(response, 201, { transaction, state: buildState(db) });
    return;
  }

  if (request.method === "POST" && /^\/api\/transactions\/\d+\/restore$/.test(url.pathname)) {
    const id = parseNestedEntityId(url, "transaction", -2);
    const input = await readOptionalJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const transaction = restoreTransaction(db, id, { reason: input.reason ?? "UI restore" });
    sendJson(response, 200, { transaction, state: buildState(db) });
    return;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/transactions/")) {
    const id = parseTransactionId(url);
    const input = await readJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const transaction = updateTransaction(db, id, {
      ...normalizeTransactionInput(input),
      reason: input.reason ?? "UI update"
    });
    sendJson(response, 200, { transaction, state: buildState(db) });
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/transactions/")) {
    const id = parseTransactionId(url);
    const input = await readOptionalJsonBody(request);
    await ensureDailyBackup(db, { backupDir });
    const transaction = deleteTransaction(db, id, { reason: input.reason ?? "UI delete" });
    sendJson(response, 200, { transaction, state: buildState(db) });
    return;
  }

  if (route === "POST /api/import/current-stock") {
    const input = await readJsonBody(request);
    await createPreImportBackup(db, backupDir, input.sourceFile, "current stock import");
    const report = importCurrentStockRows(db, {
      sourceFile: input.sourceFile,
      occurredOn: input.occurredOn,
      mode: input.mode,
      allowPartial: input.allowPartial,
      allowDuplicate: input.allowDuplicate,
      rows: input.rows
    });
    sendJson(response, 200, { report, state: buildState(db) });
    return;
  }

  if (route === "POST /api/import/current-stock-xlsx") {
    const query = url.searchParams;
    const sourceFile = query.get("sourceFile") ?? request.headers["x-source-file"] ?? "selected-stock.xlsx";
    const occurredOn = query.get("occurredOn") ?? todayIsoDate();
    const mode = query.get("mode") ?? "initial";
    const allowPartial = query.get("allowPartial") === "true";
    const allowDuplicate = query.get("allowDuplicate") === "true";
    const buffer = await readBinaryBody(request);
    const parsed = parseCurrentStockWorkbook(buffer);
    await createPreImportBackup(db, backupDir, sourceFile, "current stock import");
    const report = importCurrentStockRows(db, {
      sourceFile,
      occurredOn,
      mode,
      allowPartial,
      allowDuplicate,
      rows: parsed.rows
    });
    sendJson(response, 200, {
      report: {
        ...report,
        parsedWorkbook: parsed.summary
      },
      state: buildState(db)
    });
    return;
  }

  if (route === "POST /api/import/usage-history-xlsx") {
    const query = url.searchParams;
    const sourceFile = query.get("sourceFile") ?? "selected-usage-history.xlsx";
    const allowPartial = query.get("allowPartial") === "true";
    const allowDuplicate = query.get("allowDuplicate") === "true";
    const buffer = await readBinaryBody(request);
    const parsed = parseUsageHistoryWorkbook(buffer);
    await createPreImportBackup(db, backupDir, sourceFile, "usage history import");
    const report = importUsageHistoryRows(db, {
      sourceFile,
      allowPartial,
      allowDuplicate,
      rows: parsed.rows
    });
    sendJson(response, 200, {
      report: {
        ...report,
        parsedWorkbook: parsed.summary
      },
      state: buildState(db)
    });
    return;
  }

  if (route === "POST /api/backups") {
    const input = await readJsonBody(request);
    const backup = await createDatabaseBackup(db, {
      backupDir,
      reason: input.reason ?? "manual backup from UI"
    });
    sendJson(response, 201, { backup, state: buildState(db) });
    return;
  }

  if (route === "POST /api/factory-reset") {
    const input = await readJsonBody(request);
    if (input.confirmation !== "DELETE_ALL_DATA") {
      throw badRequest("전체 초기화 확인이 필요합니다");
    }
    const emergencyBackup = await createDatabaseBackup(db, {
      backupDir,
      reason: "전체 초기화 직전 자동 백업"
    });
    const backup = resetApplicationData(db, emergencyBackup);
    sendJson(response, 200, { reset: { backup }, state: buildState(db) });
    return;
  }

  if (request.method === "POST" && /^\/api\/backups\/\d+\/restore$/.test(url.pathname)) {
    const backupId = parseNestedEntityId(url, "backup", -2);
    const backup = getBackupRecord(db, backupId);
    if (!backup) {
      throw badRequest("backup not found");
    }
    const result = await restoreDatabaseFromPath({
      db,
      setDb,
      databasePath,
      backupDir,
      backupPath: backup.filePath,
      restoredFrom: backup.filePath
    });
    sendJson(response, 200, {
      restore: result.restore,
      state: buildState(result.db)
    });
    return;
  }

  if (route === "POST /api/restore") {
    const upload = await readBinaryBody(request);
    const uploadPath = join(backupDir, `restore-upload-${process.pid}-${Date.now()}.sqlite`);
    writeFileSync(uploadPath, upload);
    try {
      const result = await restoreDatabaseFromPath({
        db,
        setDb,
        databasePath,
        backupDir,
        backupPath: uploadPath,
        restoredFrom: "uploaded backup"
      });
      sendJson(response, 200, {
        restore: result.restore,
        state: buildState(result.db)
      });
    } finally {
      try {
        unlinkSync(uploadPath);
      } catch {
        // Ignore temporary upload cleanup failures.
      }
    }
    return;
  }

  sendJson(response, 404, { error: "요청한 항목을 찾을 수 없습니다" });
}

function buildState(db) {
  const items = listItems(db);
  const people = listPeople(db);
  return {
    dashboard: getDashboardView(db),
    inventory: getInventoryWorkbookView(db),
    transactions: getTransactionHistoryView(db),
    auditLog: getAuditLogView(db),
    serials: getSerialNumberView(db),
    backups: getBackupListView(db),
    importRuns: getImportRunListView(db),
    legacyUsageRecords: getLegacyUsageHistoryView(db),
    items,
    people,
    activeItems: items.filter((item) => item.isActive),
    activePeople: people.filter((person) => person.isActive),
    transactionTypes: [
      TransactionTypes.PERSONAL_OUT,
      TransactionTypes.PERSONAL_IN,
      TransactionTypes.PERSONAL_INSTALL,
      TransactionTypes.PERSONAL_RECOVER,
      TransactionTypes.RETURN_TO_SEOUL,
      TransactionTypes.SEOUL_TO_PART_ROOM,
      TransactionTypes.OFFICE_OUT,
      TransactionTypes.OFFICE_IN
    ].map((type) => ({
      type,
      label: entryLabelForTransactionType(type),
      historyLabel: TransactionLabels[type]
    })),
    adjustmentBuckets: [
      { bucket: Buckets.PART_ROOM, label: "파트실" },
      { bucket: Buckets.OFFICE, label: "사무실" },
      { bucket: Buckets.PERSON, label: "개인" }
    ]
  };
}

async function createPreImportBackup(db, backupDir, sourceFile, importLabel) {
  return createDatabaseBackup(db, {
    backupDir,
    reason: `before ${requireText(importLabel, "import label")}: ${requireText(sourceFile, "source file")}`
  });
}

function entryLabelForTransactionType(type) {
  if (type === TransactionTypes.PERSONAL_OUT) {
    return "개인 출고";
  }
  if (type === TransactionTypes.PERSONAL_IN) {
    return "개인 반납";
  }
  return TransactionLabels[type];
}

function publicErrorMessage(error, db) {
  if (error.code !== "INSUFFICIENT_STOCK" || !db) {
    return error.message || "예상하지 못한 서버 오류가 발생했습니다";
  }
  const item = db.prepare("SELECT name FROM items WHERE id = ?").get(error.itemId);
  const person = error.holderId
    ? db.prepare("SELECT name FROM people WHERE id = ?").get(error.holderId)
    : null;
  const location =
    error.bucket === Buckets.PERSON
      ? `개인 '${person?.name ?? `#${error.holderId}`}' 보유`
      : error.bucket === Buckets.OFFICE
        ? "사무실"
        : "파트실";
  return `재고가 부족하여 저장할 수 없습니다. 품목: ${item?.name ?? `#${error.itemId}`}, 위치: ${location}, 부족 수량: ${Math.abs(error.resultingQuantity)}개`;
}

function getDbSafely(db) {
  try {
    return db;
  } catch {
    return null;
  }
}

function normalizeTransactionInput(input) {
  const type = normalizeTransactionType(input.type);
  return {
    occurredOn: requireText(input.occurredOn, "date"),
    type,
    itemId: Number(input.itemId),
    personId: input.personId ? Number(input.personId) : null,
    quantity: Number(input.quantity),
    serialText: emptyToNull(input.serialText),
    note: emptyToNull(input.note),
    sourceLabel: TransactionLabels[type] ?? input.type
  };
}

function parseTransactionId(url) {
  return parseEntityId(url, "transaction");
}

function parseEntityId(url, label) {
  const id = Number(url.pathname.split("/").at(-1));
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest(`invalid ${label} id`);
  }
  return id;
}

function parseNestedEntityId(url, label, segmentFromEnd) {
  const id = Number(url.pathname.split("/").at(segmentFromEnd));
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest(`invalid ${label} id`);
  }
  return id;
}

async function restoreDatabaseFromPath({
  db,
  setDb,
  databasePath,
  backupDir,
  backupPath,
  restoredFrom
}) {
  let databaseWasClosed = false;
  try {
    const beforeRestoreBackup = await createDatabaseBackup(db, {
      backupDir,
      reason: "before restore from UI"
    });
    closeDatabase(db);
    databaseWasClosed = true;
    restoreDatabaseFile({ backupPath, databasePath });
    const reopenedDb = createAppDatabase(databasePath);
    createBackupRecord(reopenedDb, beforeRestoreBackup);
    setDb(reopenedDb);
    return {
      db: reopenedDb,
      restore: {
        restoredFrom,
        beforeRestoreBackup,
        sizeBytes: statSync(databasePath).size
      }
    };
  } catch (error) {
    if (databaseWasClosed) {
      try {
        setDb(createAppDatabase(databasePath));
      } catch {
        // Preserve the original restore error when reopening also fails.
      }
    }
    throw error;
  }
}

function serveStaticFile(response, uiDir, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(uiDir, `.${decodeURIComponent(requestedPath)}`);
  if (!filePath.startsWith(uiDir) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "요청한 파일을 찾을 수 없습니다" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream"
  });
  createReadStream(filePath).pipe(response);
}

async function readJsonBody(request) {
  const text = await readBody(request);
  if (!text.trim()) {
    throw badRequest("request body is required");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("request body must be JSON");
  }
}

async function readOptionalJsonBody(request) {
  const text = await readBody(request);
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("request body must be JSON");
  }
}

function readBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        rejectBody(badRequest("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", rejectBody);
  });
}

function readBinaryBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let totalLength = 0;
    request.on("data", (chunk) => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 25_000_000) {
        rejectBody(badRequest("uploaded workbook is too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", rejectBody);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function httpStatusForError(error) {
  if (error.statusCode) {
    return error.statusCode;
  }
  if (isValidationError(error)) {
    return 400;
  }
  return 500;
}

function isValidationError(error) {
  const message = error.message ?? "";
  return [
    " is required",
    "not found",
    "unknown transaction type",
    "unsupported transaction type",
    "quantity must be",
    "adjustment quantity must be",
    "already exists",
    "invalid stock adjustment bucket",
    "holderId is required",
    "holderId is not allowed",
    "negative stock is not allowed",
    "cannot update deleted transaction"
  ].some((pattern) => message.includes(pattern));
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${label} is required`);
  }
  return value.trim();
}

function emptyToNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startAppServer()
    .then(({ url, databasePath }) => {
      console.log(`Chungbuk Inventory App running at ${url}`);
      console.log(`Database: ${databasePath}`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
