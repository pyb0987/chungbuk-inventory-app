const state = {
  data: null,
  activeView: "dashboard",
  inventorySearch: "",
  itemSearch: "",
  adjustmentItemSearch: "",
  serialItemSearch: "",
  transactionSearch: "",
  serialSearch: "",
  editingTransactionId: null,
  editingSerialId: null
};

const movementText = {
  personal_out: "파트실 - / 개인 +",
  personal_in: "개인 - / 파트실 +",
  return_to_seoul: "파트실 - / 서울",
  seoul_to_part_room: "서울 / 파트실 +",
  office_out: "파트실 - / 사무실 +",
  office_in: "사무실 - / 파트실 +"
};

const needsPerson = new Set(["personal_in", "personal_out"]);
const itemPickerLimit = 12;

const elements = {
  status: document.querySelector("#status-line"),
  metrics: document.querySelector("#metric-grid"),
  recentTransactions: document.querySelector("#recent-transactions"),
  recentImport: document.querySelector("#recent-import"),
  recentBackup: document.querySelector("#recent-backup"),
  inventoryTable: document.querySelector("#inventory-table"),
  transactionTable: document.querySelector("#transaction-table"),
  transactionForm: document.querySelector("#transaction-form"),
  adjustmentForm: document.querySelector("#adjustment-form"),
  itemForm: document.querySelector("#item-form"),
  personForm: document.querySelector("#person-form"),
  itemTable: document.querySelector("#item-table"),
  personTable: document.querySelector("#person-table"),
  serialForm: document.querySelector("#serial-form"),
  serialTable: document.querySelector("#serial-table"),
  serialSearch: document.querySelector("#serial-search"),
  importForm: document.querySelector("#import-form"),
  importResult: document.querySelector("#import-result"),
  usageImportForm: document.querySelector("#usage-import-form"),
  usageImportResult: document.querySelector("#usage-import-result"),
  importRunTable: document.querySelector("#import-run-table"),
  legacyUsageTable: document.querySelector("#legacy-usage-table"),
  backupForm: document.querySelector("#backup-form"),
  restoreForm: document.querySelector("#restore-form"),
  restoreResult: document.querySelector("#restore-result"),
  backupTable: document.querySelector("#backup-table"),
  auditTable: document.querySelector("#audit-table"),
  auditSearch: document.querySelector("#audit-search"),
  auditFrom: document.querySelector("#audit-from"),
  auditTo: document.querySelector("#audit-to"),
  movementPreview: document.querySelector("#movement-preview"),
  adjustmentPreview: document.querySelector("#adjustment-preview"),
  inventorySearch: document.querySelector("#inventory-search"),
  transactionSearch: document.querySelector("#transaction-search"),
  cancelTransactionEdit: document.querySelector("#cancel-transaction-edit"),
  cancelSerialEdit: document.querySelector("#cancel-serial-edit")
};

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupForms();
  setDefaultDates();
  refreshState();
});

function setupNavigation() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeView = button.dataset.view;
      document.querySelectorAll(".nav-button").forEach((entry) => {
        entry.classList.toggle("active", entry === button);
      });
      document.querySelectorAll(".view").forEach((view) => {
        view.classList.toggle("active", view.id === `view-${state.activeView}`);
      });
    });
  });
  document.querySelector("#refresh-button").addEventListener("click", refreshState);
}

