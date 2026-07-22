# Windows Handoff Checklist

Use this checklist before giving the app folder to the actual user.

## Build The Portable Folder

From the project folder:

```bash
npm run package:portable
```

This creates:

```text
dist/chungbuk-inventory-portable/
dist/chungbuk-inventory-portable-dev.zip
```

The development zip is useful for review, but it is not final handoff-ready
unless a Windows Node runtime is included.

## Add The Windows Runtime

Before real handoff, put a Windows Node.js 25+ runtime here:

```text
runtime/node/node.exe
```

The launcher intentionally fails if this file is missing. This keeps the final
folder independent from whatever Node.js may or may not be installed on the
user's Windows computer.

## Build The Windows Launcher

On a Windows machine, run:

```text
BUILD_WINDOWS_LAUNCHER.cmd
```

This creates:

```text
ChungbukInventory.exe
```

The user should normally run this `.exe`. `START_CHUNGBUK_APP.cmd` remains in
the package only as a fallback/debug launcher.

## Build The Release Archive

After adding the runtime and building `ChungbukInventory.exe`:

```bash
npm run package:portable:release
```

This refuses to create the release zip unless:

- the portable folder exists,
- required app files are present,
- `user-data/` does not contain stale `.sqlite` or `.db` data,
- the development `data/` folder was not copied,
- `runtime/node/node.exe` exists,
- `ChungbukInventory.exe` exists,
- the generated release zip also contains the required launcher, app files,
  runtime, and clean `user-data/` skeleton.

The final handoff file is:

```text
dist/chungbuk-inventory-portable-release.zip
```

## First Run On Windows

1. Extract the zip folder.
2. Run `VERIFY_CHUNGBUK_APP.cmd` before importing real data.
3. Run `ChungbukInventory.exe`.
4. The browser opens after the local server starts.
5. Use `현재 재고 가져오기` to import the user's current `재고현황` workbook.
6. Keep the generated `user-data/` folder. It contains the real database and
   backups after import.
7. Give the user `docs/user-guide-ko.md` as the first-use guide.

For the full Windows smoke-test procedure, use:

```text
docs/windows-smoke-test-ko.md
```

For requester communication and acceptance feedback, use:

```text
docs/handoff-message-ko.md
docs/requester-acceptance-checklist-ko.md
```

## Do Not Bundle Real Data

Do not copy the development `data/` folder or any existing `.sqlite` / `.db`
file into `user-data/` before handoff. The user should import fresh current
stock at setup time.
