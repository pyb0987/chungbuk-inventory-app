# Chungbuk Inventory App

Local inventory management app intended to replace two Excel workbooks that can drift out of sync.

## Implementation Status

Implementation has started with:

- pure JavaScript stock-rule engine,
- Node test coverage for confirmed transaction semantics,
- local browser UI served by a Node app server,
- initial SQLite schema,
- SQLite database initialization and repository functions,
- transaction create/update/soft-delete workflows,
- inventory bucket summaries for part room, personal, office, and total stock,
- UI-facing read models for dashboard, Excel-like inventory, transaction history,
  backup list, and import history,
- user-provided current-stock import service with import reports,
- direct `.xlsx` current-stock parser for the `재고현황` workbook layout,
- SQLite backup file creation and restore validation,
- automatic daily backup before the first data-changing action of the day,
- Excel sheet mapping template,
- Electron-compatible architecture notes,
- Windows `.exe` launcher, fallback `.cmd` launcher, and portable-folder
  preparation script.

Explicitly deferred:

- Excel export is not part of the current implementation slice.
- Legacy-format `.xlsx` export should start only after the sheet-level mapping
  table and export acceptance criteria are confirmed.
- Real inventory data should not be bundled with the finished app. The user
  should import their own current data during setup.

Current verification:

```bash
npm test
npm run check
```

Both commands pass in the current workspace. Current test coverage includes
stock movements, SQLite repositories, transaction edit/delete recalculation,
negative-stock blocking, audit rows, backup metadata, backup file creation, and
restore validation, UI read models for Excel-familiar information, and
user-provided current-stock imports. The test suite also smoke-tests the local
HTTP server and static UI.

Run the local app:

```bash
npm start
```

Then open the printed local URL. By default the app stores its SQLite database
at `data/chungbuk-inventory.sqlite` and backups under `data/backups`.

Windows handoff launcher:

```text
ChungbukInventory.exe
```

The `.exe` launcher stores real user data under `user-data/` next to the
launcher, starts the bundled runtime, opens `http://127.0.0.1:5177/`, and shows
a small stop/open-browser control window. `START_CHUNGBUK_APP.cmd` remains as a
fallback/debug launcher. The release requires a bundled Windows Node.js 25+
runtime at `runtime\node\node.exe`; it intentionally does not fall back to
system Node for handoff.

Prepare a portable folder without stale inventory data:

```bash
npm run prepare:portable
```

This creates `dist/chungbuk-inventory-portable/`, copies the app source and
launcher, creates an empty `user-data/backups/` folder, and intentionally does
not copy the development `data/` database.

Validate the prepared folder:

```bash
npm run validate:portable
```

Before real Windows handoff, add `runtime/node/node.exe`, build
`ChungbukInventory.exe` on Windows, and run:

```bash
BUILD_WINDOWS_LAUNCHER.cmd
npm run validate:portable:release
npm run validate:portable:zip
```

Create a review zip:

```bash
npm run package:portable
```

Create the final release zip after adding the bundled Windows runtime:

```bash
npm run package:portable:release
```

See [docs/windows-handoff-checklist.md](docs/windows-handoff-checklist.md) for
the full handoff checklist.

End-user Korean guide:

```text
docs/user-guide-ko.md
```

Windows smoke-test guide:

```text
docs/windows-smoke-test-ko.md
```

Requester handoff/acceptance guides:

```text
docs/handoff-message-ko.md
docs/requester-acceptance-checklist-ko.md
```

Current UI screens:

- dashboard summary for `합계`, `파트실`, `개인차량`, `사무실`, Seoul movement
  counts, active/deleted transaction counts, active/deleted serial counts,
  backup count, recent import, and latest backup,
- Excel-like inventory table with one column per person,
- transaction entry for `개인 입고`, `개인 출고`, `서울로 반납`,
  `서울에서 파트실로 택배`, and `사무실 사용/보유`,
- transaction correction through edit mode, with stock recalculated and
  negative-stock edits rejected,