function setupForms() {
  elements.inventorySearch.addEventListener("input", (event) => {
    state.inventorySearch = searchKey(event.target.value);
    renderInventory();
  });

  elements.transactionSearch.addEventListener("input", (event) => {
    state.transactionSearch = searchKey(event.target.value);
    renderTransactions();
  });

  elements.serialSearch.addEventListener("input", (event) => {
    state.serialSearch = searchKey(event.target.value);
    renderSerials();
  });

  elements.auditSearch.addEventListener("input", () => {
    renderAuditLog();
  });
  elements.auditFrom.addEventListener("change", renderAuditLog);
  elements.auditTo.addEventListener("change", renderAuditLog);

  elements.transactionForm.type.addEventListener("change", updateTransactionFormState);
  elements.transactionForm.itemSearch.addEventListener("input", (event) => {
    state.itemSearch = searchKey(event.target.value);
    elements.transactionForm.itemId.value = "";
    renderTransactionControls();
  });

  elements.adjustmentForm.bucket.addEventListener("change", updateAdjustmentFormState);
  elements.adjustmentForm.itemSearch.addEventListener("input", (event) => {
    state.adjustmentItemSearch = searchKey(event.target.value);
    elements.adjustmentForm.itemId.value = "";
    renderAdjustmentControls();
  });
  elements.adjustmentForm.quantityDelta.addEventListener("input", updateAdjustmentFormState);
  elements.adjustmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const form = new FormData(elements.adjustmentForm);
      if (!form.get("itemId")) {
        setStatus("품목을 선택하세요");
        return;
      }
      await apiRequest("/api/stock-adjustments", {
        method: "POST",
        body: {
          occurredOn: form.get("occurredOn"),
          itemId: form.get("itemId"),
          bucket: form.get("bucket"),
          holderId: form.get("holderId"),
          quantityDelta: form.get("quantityDelta"),
          reason: form.get("reason")
        }
      });
      elements.adjustmentForm.quantityDelta.value = "";
      elements.adjustmentForm.reason.value = "";
      updateAdjustmentFormState();
      setStatus("재고 조정됨");
    });
  });

  elements.transactionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const form = new FormData(elements.transactionForm);
      const editingId = form.get("editingId");
      if (!form.get("itemId")) {
        setStatus("품목을 선택하세요");
        return;
      }
      const payload = {
        occurredOn: form.get("occurredOn"),
        type: form.get("type"),
        itemId: form.get("itemId"),
        personId: form.get("personId"),
        quantity: form.get("quantity"),
        note: form.get("note")
      };
      if (editingId) {
        await apiRequest(`/api/transactions/${editingId}`, {
          method: "PATCH",
          body: { ...payload, reason: "화면에서 입출고 수정" }
        });
        clearTransactionEditMode();
        setStatus("수정됨");
      } else {
        await apiRequest("/api/transactions", {
          method: "POST",
          body: payload
        });
        resetTransactionFormFields();
        setStatus("저장됨");
      }
    });
  });

  elements.cancelTransactionEdit.addEventListener("click", clearTransactionEditMode);

  elements.itemForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const name = new FormData(elements.itemForm).get("name");
      await apiRequest("/api/items", { method: "POST", body: { name } });
      elements.itemForm.reset();
      setStatus("품목 추가됨");
    });
  });

  elements.personForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const name = new FormData(elements.personForm).get("name");
      await apiRequest("/api/people", { method: "POST", body: { name } });
      elements.personForm.reset();
      setStatus("개인 추가됨");
    });
  });

  elements.serialForm.itemSearch.addEventListener("input", (event) => {
    state.serialItemSearch = searchKey(event.target.value);
    elements.serialForm.itemId.value = "";
    renderSerialControls();
  });

  elements.serialForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const form = new FormData(elements.serialForm);
      if (!form.get("itemId")) {
        setStatus("품목을 선택하세요");
        return;
      }
      const editingId = form.get("editingId");
      const payload = {
        itemId: form.get("itemId"),
        serialText: form.get("serialText"),
        holderText: form.get("holderText"),
        note: form.get("note")
      };
      if (editingId) {
        await apiRequest(`/api/serials/${editingId}`, {
          method: "PATCH",
          body: { ...payload, reason: "화면에서 시리얼 수정" }
        });
        clearSerialEditMode();
        setStatus("시리얼 수정됨");
      } else {
        await apiRequest("/api/serials", {
          method: "POST",
          body: payload
        });
        resetSerialFormForNewEntry();
        renderSerialControls();
        setStatus("시리얼 저장됨");
      }
    });
  });

  elements.cancelSerialEdit.addEventListener("click", clearSerialEditMode);

  elements.importForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const form = new FormData(elements.importForm);
      const selectedFile = form.get("workbookFile");
      const response =
        selectedFile && selectedFile.size > 0
          ? await importWorkbookFile(form, selectedFile)
          : await importPastedRows(form);
      renderImportResult(response.report);
      setStatus("가져오기 완료");
    }, elements.importResult);
  });

  elements.importForm.workbookFile.addEventListener("change", () => {
    const [file] = elements.importForm.workbookFile.files;
    if (file) {
      elements.importForm.sourceFile.value = file.name;
    }
  });

  elements.usageImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const form = new FormData(elements.usageImportForm);
      const [file] = elements.usageImportForm.usageWorkbookFile.files;
      if (!file) {
        throw new Error("사용내역 .xlsb 또는 .xlsx 파일을 선택하세요");
      }
      const response = await importUsageWorkbookFile(form, file);
      renderUsageImportResult(response.report);
      setStatus("사용내역 가져오기 완료");
    }, elements.usageImportResult);
  });

  elements.usageImportForm.usageWorkbookFile.addEventListener("change", () => {
    const [file] = elements.usageImportForm.usageWorkbookFile.files;
    if (file) {
      elements.usageImportForm.sourceFile.value = file.name;
    }
  });

  elements.backupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const reason = new FormData(elements.backupForm).get("reason");
      await apiRequest("/api/backups", { method: "POST", body: { reason } });
      setStatus("백업 생성됨");
    });
  });

  elements.restoreForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runUiAction(async () => {
      const [file] = elements.restoreForm.backupFile.files;
      if (!file) {
        throw new Error("복원할 백업 파일을 선택하세요");
      }
      const confirmed = window.confirm("현재 데이터가 선택한 백업으로 교체됩니다. 계속할까요?");
      if (!confirmed) {
        return;
      }
      const response = await fetch("/api/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream"
        },
        body: await file.arrayBuffer()
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "복원에 실패했습니다");
      }
      state.data = payload.state;
      render();
      renderRestoreSuccess(payload.restore);
      elements.restoreForm.reset();
      setStatus("복원 완료");
    }, elements.restoreResult);
  });
}

function setDefaultDates() {
  const today = localIsoDate(new Date());
  elements.transactionForm.occurredOn.value = today;
  elements.adjustmentForm.occurredOn.value = today;
  elements.importForm.occurredOn.value = today;
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function refreshState() {
  setStatus("불러오는 중");
  await apiRequest("/api/state");
  setStatus("준비됨");
}

async function apiRequest(path, options = {}) {
  const init = { method: options.method ?? "GET" };
  if (options.body) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  const response = await fetchLocalApi(path, init, "로컬 앱 서버에 연결할 수 없습니다");
  const payload = await readApiPayload(response, "요청에 실패했습니다");
  if (!response.ok) {
    setStatus("오류");
    throw new Error(payload.error ?? "요청에 실패했습니다");
  }
  if (payload.state) {
    state.data = payload.state;
  } else {
    state.data = payload;
  }
  render();
  return payload;
}

async function importWorkbookFile(form, file) {
  const query = new URLSearchParams({
    sourceFile: form.get("sourceFile") || file.name,
    occurredOn: form.get("occurredOn"),
    mode: form.get("mode"),
    allowPartial: String(form.get("allowPartial") === "on"),
    allowDuplicate: String(form.get("allowDuplicate") === "on")
  });
  const response = await fetchLocalApi(
    `/api/import/current-stock-xlsx?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: await file.arrayBuffer()
    },
    "가져오기 요청이 로컬 서버에 도달하지 못했습니다"
  );
  const payload = await readApiPayload(response, "재고현황 가져오기에 실패했습니다");
  if (!response.ok) {
    setStatus("오류");
    throw new Error(payload.error ?? "재고현황 가져오기에 실패했습니다");
  }
  state.data = payload.state;
  render();
  return payload;
}

async function importUsageWorkbookFile(form, file) {
  const query = new URLSearchParams({
    sourceFile: form.get("sourceFile") || file.name,
    allowPartial: String(form.get("allowPartial") === "on"),
    allowDuplicate: String(form.get("allowDuplicate") === "on")
  });
  const response = await fetchLocalApi(
    `/api/import/usage-history-xlsx?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      },
      body: await file.arrayBuffer()
    },
    "사용내역 가져오기 요청이 로컬 서버에 도달하지 못했습니다"
  );
  const payload = await readApiPayload(response, "사용내역 가져오기에 실패했습니다");
  if (!response.ok) {
    setStatus("오류");
    throw new Error(payload.error ?? "사용내역 가져오기에 실패했습니다");
  }
  state.data = payload.state;
  render();
  return payload;
}

