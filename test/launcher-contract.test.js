import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(
  new URL("../launcher/ChungbukInventoryLauncher.cs", import.meta.url),
  "utf8"
);

test("Windows launcher uses a machine-wide lock and shared public data directory", () => {
  assert.match(launcher, /Global\\\\ChungbukInventoryLauncher/);
  assert.match(launcher, /WellKnownSidType\.WorldSid/);
  assert.match(launcher, /MutexRights\.FullControl/);
  assert.match(launcher, /Environment\.SpecialFolder\.CommonDocuments/);
  assert.match(launcher, /MigrateToSharedUserData/);
  assert.match(launcher, /\.migrated-to-shared-data/);
});

test("Windows launcher blocks unmarked per-account data when shared data already exists", () => {
  assert.match(launcher, /File\.Exists\(sourceDatabase\) && !File\.Exists\(sourceMarker\)/);
  assert.match(launcher, /공용 데이터베이스와 현재 Windows 계정의 기존 데이터베이스가 모두 발견되었습니다/);
  assert.match(launcher, /--shared-migration-test/);
});

test("Windows launcher detaches the updater from the replaceable application directory", () => {
  assert.match(launcher, /ChungbukInventory-updater-/);
  assert.match(launcher, /info\.WorkingDirectory = safeWorkingDirectory/);
  assert.match(launcher, /-LogPath/);
  assert.match(launcher, /--updater-launch-test/);
  assert.match(launcher, /--restart-marker/);
  assert.match(launcher, /--restart-readiness-test/);
  assert.match(launcher, /appRoot = appRoot\.TrimEnd/);
  assert.match(launcher, /quoted\.Append\('\\\\', backslashes \* 2\)/);
});
