#!/usr/bin/env node
// Version consistency gate (counterpart of macOS scripts/check-version.sh):
// App versions and the reviewed, checked-in CLI identity must agree.
// This gate performs no registry lookup and does not change the snapshot.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const packageJson = JSON.parse(read("package.json"));
const pkg = packageJson.version;
const cliChannel = packageJson.vibeUsageCliChannel;
const expectedCli = packageJson.vibeUsageCliVersion;
const expectedCliCommit = packageJson.vibeUsageCliCommit;
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const cargo = /\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/s.exec(read("Cargo.toml"))?.[1];
const vendoredCli = JSON.parse(read("src-tauri/resources/cli/package.json")).version;
const vendoredCliSource = JSON.parse(read("src-tauri/resources/cli/.vibe-usage-source.json"));

console.log(`package.json:     ${pkg}`);
console.log(`tauri.conf.json:  ${tauri}`);
console.log(`Cargo.toml:       ${cargo}`);
console.log(`CLI channel:      ${cliChannel}`);
console.log(`Expected CLI:     ${expectedCli}`);
console.log(`Vendored CLI:     ${vendoredCli}`);
console.log(`CLI commit:       ${vendoredCliSource.commit ?? "npm release"}`);

if (pkg !== tauri || pkg !== cargo) {
  console.error("✗ version mismatch — update all three before releasing");
  process.exit(1);
}
if (cliChannel !== "latest") {
  console.error("✗ CLI channel must be latest");
  process.exit(1);
}
if (vendoredCli !== expectedCli) {
  console.error("✗ vendored CLI does not match the pinned release version");
  process.exit(1);
}
if (vendoredCliSource.version !== vendoredCli) {
  console.error("✗ vendored CLI source metadata has a different version");
  process.exit(1);
}
if (expectedCliCommit && vendoredCliSource.commit !== expectedCliCommit) {
  console.error("✗ vendored CLI does not match the reviewed source commit");
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(vendoredCli)) {
  console.error("✗ vendored CLI must contain a concrete semantic version");
  process.exit(1);
}
console.log("✓ app versions and pinned vendored CLI are consistent");