async function fetchLocalApi(path, init, message) {
  try {
    return await fetch(path, init);
  } catch (error) {
    throw new Error(
      `${message}. ChungbukInventory.exe 창이 실행 중인지 확인하세요. 계속 실패하면 user-data\\logs\\app.log를 확인하세요. (${error.message})`
    );
  }
}

async function readApiPayload(response, fallbackMessage) {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${fallbackMessage}: 서버 응답을 읽을 수 없습니다. HTTP ${response.status}`);
  }
}

async function importPastedRows(form) {
  const rows = parsePastedRows(form.get("rowsText"));
  return apiRequest("/api/import/current-stock", {
    method: "POST",
    body: {
      sourceFile: form.get("sourceFile"),
      occurredOn: form.get("occurredOn"),
      mode: form.get("mode"),
      allowPartial: form.get("allowPartial") === "on",
      allowDuplicate: form.get("allowDuplicate") === "on",
      rows
    }
  });
}

function render() {
  if (!state.data) {
    return;
  }
  renderMetrics();
  renderDashboard();
  renderInventory();
  renderTransactionControls();
  renderAdjustmentControls();
  renderMasterDataTables();
  renderTransactions();
  renderSerialControls();
  renderSerials();
  renderImportRuns();
  renderLegacyUsageRecords();
  renderBackups();
  renderAuditLog();
}

function renderMetrics() {
  const dashboard = state.data.dashboard;
  const metrics = [
    ["합계", dashboard.totalStock],
    ["파트실", dashboard.partRoomStock],
    ["개인차량", dashboard.personalVehicleStock],
    ["사무실", dashboard.officeStock],
    ["서울로 반납", dashboard.seoulReturnedCount],
    ["서울에서 파트실로 택배", dashboard.seoulReceivedCount],
    ["입출고", dashboard.activeTransactionCount],
    ["삭제된 입출고", dashboard.deletedTransactionCount],
    ["시리얼", dashboard.activeSerialCount],
    ["삭제된 시리얼", dashboard.deletedSerialCount],
    ["백업", dashboard.backupCount]
  ];
  elements.metrics.innerHTML = metrics
    .map(([label, value]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></article>`)
    .join("");
}

function renderDashboard() {
  const recent = state.data.transactions.filter((row) => !row.isDeleted).slice(0, 8);
  elements.recentTransactions.innerHTML = recent.length
    ? recent
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.date)}</td>
              <td>${escapeHtml(row.label)}</td>
              <td>${escapeHtml(row.itemName)}</td>
              <td class="number">${formatNumber(row.quantity)}</td>
            </tr>`
        )
        .join("")
    : emptyRow(4, "기록 없음");

  const recentImport = state.data.importRuns[0];
  elements.recentImport.innerHTML = recentImport
    ? `<p><span class="badge">${escapeHtml(formatStatus(recentImport.status))}</span></p>
       <p>${escapeHtml(recentImport.sourceFile)}</p>
       <p class="muted">${escapeHtml(recentImport.createdAt)}</p>`
    : "기록 없음";

  const recentBackup = state.data.dashboard.latestBackup;
  elements.recentBackup.innerHTML = recentBackup
    ? `<p><span class="badge">${escapeHtml(formatStatus(recentBackup.status))}</span></p>
       <p>${escapeHtml(formatReason(recentBackup.reason))}</p>
       <p title="${escapeHtml(recentBackup.filePath)}">${escapeHtml(fileNameFromPath(recentBackup.filePath))}</p>
       <p class="muted">${escapeHtml(recentBackup.createdAt)}</p>`
    : "기록 없음";
}

function renderImportRuns() {
  const rows = state.data.importRuns;
  elements.importRunTable.innerHTML = rows.length
    ? rows
        .map((row) => {
          const report = row.report ?? {};
          return `
            <tr>
              <td>${escapeHtml(row.createdAt)}</td>
              <td>${escapeHtml(row.sourceFile)}</td>
              <td><span class="badge ${row.status === "completed" ? "" : "warn"}">${escapeHtml(formatStatus(row.status))}</span></td>
              <td class="number">${formatNumber(report.importedRows ?? 0)}</td>
              <td class="number">${formatNumber(report.skippedRows ?? 0)}</td>
              <td>${escapeHtml(formatImportCreatedCounts(report))}</td>
            </tr>`;
        })
        .join("")
    : emptyRow(6, "가져오기 기록 없음");
}

function renderLegacyUsageRecords() {
  const rows = state.data.legacyUsageRecords.slice(0, 200);
  elements.legacyUsageTable.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.occurredOn ?? "")}</td>
              <td>${escapeHtml(row.legacyLabel)}</td>
              <td>${escapeHtml(row.appLabel)}</td>
              <td>${escapeHtml(row.personName ?? "")}</td>
              <td>${escapeHtml(row.itemName)}</td>
              <td>${escapeHtml(row.serialText ?? "")}</td>
              <td class="number">${formatNumber(row.quantity)}</td>
              <td>${escapeHtml(row.note ?? "")}</td>
            </tr>`
        )
        .join("")
    : emptyRow(8, "사용내역 기록 없음");
}

