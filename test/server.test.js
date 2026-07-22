import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startAppServer } from "../src/app/server.js";
import {
  createCurrentStockWorkbookFixture,
  createUsageHistoryWorkbookFixture,
  createUsageHistoryXlsbWorkbookFixture
} from "./support/xlsx-fixture.js";

test("local app server serves UI state and records a transaction", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const initial = await getJson(`${app.url}/api/state`);
    assert.equal(initial.dashboard.totalStock, 0);
    assert.equal(initial.inventory.rows.length, 0);
    assert.deepEqual(
      initial.transactionTypes.map((entry) => entry.label),
      ["개인 출고", "개인 입고", "서울로 반납", "서울에서 파트실로 택배", "사무실 사용/보유"]
    );

    const imported = await postJson(`${app.url}/api/import/current-stock`, {
      sourceFile: "test-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 5,
          personHoldings: {
            정상호: 1
          }
        }
      ]
    });

    assert.equal(imported.report.status, "completed");
    assert.equal(imported.state.dashboard.totalStock, 6);
    assert.match(imported.state.backups[0].reason, /before current stock import: test-stock\.xlsx/);

    const itemId = imported.state.items[0].id;
    const personId = imported.state.people[0].id;
    const transaction = await postJson(`${app.url}/api/transactions`, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId,
      personId,
      quantity: 2,
      serialText: "S-1",
      note: "server smoke"
    }, 201);

    const row = transaction.state.inventory.rows[0];
    assert.equal(row.partRoomQuantity, 3);
    assert.equal(row.personHoldings["정상호"], 3);
    assert.equal(transaction.state.transactions[0].label, "출고");

    const adjusted = await postJson(`${app.url}/api/stock-adjustments`, {
      occurredOn: "2026-07-14",
      itemId,
      bucket: "part_room",
      quantityDelta: -1,
      reason: "server adjustment"
    }, 201);

    assert.equal(adjusted.state.inventory.rows[0].partRoomQuantity, 2);

    const rejectedAdjustment = await postJson(`${app.url}/api/stock-adjustments`, {
      occurredOn: "2026-07-14",
      itemId,
      bucket: "part_room",
      quantityDelta: -100,
      reason: "negative test"
    }, 400);
    assert.match(rejectedAdjustment.error, /negative stock is not allowed/);

    const updated = await patchJson(`${app.url}/api/transactions/${transaction.transaction.id}`, {
      occurredOn: "2026-07-14",
      type: "출고",
      itemId,
      personId,
      quantity: 1,
      serialText: "S-1",
      note: "server smoke edited",
      reason: "test update"
    });

    const updatedRow = updated.state.inventory.rows[0];
    assert.equal(updatedRow.partRoomQuantity, 3);
    assert.equal(updatedRow.personHoldings["정상호"], 2);
    assert.equal(updated.state.transactions[0].itemId, itemId);
    assert.equal(updated.state.transactions[0].personId, personId);
    assert.equal(updated.state.transactions[0].note, "server smoke edited");
    assert.equal(updated.state.auditLog[0].actionLabel, "수정");
    assert.match(updated.state.auditLog[0].afterSummary, /수량 1/);

    const deletedTransaction = await deleteJson(`${app.url}/api/transactions/${transaction.transaction.id}`, {
      reason: "server smoke delete"
    });
    assert.equal(deletedTransaction.state.transactions[0].isDeleted, true);
    const restoredTransaction = await postJson(
      `${app.url}/api/transactions/${transaction.transaction.id}/restore`,
      { reason: "server smoke restore" }
    );
    assert.equal(restoredTransaction.state.transactions[0].isDeleted, false);
    assert.equal(restoredTransaction.state.inventory.rows[0].partRoomQuantity, 3);

    const serial = await postJson(`${app.url}/api/serials`, {
      itemId,
      serialText: "SN-1",
      holderText: "정상호",
      note: "server serial"
    }, 201);
    assert.equal(serial.state.serials[0].serialText, "SN-1");

    const updatedSerial = await patchJson(`${app.url}/api/serials/${serial.serial.id}`, {
      itemId,
      serialText: "SN-2",
      holderText: "파트실",
      note: "corrected serial",
      reason: "server serial update"
    });
    assert.equal(updatedSerial.state.serials[0].serialText, "SN-2");
    assert.equal(updatedSerial.state.serials[0].holderText, "파트실");
    assert.equal(updatedSerial.state.auditLog[0].actionLabel, "수정");
    assert.equal(updatedSerial.state.auditLog[0].entityLabel, "시리얼");

    const deletedSerial = await deleteJson(`${app.url}/api/serials/${serial.serial.id}`, {
      reason: "test delete"
    });
    assert.equal(deletedSerial.state.serials[0].isActive, false);

    const restoredSerial = await postJson(`${app.url}/api/serials/${serial.serial.id}/restore`, {
      reason: "test restore"
    });
    assert.equal(restoredSerial.state.serials[0].isActive, true);
  } finally {
    await app.close();
  }
});

