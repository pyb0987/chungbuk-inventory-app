import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("release version verifier rejects mismatched package metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "chungbuk-version-"));
  writeFileSync(join(root, "APP_VERSION"), "0.2.1\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));

  assert.throws(
    () =>
      execFileSync(process.execPath, [
        join(process.cwd(), "scripts", "verify-release-version.mjs"),
        root,
        "0.2.1"
      ]),
    /release version mismatch/
  );
});