function renderInventory() {
  const inventory = state.data.inventory;
  const rows = inventory.rows.filter((row) =>
    searchKey(row.itemName).includes(state.inventorySearch)
  );

  elements.inventoryTable.innerHTML = `
    <thead>
      <tr>${inventory.columns.map((column, index) => `<th class="${index === 0 ? "" : "number"}">${escapeHtml(column)}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${
        rows.length
          ? rows
              .map((row) => {
                const peopleCells = inventory.people
                  .map((person) => `<td class="number">${formatNumber(row.personHoldings[person.name] ?? 0)}</td>`)
                  .join("");
                return `
                  <tr>
                    <td>${escapeHtml(row.itemName)}</td>
                    <td class="number">${formatNumber(row.partRoomQuantity)}</td>
                    ${peopleCells}
                    <td class="number">${formatNumber(row.officeQuantity)}</td>
                    <td class="number">${formatNumber(row.holderTotal)}</td>
                    <td class="number"><strong>${formatNumber(row.totalQuantity)}</strong></td>
                  </tr>`;
              })
              .join("")
          : emptyRow(inventory.columns.length, "표시할 품목 없음")
      }
    </tbody>`;
}

function renderTransactionControls() {
  const typeSelect = elements.transactionForm.type;
  const selectedType = typeSelect.value || "personal_out";
  const selectedItemId = elements.transactionForm.itemId.value;
  typeSelect.innerHTML = state.data.transactionTypes
    .map((entry) => `<option value="${entry.type}">${escapeHtml(entry.label)}</option>`)
    .join("");
  typeSelect.value = selectedType;

  renderItemPicker({
    form: elements.transactionForm,
    picker: "transaction",
    search: state.itemSearch,
    selectedItemId
  });
  elements.transactionForm.personId.innerHTML = selectablePeople(elements.transactionForm.personId.value)
    .map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`)
    .join("");
  elements.transactionForm.personId.insertAdjacentHTML("afterbegin", '<option value="">개인을 선택하세요</option>');
  updateTransactionFormState();
  renderTransactionEditMode();
}