test("local app server returns the static UI", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const response = await fetch(app.url);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /충북사무소 재고관리/);
    assert.match(html, /품목 관리/);
    assert.match(html, /개인 관리/);
    assert.match(html, /같은 재고 다시 가져오기 허용/);
  } finally {
    await app.close();
  }
});

test("local app server deactivates and reactivates items and people", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const itemResponse = await postJson(`${app.url}/api/items`, { name: "테스트 품목" }, 201);
    const personResponse = await postJson(`${app.url}/api/people`, { name: "테스트 개인" }, 201);

    const itemId = itemResponse.item.id;
    const personId = personResponse.person.id;
    assert.equal(itemResponse.state.activeItems.some((item) => item.id === itemId), true);
    assert.equal(personResponse.state.activePeople.some((person) => person.id === personId), true);

    const inactiveItem = await deleteJson(`${app.url}/api/items/${itemId}`, {
      reason: "server test"
    });
    const inactivePerson = await deleteJson(`${app.url}/api/people/${personId}`, {
      reason: "server test"
    });

    assert.equal(inactiveItem.item.isActive, 0);
    assert.equal(inactivePerson.person.isActive, 0);
    assert.equal(inactiveItem.state.items.some((item) => item.id === itemId), true);
    assert.equal(inactiveItem.state.activeItems.some((item) => item.id === itemId), false);
    assert.equal(inactivePerson.state.activePeople.some((person) => person.id === personId), false);

    const activeItem = await patchJson(`${app.url}/api/items/${itemId}`, {
      isActive: true,
      reason: "server test restore"
    });
    const activePerson = await patchJson(`${app.url}/api/people/${personId}`, {
      isActive: true,
      reason: "server test restore"
    });

    assert.equal(activeItem.item.isActive, 1);
    assert.equal(activePerson.person.isActive, 1);
    assert.equal(activeItem.state.activeItems.some((item) => item.id === itemId), true);
    assert.equal(activePerson.state.activePeople.some((person) => person.id === personId), true);
  } finally {
    await app.close();
  }
});

test("local app server creates one automatic backup before daily mutations", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const createdItem = await postJson(`${app.url}/api/items`, { name: "자동백업 품목" }, 201);
    const createdPerson = await postJson(`${app.url}/api/people`, { name: "자동백업 개인" }, 201);

    assert.equal(createdItem.state.backups.length, 1);
    assert.match(createdItem.state.backups[0].reason, /automatic daily backup/);
    assert.equal(createdPerson.state.backups.length, 1);
  } finally {
    await app.close();
  }
});

test("local app server imports a selected current-stock xlsx workbook", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const workbook = createCurrentStockWorkbookFixture();
    const response = await fetch(
      `${app.url}/api/import/current-stock-xlsx?sourceFile=test-stock.xlsx&occurredOn=2026-07-14`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        },
        body: workbook
      }
    );
    const payload = await response.json();

    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.report.status, "completed");
    assert.equal(payload.report.parsedWorkbook.rowCount, 2);
    assert.equal(payload.state.dashboard.totalStock, 12);
    assert.match(payload.state.backups[0].reason, /before current stock import: test-stock\.xlsx/);

    const rowsByName = new Map(payload.state.inventory.rows.map((row) => [row.itemName, row]));
    assert.equal(rowsByName.get("공유기").partRoomQuantity, 5);
    assert.equal(rowsByName.get("공유기").officeQuantity, 1);
    assert.equal(rowsByName.get("공유기").personHoldings["정상호"], 2);
    assert.equal(rowsByName.get("모뎀").personHoldings["최용빈"], 3);
  } finally {
    await app.close();
  }
});