- direct stock adjustment for opening balances, reconciliation, and correction
  notes, with negative-stock adjustments rejected,
- item/person management with reversible deactivation so old history stays intact
  while inactive records disappear from new-entry selectors,
- serial number registration/edit/search with duplicate serials allowed,
- item/person registration,
- pasted-table current-stock import into normalized rows,
- direct `.xlsx` current-stock import from the `재고현황` workbook shape,
- import history table with source file, status, imported/skipped rows, and
  created item/person counts,
- automatic daily backup, manual backup creation, backup restore, and backup
  history,
- change history view for stock adjustments, transaction create/update/delete/
  restore, item/person activation changes, and serial create/update/delete/
  restore audit entries.

Recent safety fixes:

- current-stock import is blocked after a successful opening import unless
  explicit additive mode is chosen,
- exact duplicate current-stock snapshots are blocked even in additive mode
  unless the user explicitly allows duplicate import,
- invalid import rows do not mutate stock by default,
- partial import requires explicit `allowPartial`,
- stock adjustments validate known buckets and person holders,
- nested transactions use SQLite savepoints,
- restore rejects open target databases and non-app SQLite files.
- restore rejects app-shaped backups that contain invalid stock buckets, invalid
  holder/person stock rows, invalid transaction types, invalid boolean flags,
  missing serial-number tables, foreign-key violations, or negative internal
  stock.
- automatic daily backup is created once per day before the first data-changing
  action.
- Windows launcher now requires a bundled Node runtime and opens the browser
  only after the local server starts.
- portable package creation now rebuilds, validates, and zips the handoff
  folder; release packaging refuses to proceed without `runtime/node/node.exe`
  and validates the generated zip artifact directly.
- the transaction entry dropdown uses clearer `개인 입고` / `개인 출고` labels
  while preserving `입고` / `출고` as the historical transaction labels.
- Windows release zip includes `VERIFY_CHUNGBUK_APP.cmd` and a Korean
  smoke-test guide for pre-import verification on the target PC.
- requester-facing handoff message and acceptance checklist are included in
  the release docs.
- Korean end-user guide added for first run, Excel import, daily entry,
  adjustment, serials, and backup/restore.

## Goal

Build a simple Windows-friendly local program for one user. The app should import the existing Excel files once, then become the single place to update inventory and transaction data.

When complete, the app is expected to replace the two existing Excel workbooks. Excel import is needed for initial migration, and Excel export is still useful for backup/reporting.

## Proposed Runtime

- Local browser app opened from a folder.
- No required Python installation.
- No required server if feasible.
- Excel import/export should remain available.
- Excel export should preserve the existing workbook format as closely as possible.
- Preferred implementation shape: portable local app folder with bundled runtime and SQLite.

Current implementation priority:

1. Stock rules and validation.
2. Local SQLite persistence.
3. Transaction/inventory UI.
4. Backup/audit behavior.
5. Excel import/migration support.
6. Excel export later, after workbook mapping is complete.

## Current Source Files

- Inventory status workbook: `충북사무소 재고현황 260601.xlsx`
- Usage / parts request workbook: `충북사무소 사용내역 부품신청서 2602.xlsb`

## Core Data Areas

- Personal vehicle inventory
- Office / part-room inventory
- Personal inbound/outbound records
- Seoul inbound/outbound records
- Return records, if preserved from imported history
- Hardware master list
- Serial number records
- Edit/delete history and backups

## Confirmed Requirements

- The app is for personal/local use.
- It only needs to run locally on a Windows computer.
- It does not need to be packaged as an `.exe`.
- Prefer no separate installation requirements.
- Existing Excel files will be imported at the beginning.
- After the app is complete, it should replace the old Excel workflow.
- "Combine the two Excel files" means all of the following:
  - one unified inventory experience,
  - one unified output/export,
  - automatic stock calculation.
- Everything currently shown in the Excel files is assumed to be needed.
- Search/filtering is needed.
- Editing/deleting past records is needed.
- Backup is needed.
- The main daily workflows are:
  - 개인 입고
  - 개인 출고
  - 서울로 반납
  - 서울에서 파트실로 택배