function renderAdjustmentControls() {
  const selectedItemId = elements.adjustmentForm.itemId.value;
  const selectedBucket = elements.adjustmentForm.bucket.value || "part_room";
  const selectedHolderId = elements.adjustmentForm.holderId.value;

  renderItemPicker({
    form: elements.adjustmentForm,
    picker: "adjustment",
    search: state.adjustmentItemSearch,
    selectedItemId
  });

  elements.adjustmentForm.bucket.innerHTML = state.data.adjustmentBuckets
    .map((entry) => `<option value="${entry.bucket}">${escapeHtml(entry.label)}</option>`)
    .join("");
  elements.adjustmentForm.bucket.value = selectedBucket;

  elements.adjustmentForm.holderId.innerHTML = selectablePeople(selectedHolderId)
    .map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`)
    .join("");
  if (state.data.people.some((person) => String(person.id) === selectedHolderId)) {
    elements.adjustmentForm.holderId.value = selectedHolderId;
  }
  updateAdjustmentFormState();
}

function renderSerialControls() {
  const selectedItemId = elements.serialForm.itemId.value;
  renderItemPicker({
    form: elements.serialForm,
    picker: "serial",
    search: state.serialItemSearch,
    selectedItemId
  });
  renderSerialEditMode();
}

function renderItemPicker({ form, picker, search, selectedItemId }) {
  const input = form.itemSearch;
  const hiddenInput = form.itemId;
  const list = form.querySelector(`[data-item-picker-list="${picker}"]`);
  const selectedItem = state.data.items.find((item) => String(item.id) === String(selectedItemId));

  if (selectedItem && !search && input.value !== selectedItem.name) {
    input.value = selectedItem.name;
  }

  if (!search) {
    list.innerHTML = selectedItem
      ? `<div class="item-picker-selection">선택됨: ${escapeHtml(selectedItem.name)}</div>`
      : `<div class="item-picker-empty">품목명을 입력하세요</div>`;
    return;
  }

  const matches = filterItemsBySearch(search, selectedItemId).slice(0, itemPickerLimit);
  hiddenInput.value = selectedItem && searchKey(selectedItem.name) === search ? String(selectedItem.id) : "";
  list.innerHTML = matches.length
    ? matches
        .map(
          (item) => `
            <button class="item-suggestion" type="button" role="option" data-select-item="${item.id}" data-picker="${picker}">
              ${escapeHtml(item.name)}
            </button>`
        )
        .join("")
    : `<div class="item-picker-empty">일치하는 품목 없음</div>`;
}

function filterItemsBySearch(search, selectedItemId) {
  const sourceItems = state.data.activeItems ?? state.data.items;
  if (!search) {
    return withSelectedRecord(sourceItems, state.data.items, selectedItemId);
  }
  const matches = sourceItems.filter((item) => searchKey(item.name).includes(search));
  return withSelectedRecord(matches, state.data.items, selectedItemId);
}

function selectablePeople(selectedPersonId) {
  const sourcePeople = state.data.activePeople ?? state.data.people;
  return withSelectedRecord(sourcePeople, state.data.people, selectedPersonId);
}

function withSelectedRecord(records, allRecords, selectedId) {
  const selectedRecord = allRecords.find((record) => String(record.id) === String(selectedId));
  if (selectedRecord && !records.some((record) => record.id === selectedRecord.id)) {
    return [selectedRecord, ...records];
  }
  return records;
}

function updateTransactionFormState() {
  const type = elements.transactionForm.type.value;
  const personRequired = needsPerson.has(type);
  elements.transactionForm.personId.disabled = !personRequired;
  elements.transactionForm.personId.required = personRequired;
  elements.movementPreview.textContent = movementText[type] ?? "변동 대기";
}

function updateAdjustmentFormState() {
  const bucket = elements.adjustmentForm.bucket.value;
  const requiresHolder = bucket === "person";
  elements.adjustmentForm.holderId.disabled = !requiresHolder;
  elements.adjustmentForm.holderId.required = requiresHolder;
  const quantity = Number(elements.adjustmentForm.quantityDelta.value || 0);
  const direction = quantity > 0 ? "+" : quantity < 0 ? "-" : "";
  elements.adjustmentPreview.textContent = direction
    ? `${bucketLabel(bucket)} ${direction}${Math.abs(quantity)}`
    : "재고 조정 대기";
}

function bucketLabel(bucket) {
  return state.data.adjustmentBuckets.find((entry) => entry.bucket === bucket)?.label ?? bucket;
}

function renderMasterDataTables() {
  elements.itemTable.innerHTML = state.data.items.length
    ? state.data.items
        .map((item) => renderMasterDataRow(item, "item"))
        .join("")
    : emptyRow(3, "품목 없음");

  elements.personTable.innerHTML = state.data.people.length
    ? state.data.people
        .map((person) => renderMasterDataRow(person, "person"))
        .join("")
    : emptyRow(3, "개인 없음");
}

function renderMasterDataRow(record, kind) {
  const active = Boolean(record.isActive);
  const action = active
    ? `<div class="action-group">
        <button class="danger-button" type="button" data-deactivate-${kind}="${record.id}">비활성화</button>
        ${kind === "item" ? `<button class="danger-button" type="button" data-permanent-delete-item="${record.id}">영구 삭제</button>` : ""}
      </div>`
    : `<button class="secondary-button" type="button" data-activate-${kind}="${record.id}">복원</button>`;
  return `
    <tr class="${active ? "" : "deleted"}">
      <td>${escapeHtml(record.name)}</td>
      <td>${active ? '<span class="badge">사용</span>' : '<span class="badge deleted">비활성</span>'}</td>
      <td>${action}</td>
    </tr>`;
}

function renderTransactions() {
  const term = state.transactionSearch;
  const rows = state.data.transactions.filter((row) => {
    const text = searchKey([row.date, row.label, row.itemName, row.personName, row.note].join(" "));
    return text.includes(term);
  });

  elements.transactionTable.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr class="${row.isDeleted ? "deleted" : ""}">
              <td>${escapeHtml(row.date)}</td>
              <td>${escapeHtml(row.label)}</td>
              <td>${escapeHtml(row.itemName)}</td>
              <td>${escapeHtml(row.personName)}</td>
              <td class="number">${formatNumber(row.quantity)}</td>
              <td>${escapeHtml(row.note ?? "")}</td>
              <td>${renderTransactionStatus(row)}</td>
              <td>${renderTransactionActions(row)}</td>
            </tr>`
        )
        .join("")
    : emptyRow(8, "입출고 기록 없음");
}

function renderTransactionStatus(row) {
  if (row.isDeleted) {
    return `<span class="badge deleted">삭제됨</span>`;
  }
  return `<span class="badge">정상</span>`;
}

function renderTransactionActions(row) {
  if (row.isDeleted) {
    return `<button class="secondary-button" type="button" data-restore-transaction="${row.id}">복원</button>`;
  }
  return `
    <div class="action-group">
      <button class="secondary-button" type="button" data-edit-transaction="${row.id}">수정</button>
      <button class="danger-button" type="button" data-delete-transaction="${row.id}">삭제</button>
    </div>`;
}

function renderBackups() {
  elements.backupTable.innerHTML = state.data.backups.length
    ? state.data.backups
        .map(
          (backup) => `
            <tr>
              <td>${escapeHtml(backup.createdAt)}</td>
              <td>${escapeHtml(formatReason(backup.reason))}</td>
              <td><span class="badge">${escapeHtml(formatStatus(backup.status))}</span></td>
              <td class="number">${formatBytes(backup.sizeBytes)}</td>
              <td title="${escapeHtml(backup.filePath)}">${escapeHtml(fileNameFromPath(backup.filePath))}</td>
              <td>
                <button class="danger-button" type="button" data-restore-backup="${backup.id}">복원</button>
              </td>
            </tr>`
        )
        .join("")
    : emptyRow(6, "백업 없음");
}