test("local app server imports converted usage history xlsx as reference data", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const currentStock = createCurrentStockWorkbookFixture();
    const currentResponse = await fetch(
      `${app.url}/api/import/current-stock-xlsx?sourceFile=test-stock.xlsx&occurredOn=2026-07-14`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        },
        body: currentStock
      }
    );
    const currentPayload = await currentResponse.json();
    assert.equal(currentResponse.status, 200, currentPayload.error);
    const beforeStock = currentPayload.state.dashboard.totalStock;

    const usageHistory = createUsageHistoryWorkbookFixture();
    const response = await fetch(`${app.url}/api/import/usage-history-xlsx?sourceFile=usage.xlsx`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: usageHistory
    });
    const payload = await response.json();

    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.report.status, "completed");
    assert.equal(payload.report.importedRows, 4);
    assert.equal(payload.report.parsedWorkbook.rowCount, 4);
    assert.equal(payload.state.legacyUsageRecords.length, 4);
    assert.equal(payload.state.dashboard.totalStock, beforeStock);
    assert.match(payload.state.backups[0].reason, /before usage history import: usage\.xlsx/);
  } finally {
    await app.close();
  }
});

test("local app server imports usage history xlsb as reference data", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const usageHistory = createUsageHistoryXlsbWorkbookFixture();
    const response = await fetch(`${app.url}/api/import/usage-history-xlsx?sourceFile=usage.xlsb`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.ms-excel.sheet.binary.macroEnabled.12"
      },
      body: usageHistory
    });
    const payload = await response.json();

    assert.equal(response.status, 200, payload.error);
    assert.equal(payload.report.status, "completed");
    assert.equal(payload.report.importedRows, 4);
    assert.equal(payload.report.parsedWorkbook.rowCount, 4);
    assert.equal(payload.state.legacyUsageRecords.length, 4);
    assert.equal(payload.state.dashboard.totalStock, 0);
    assert.match(payload.state.backups[0].reason, /before usage history import: usage\.xlsb/);
  } finally {
    await app.close();
  }
});

test("local app server restores an uploaded backup and reopens the database", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const imported = await postJson(`${app.url}/api/import/current-stock`, {
      sourceFile: "test-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 5
        }
      ]
    });
    const backup = await postJson(`${app.url}/api/backups`, { reason: "restore target" }, 201);
    await postJson(`${app.url}/api/transactions`, {
      occurredOn: "2026-07-14",
      type: "서울에서 파트실로 택배",
      itemId: imported.state.items[0].id,
      quantity: 2
    }, 201);

    const changed = await getJson(`${app.url}/api/state`);
    assert.equal(changed.dashboard.totalStock, 7);

    const restore = await postBinary(`${app.url}/api/restore`, readFileSync(backup.backup.filePath));
    assert.equal(restore.state.dashboard.totalStock, 5);
    assert.equal(restore.state.inventory.rows.length, 1);
    assert.equal(restore.restore.beforeRestoreBackup.status, "created");
    assert.equal(
      restore.state.backups.some(
        (entry) => entry.filePath === restore.restore.beforeRestoreBackup.filePath
      ),
      true
    );

    const after = await getJson(`${app.url}/api/state`);
    assert.equal(after.dashboard.totalStock, 5);
    assert.equal(
      after.backups.some((entry) => entry.filePath === restore.restore.beforeRestoreBackup.filePath),
      true
    );
  } finally {
    await app.close();
  }
});

test("local app server restores a backup directly from the backup list", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-ui-"));
  const app = await startAppServer({ port: 0, dataDir });
  try {
    const imported = await postJson(`${app.url}/api/import/current-stock`, {
      sourceFile: "test-stock.xlsx",
      occurredOn: "2026-07-14",
      rows: [
        {
          itemName: "공유기",
          partRoomQuantity: 5
        }
      ]
    });
    const backup = await postJson(`${app.url}/api/backups`, { reason: "list restore target" }, 201);
    await postJson(`${app.url}/api/transactions`, {
      occurredOn: "2026-07-14",
      type: "서울에서 파트실로 택배",
      itemId: imported.state.items[0].id,
      quantity: 2
    }, 201);

    const restore = await postJson(`${app.url}/api/backups/${backup.backup.id}/restore`, {}, 200);
    assert.equal(restore.state.dashboard.totalStock, 5);
    assert.equal(restore.restore.restoredFrom, backup.backup.filePath);
    assert.equal(
      restore.state.backups.some(
        (entry) => entry.filePath === restore.restore.beforeRestoreBackup.filePath
      ),
      true
    );

    const after = await getJson(`${app.url}/api/state`);
    assert.equal(after.dashboard.totalStock, 5);
    assert.equal(
      after.backups.some((entry) => entry.filePath === restore.restore.beforeRestoreBackup.filePath),
      true
    );
  } finally {
    await app.close();
  }
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(url, body, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, payload.error);
  return payload;
}

async function patchJson(url, body, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, payload.error);
  return payload;
}

async function deleteJson(url, body, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, payload.error);
  return payload;
}

async function postBinary(url, body, expectedStatus = 200) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, payload.error);
  return payload;
}
