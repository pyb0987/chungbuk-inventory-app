import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [rootArg, expectedArg] = process.argv.slice(2);
if (!rootArg || !expectedArg) {
  throw new Error("usage: verify-release-version.mjs <package-root> <expected-version>");
}
const root = resolve(rootArg);
const expected = expectedArg.replace(/^v/, "");
const appVersion = readFileSync(resolve(root, "APP_VERSION"), "utf8").trim();
const packageVersion = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
if (appVersion !== expected || packageVersion !== expected) {
  throw new Error(
    `release version mismatch: expected=${expected} APP_VERSION=${appVersion} package=${packageVersion}`
  );
}
console.log(`release versions match: ${expected}`);