function renderSerials() {
  const rows = state.data.serials.filter((row) =>
    searchKey([row.itemName, row.serialText, row.holderText, row.note].join(" ")).includes(
      state.serialSearch
    )
  );

  elements.serialTable.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr class="${row.isActive ? "" : "deleted"}">
              <td>${escapeHtml(row.itemName)}</td>
              <td>${escapeHtml(row.serialText)}</td>
              <td>${escapeHtml(row.holderText ?? "")}</td>
              <td>${escapeHtml(row.note ?? "")}</td>
              <td>${row.isActive ? '<span class="badge">사용</span>' : '<span class="badge deleted">삭제됨</span>'}</td>
              <td>${renderSerialActions(row)}</td>
            </tr>`
        )
        .join("")
    : emptyRow(6, "시리얼 기록 없음");
}

function renderSerialActions(row) {
  return row.isActive
    ? `<div class="action-group">
        <button class="secondary-button" type="button" data-edit-serial="${row.id}">수정</button>
        <button class="danger-button" type="button" data-delete-serial="${row.id}">삭제</button>
      </div>`
    : `<button class="secondary-button" type="button" data-restore-serial="${row.id}">복원</button>`;
}

function renderAuditLog() {
  const term = searchKey(elements.auditSearch.value);
  const from = elements.auditFrom.value;
  const to = elements.auditTo.value;
  const rows = state.data.auditLog.filter((row) => {
    const date = row.createdAt.slice(0, 10);
    return (!from || date >= from) &&
      (!to || date <= to) &&
      searchKey([
      row.createdAt,
      row.actionLabel,
      row.entityLabel,
      formatReason(row.reason),
      row.beforeSummary,
      row.afterSummary
      ].join(" ")).includes(term);
  });

  elements.auditTable.innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.createdAt)}</td>
              <td>${escapeHtml(row.actionLabel)}</td>
              <td>${escapeHtml(row.entityLabel)} #${escapeHtml(row.entityId)}</td>
              <td>${escapeHtml(formatReason(row.reason))}</td>
              <td>${escapeHtml(row.beforeSummary)}</td>
              <td>${escapeHtml(row.afterSummary)}</td>
            </tr>`
        )
        .join("")
    : emptyRow(6, "변경 기록 없음");
}

document.addEventListener("click", async (event) => {
  const itemButton = event.target.closest("[data-select-item]");
  if (itemButton) {
    selectItemFromPicker(itemButton.dataset.picker, itemButton.dataset.selectItem);
    return;
  }

  const editButton = event.target.closest("[data-edit-transaction]");
  if (editButton) {
    enterTransactionEditMode(Number(editButton.dataset.editTransaction));
    return;
  }

  const transactionDeleteButton = event.target.closest("[data-delete-transaction]");
  if (transactionDeleteButton) {
    const confirmed = window.confirm("이 입출고 기록을 삭제할까요? 기존 기록은 삭제됨 상태로 보관됩니다.");
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      await apiRequest(`/api/transactions/${transactionDeleteButton.dataset.deleteTransaction}`, {
        method: "DELETE",
        body: { reason: "화면에서 입출고 삭제" }
      });
      setStatus("삭제됨");
    });
    return;
  }

  const transactionRestoreButton = event.target.closest("[data-restore-transaction]");
  if (transactionRestoreButton) {
    const confirmed = window.confirm("이 입출고 기록을 복원할까요? 현재 재고가 부족하면 복원되지 않습니다.");
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      await apiRequest(`/api/transactions/${transactionRestoreButton.dataset.restoreTransaction}/restore`, {
        method: "POST",
        body: { reason: "화면에서 입출고 복원" }
      });
      setStatus("입출고 복원됨");
    });
    return;
  }

  const serialEditButton = event.target.closest("[data-edit-serial]");
  if (serialEditButton) {
    enterSerialEditMode(Number(serialEditButton.dataset.editSerial));
    return;
  }

  const serialButton = event.target.closest("[data-delete-serial]");
  if (serialButton) {
    const confirmed = window.confirm("이 시리얼 기록을 삭제할까요? 기존 기록은 삭제됨 상태로 보관됩니다.");
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      await apiRequest(`/api/serials/${serialButton.dataset.deleteSerial}`, {
        method: "DELETE",
        body: { reason: "화면에서 시리얼 삭제" }
      });
      setStatus("시리얼 삭제됨");
    });
    return;
  }

  const serialRestoreButton = event.target.closest("[data-restore-serial]");
  if (serialRestoreButton) {
    const confirmed = window.confirm("이 시리얼 기록을 복원할까요?");
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      await apiRequest(`/api/serials/${serialRestoreButton.dataset.restoreSerial}/restore`, {
        method: "POST",
        body: { reason: "화면에서 시리얼 복원" }
      });
      setStatus("시리얼 복원됨");
    });
    return;
  }

  const restoreBackupButton = event.target.closest("[data-restore-backup]");
  if (restoreBackupButton) {
    const confirmed = window.confirm("현재 데이터가 선택한 백업으로 교체됩니다. 계속할까요?");
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      const payload = await apiRequest(`/api/backups/${restoreBackupButton.dataset.restoreBackup}/restore`, {
        method: "POST",
        body: { reason: "백업 목록에서 복원" }
      });
      renderRestoreSuccess(payload.restore);
      setStatus("복원 완료");
    }, elements.restoreResult);
    return;
  }

  const permanentDeleteItemButton = event.target.closest("[data-permanent-delete-item]");
  if (permanentDeleteItemButton) {
    const confirmed = window.confirm("이 품목을 영구 삭제할까요? 연결된 재고나 기록이 있으면 삭제되지 않습니다.");
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      await apiRequest(`/api/items/${permanentDeleteItemButton.dataset.permanentDeleteItem}`, {
        method: "DELETE",
        body: { permanent: true, reason: "화면에서 품목 영구 삭제" }
      });
      setStatus("품목 영구 삭제됨");
    });
    return;
  }

  await handleMasterDataAction(event, "item", "품목");
  await handleMasterDataAction(event, "person", "개인");
});

function selectItemFromPicker(picker, itemId) {
  const forms = {
    adjustment: elements.adjustmentForm,
    serial: elements.serialForm,
    transaction: elements.transactionForm
  };
  const form = forms[picker];
  const item = state.data.items.find((entry) => String(entry.id) === String(itemId));
  if (!form || !item) {
    return;
  }
  form.itemId.value = String(item.id);
  form.itemSearch.value = item.name;
  if (picker === "adjustment") {
    state.adjustmentItemSearch = "";
    renderAdjustmentControls();
  } else if (picker === "serial") {
    state.serialItemSearch = "";
    renderSerialControls();
  } else {
    state.itemSearch = "";
    renderTransactionControls();
  }
  setStatus(`품목 선택됨: ${item.name}`);
}

