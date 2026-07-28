# Architecture Notes

## Decision

Start with an Electron-compatible local app architecture.

## Why Electron First

- The target user wants a local Windows app and prefers no separate install.
- Electron can be packaged as a portable folder or executable later.
- The current development environment has Node.js available.
- The current development environment does not have Rust installed, so Tauri
  would add setup friction before the first working build.
- Node 25 provides `node:sqlite`, so the app can start with SQLite without a
  native npm SQLite dependency.
- Decision confirmed on 2026-07-14: keep `node:sqlite` for the current
  implementation despite its experimental Node warning.

## Tauri Reconsideration Point

Tauri remains a good option if:

- Rust toolchain setup is acceptable,
- smaller final binary size is a priority,
- the app needs a more native Windows footprint.

## SQLite Reconsideration Point

Revisit `node:sqlite` before final packaging if:

- the target Windows runtime cannot bundle the needed Node version,
- the experimental API changes,
- installer/package testing shows compatibility issues.

## Current Implementation Split

- `src/domain`: stock movement rules and validation.
- `src/db`: SQLite schema, initialization, and repository functions.
- `src/services`: file-level services and UI read models.
- `test`: stock-engine and repository acceptance tests.
- `docs/mapping`: workbook mapping tables for later import/export work.

## Portable Folder Notes

- `START_CHUNGBUK_APP.cmd` is the current Windows-friendly launcher.
- The Windows launcher uses
  `C:\Users\Public\Documents\ChungbukInventory` for the live SQLite database,
  backups, and logs shared by Windows accounts on the same computer.
- The launcher requires a bundled `runtime\node\node.exe` for handoff and fails
  clearly if it is missing or incompatible.
- `scripts/start-portable.mjs` starts the server and opens the browser only
  after the server is listening.
- `npm run prepare:portable` creates `dist/chungbuk-inventory-portable/`
  without copying the development `data/` folder, so stale imported inventory
  is not bundled by accident.
- `npm run package:portable` rebuilds, validates, and writes a review zip.
- `npm run package:portable:release` additionally requires
  `runtime/node/node.exe` before writing the final release zip.
- `npm run validate:portable:release` should be run before handoff to verify
  that the runtime is present and stale data was not bundled.

## First Build Slice

1. Keep stock rules in pure JavaScript functions with tests.
2. Store normalized inventory data in SQLite.
3. Build the desktop UI on top of the same domain functions.
4. Add backup and restore behavior.
5. Add Excel import/migration support.
6. Defer Excel export until the sheet mapping table and export acceptance
   criteria are complete.

## Backup Notes

- Backups use Node's native SQLite backup API.
- The server creates one automatic daily backup before the first data-changing
  action of the day.
- Manual backups remain available from the UI.
- Restore validates the backup with `PRAGMA integrity_check` before replacing
  the database file.
- Restore validates that the backup has the expected app tables.
- Restore rejects backups missing `serial_numbers`, with invalid boolean flags,
  invalid stock buckets, invalid holder semantics, invalid transaction types,
  foreign-key violations, or negative internal stock.
- Restore copies to a temporary file first, validates it, then renames it over
  the target database.
- Restore refuses to run while the target database is open.
- Restore should be run while the application database connection is closed.

## Import Notes

- The app should ship without real inventory data.
- The user imports their own current workbook during first setup.
- Current-stock import writes opening stock adjustments and an import report.
- Current-stock import is guarded so the same opening baseline is not imported
  twice by accident.
- Validation errors do not mutate stock unless partial import is explicitly
  requested.
- The Excel parser is an adapter around `importCurrentStockRows`; it should not
  contain business rules.

## Transaction Notes

- Nested transactions use SQLite savepoints.
- Stock adjustments accept only known internal buckets.
- Person-bucket adjustments require an existing person holder.

## Deferred Work

Excel export is intentionally not implemented in the first build slice. The
old-format `.xlsx` exporter should wait until each legacy sheet has an explicit
mapping and the requester confirms which sheets, formulas, and visual formats
must be reproduced.