- Personal-side exchanges should use the terms `입고` and `출고`.
- `서울 입고` is an alias for `서울에서 파트실로 택배`.
- For 서울 입출고, the app must show total part counts.
- `합계` is the total stock value.
- Do not treat `총재고` as a separate calculated stock bucket in the new app.
- Canonical stock formula: `합계 = 파트실 + 개인별 보유 합계 + 사무실 보유/사용분`.
- Personal vehicle inventory exists mainly so the user can see each person's held items and per-person totals at a glance.
- 사무실 재고 is handled like an item taken out of 파트실 for office use.
- Both part-room stock and personal vehicle stock must be managed.
- In the new app terminology, `서울로 반납` means sending stock from 파트실 to Seoul, so it decreases 파트실.
- In the new app terminology, `서울에서 파트실로 택배` / `서울 입고` means receiving stock from Seoul into 파트실, so it increases 파트실.
- Serial numbers are not limited to a predefined item list; a serial number can be entered for any item whenever needed.
- Duplicate serial numbers are allowed.
- Date-based historical stock snapshots are not needed.
- Dates are still needed on inbound/outbound records.
- Negative stock should not be allowed.
- Hardware/item names are mostly fixed, but the user must be able to add or remove items when needed.

## Stock Entry Behavior

The requester clarified that the app should provide separate entry flows for 서울 입반출 and 개인 입반출. These entries should update 파트실 and holder totals; normal users should not have to manually adjust stock after entering the record.

Recommended rule for MVP:

- Any transaction form that changes inventory should show which inventory bucket will increase/decrease before saving.
- 개인 출고: `파트실 -`, selected person's held stock `+`.
- 개인 입고: `파트실 +`, selected person's held stock `-` when applicable.
- 서울로 반납: `파트실 -` because the item is sent from 파트실 to Seoul.
- 서울에서 파트실로 택배 / 서울 입고: `파트실 +` because the item comes from Seoul into 파트실.
- 사무실 사용/보유: `파트실 -`, 사무실 bucket `+`.
- The user should not need to calculate stock manually after saving.
- Direct stock edits should exist only for corrections, opening balances, or reconciliation.
- If a workflow is ambiguous, use an `adjustment` record rather than silently changing the wrong bucket.
- Block saves that would make stock negative.

## Remaining Implementation Details

No major requirement blockers remain. Implementation details to confirm during development:

1. Exact legacy Excel export layout details, including formulas, formatting, and which old sheets must be reproduced.
2. Exact legacy Excel export layout details for Seoul-related columns. The app UI should prefer `서울로 반납` and `서울에서 파트실로 택배`; `서울 입고` may be shown as an alias, and legacy column names may still be preserved during import/export.

## Initial Calculation Rule Observed

The existing usage workbook appears to calculate part-room inventory as:

```text
Chungbuk stock = inbound - outbound + returned
Actual stock = Chungbuk stock - Seoul shipping
```

This rule should be confirmed before implementation.

After requester clarification, this should be treated as an old-workbook reference rule. The final app should model explicit inventory movements and keep 파트실, 개인 보유, 사무실 보유/사용분, and 합계 synchronized. The output workbook should still follow the existing Excel format.

Updated terminology interpretation:

- Old/new `입고`: personal inbound movement, from an individual back into 파트실.
- Old/new `출고`: personal outbound movement, from 파트실 to an individual.
- Old/new `반납`: part-room stock sent to Seoul, so `파트실 -`.
- `서울_파트실_택배` / `서울에서 파트실로 택배` / `서울 입고`: stock received from Seoul into part room, so `파트실 +`.

## Migration Decisions

- Initial stock should be rebuilt from `충북사무소 재고현황 260601.xlsx`.
- `충북사무소 사용내역 부품신청서 2602.xlsb` should be imported as historical/reference data only, not applied again as stock-changing data during initial migration.
- Excel export should produce one unified `.xlsx` workbook.
- A portable local app folder with bundled runtime and SQLite is acceptable.