async function handleMasterDataAction(event, kind, label) {
  const deactivateButton = event.target.closest(`[data-deactivate-${kind}]`);
  if (deactivateButton) {
    const id = deactivateButton.dataset[`deactivate${capitalize(kind)}`];
    const confirmed = window.confirm(`${label}을 비활성화할까요? 기존 기록은 유지됩니다.`);
    if (!confirmed) {
      return;
    }
    await runUiAction(async () => {
      await apiRequest(`/api/${kind === "item" ? "items" : "people"}/${id}`, {
        method: "DELETE",
        body: { reason: `화면에서 ${label} 비활성화` }
      });
      setStatus(`${label} 비활성화됨`);
    });
    return;
  }

  const activateButton = event.target.closest(`[data-activate-${kind}]`);
  if (activateButton) {
    const id = activateButton.dataset[`activate${capitalize(kind)}`];
    await runUiAction(async () => {
      await apiRequest(`/api/${kind === "item" ? "items" : "people"}/${id}`, {
        method: "PATCH",
        body: { isActive: true, reason: `화면에서 ${label} 복원` }
      });
      setStatus(`${label} 복원됨`);
    });
  }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function enterTransactionEditMode(id) {
  const transaction = state.data.transactions.find((row) => row.id === id);
  if (!transaction || transaction.isDeleted) {
    return;
  }
  state.editingTransactionId = id;
  state.itemSearch = "";
  elements.transactionForm.editingId.value = String(id);
  elements.transactionForm.occurredOn.value = transaction.date;
  elements.transactionForm.type.value = transaction.type;
  elements.transactionForm.itemId.value = String(transaction.itemId);
  elements.transactionForm.itemSearch.value = transaction.itemName;
  elements.transactionForm.personId.value = transaction.personId ? String(transaction.personId) : "";
  elements.transactionForm.quantity.value = transaction.quantity;
  elements.transactionForm.note.value = transaction.note ?? "";
  renderTransactionControls();
  elements.transactionForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearTransactionEditMode() {
  state.editingTransactionId = null;
  elements.transactionForm.editingId.value = "";
  resetTransactionFormForNewEntry();
  renderTransactionControls();
}

function renderTransactionEditMode() {
  const isEditing = Boolean(state.editingTransactionId);
  elements.cancelTransactionEdit.classList.toggle("hidden", !isEditing);
  elements.transactionForm.submitButton.textContent = isEditing ? "수정 저장" : "저장";
  if (isEditing) {
    elements.movementPreview.textContent = `수정 중 #${state.editingTransactionId} · ${movementText[elements.transactionForm.type.value] ?? "변동 확인"}`;
  }
}

function enterSerialEditMode(id) {
  const serial = state.data.serials.find((row) => row.id === id);
  if (!serial || !serial.isActive) {
    return;
  }
  state.editingSerialId = id;
  state.serialItemSearch = "";
  elements.serialForm.editingId.value = String(id);
  elements.serialForm.itemId.value = String(serial.itemId);
  elements.serialForm.itemSearch.value = serial.itemName;
  elements.serialForm.serialText.value = serial.serialText;
  elements.serialForm.holderText.value = serial.holderText ?? "";
  elements.serialForm.note.value = serial.note ?? "";
  renderSerialControls();
  elements.serialForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearSerialEditMode() {
  state.editingSerialId = null;
  resetSerialFormForNewEntry();
  renderSerialControls();
}

function renderSerialEditMode() {
  const isEditing = Boolean(state.editingSerialId);
  elements.cancelSerialEdit.classList.toggle("hidden", !isEditing);
  elements.serialForm.submitButton.textContent = isEditing ? "시리얼 수정 저장" : "시리얼 저장";
}

function resetTransactionFormFields() {
  elements.transactionForm.quantity.value = "";
  elements.transactionForm.note.value = "";
}

function resetTransactionFormForNewEntry() {
  const defaultType = state.data?.transactionTypes?.[0]?.type ?? "personal_out";
  state.itemSearch = "";
  elements.transactionForm.occurredOn.value = localIsoDate(new Date());
  elements.transactionForm.type.value = defaultType;
  elements.transactionForm.itemSearch.value = "";
  elements.transactionForm.itemId.value = "";
  elements.transactionForm.personId.value = "";
  resetTransactionFormFields();
}

function resetSerialFormForNewEntry() {
  state.editingSerialId = null;
  state.serialItemSearch = "";
  elements.serialForm.editingId.value = "";
  elements.serialForm.itemSearch.value = "";
  elements.serialForm.itemId.value = "";
  elements.serialForm.serialText.value = "";
  elements.serialForm.holderText.value = "";
  elements.serialForm.note.value = "";
}

function searchKey(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function renderImportResult(report) {
  const parsedWorkbook = report.parsedWorkbook
    ? `<p>시트 ${formatNumber(report.parsedWorkbook.sheetNames.length)}개, 재고 행 ${formatNumber(report.parsedWorkbook.rowCount)}개 인식</p>`
    : "";
  const errorRows = report.errors?.length
    ? `<ul>${report.errors.map((error) => `<li>${escapeHtml(String(error.rowNumber))}: ${escapeHtml(error.message)}</li>`).join("")}</ul>`
    : "";
  elements.importResult.innerHTML = `
    <p><span class="badge ${report.status === "completed" ? "" : "warn"}">${escapeHtml(formatStatus(report.status))}</span></p>
    ${parsedWorkbook}
    <p>행 ${formatNumber(report.importedRows)}개 가져옴 / ${formatNumber(report.skippedRows)}개 건너뜀</p>
    <p>품목 ${formatNumber(report.createdItems)}개, 개인 ${formatNumber(report.createdPeople)}명 생성</p>
    ${errorRows}`;
}

function renderUsageImportResult(report) {
  const usageSheets = report.parsedWorkbook?.usageSheets ?? [];
  const parsedWorkbook = report.parsedWorkbook
    ? `<p>시트 ${formatNumber(report.parsedWorkbook.sheetNames.length)}개, 사용내역 행 ${formatNumber(report.parsedWorkbook.rowCount)}개 인식</p>`
    : "";
  const sheetCounts = usageSheets.length
    ? `<p>${usageSheets.map((sheet) => `${escapeHtml(sheet.sheetName)} ${formatNumber(sheet.rowCount)}개`).join(" / ")}</p>`
    : "";
  const errorRows = report.errors?.length
    ? `<ul>${report.errors.map((error) => `<li>${escapeHtml(String(error.rowNumber))}: ${escapeHtml(error.message)}</li>`).join("")}</ul>`
    : "";
  elements.usageImportResult.innerHTML = `
    <p><span class="badge ${report.status === "completed" ? "" : "warn"}">${escapeHtml(formatStatus(report.status))}</span></p>
    ${parsedWorkbook}
    ${sheetCounts}
    <p>참고 기록 ${formatNumber(report.importedRows)}개 가져옴 / ${formatNumber(report.skippedRows)}개 건너뜀</p>
    <p>수량 합계 ${formatNumber(report.totalQuantity ?? 0)}</p>
    ${errorRows}`;
}

function formatImportCreatedCounts(report) {
  return `품목 ${formatNumber(report.createdItems ?? 0)} / 개인 ${formatNumber(report.createdPeople ?? 0)}`;
}

function formatStatus(status) {
  return {
    completed: "완료",
    completed_with_errors: "오류 포함 완료",
    failed_validation: "검증 실패",
    pending: "대기 중",
    failed: "실패"
  }[status] ?? String(status ?? "");
}

function formatReason(reason) {
  if (!reason) {
    return "";
  }
  const exactReason = {
    "updated from UI": "화면에서 수정",
    "deleted from UI": "화면에서 삭제",
    "restored from UI": "화면에서 복원",
    "deactivated from UI": "화면에서 비활성화",
    "reactivated from UI": "화면에서 복원",
    "restore from backup list": "백업 목록에서 복원",
    "before restore from UI": "복원 전 자동 백업",
    "manual backup": "수동 백업"
  }[reason];
  if (exactReason) {
    return exactReason;
  }
  if (reason.startsWith("initial import: ")) {
    return `최초 가져오기: ${reason.slice("initial import: ".length)}`;
  }
  if (reason.startsWith("before current stock import: ")) {
    return `현재 재고 가져오기 전 자동 백업: ${reason.slice("before current stock import: ".length)}`;
  }
  if (reason.startsWith("before usage history import: ")) {
    return `사용내역 가져오기 전 자동 백업: ${reason.slice("before usage history import: ".length)}`;
  }
  return reason;
}

function renderRestoreSuccess(restore) {
  const beforeRestoreBackup = restore?.beforeRestoreBackup;
  const backupName = beforeRestoreBackup ? fileNameFromPath(beforeRestoreBackup.filePath) : "";
  elements.restoreResult.innerHTML = `<p>복원 완료. 복원 전 백업: ${escapeHtml(backupName)}</p>`;
}

function parsePastedRows(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("붙여넣기 표에는 헤더와 최소 1개 행이 필요합니다");
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitRow(lines[0], delimiter);
  const itemIndex = findHeader(headers, ["품목", "하드웨어명", "item", "itemName"]);
  const partRoomIndex = findHeader(headers, ["파트실", "partRoomQuantity", "part_room"]);
  const officeIndex = findHeader(headers, ["사무실", "officeQuantity", "office"]);

  if (itemIndex === -1 || partRoomIndex === -1) {
    throw new Error("헤더에는 품목과 파트실이 필요합니다");
  }

  return lines.slice(1).map((line, index) => {
    const cells = splitRow(line, delimiter);
    const personHoldings = {};
    headers.forEach((header, headerIndex) => {
      if ([itemIndex, partRoomIndex, officeIndex].includes(headerIndex)) {
        return;
      }
      const quantity = toInteger(cells[headerIndex] ?? "0");
      if (quantity > 0) {
        personHoldings[header] = quantity;
      }
    });
    return {
      rowNumber: index + 2,
      itemName: cells[itemIndex],
      partRoomQuantity: toInteger(cells[partRoomIndex]),
      officeQuantity: officeIndex === -1 ? 0 : toInteger(cells[officeIndex]),
      personHoldings
    };
  });
}

function splitRow(line, delimiter) {
  return line.split(delimiter).map((cell) => cell.trim());
}

function findHeader(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function toInteger(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (normalized === "") {
    return 0;
  }
  const number = Number(normalized);
  if (!Number.isInteger(number)) {
    throw new Error(`정수 수량이 아닙니다: ${value}`);
  }
  return number;
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}" class="muted">${escapeHtml(message)}</td></tr>`;
}

function setStatus(message) {
  elements.status.textContent = message;
  elements.status.title = message;
}

async function runUiAction(action, errorTarget = null) {
  try {
    await action();
  } catch (error) {
    setStatus(`오류: ${error.message}`);
    if (errorTarget) {
      errorTarget.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
    }
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(value ?? 0);
}

function formatBytes(value) {
  if (!value) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  return `${(value / 1024).toFixed(1)} KB`;
}

function fileNameFromPath(filePath) {
  const normalized = String(filePath ?? "").replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
