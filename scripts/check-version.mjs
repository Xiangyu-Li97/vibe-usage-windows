#!/usr/bin/env node
// Version consistency gate (counterpart of macOS scripts/check-version.sh):
// App versions must agree, and the vendored CLI snapshot must carry the concrete
// version pinned in package.json#vibeUsageCliVersion.
//
// This script is offline and never re-vendors: it only compares the checked-in
// snapshot against the pin, which is what keeps a release reproducible. Resolving
// npm's `latest` dist-tag happens in scripts/vendor-cli.mjs, which a maintainer
// runs by hand; upstream drift is reported by scripts/verify-cli-upstream.mjs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const packageJson = JSON.parse(read("package.json"));
const pkg = packageJson.version;
const cliChannel = packageJson.vibeUsageCliChannel;
const expectedCli = packageJson.vibeUsageCliVersion;
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const cargo = /\[workspace\.package\][^[]*?version\s*=\s*"([^"]+)"/s.exec(read("Cargo.toml"))?.[1];
const vendoredCli = JSON.parse(read("src-tauri/resources/cli/package.json")).version;

console.log(`package.json:     ${pkg}`);
console.log(`tauri.conf.json:  ${tauri}`);
console.log(`Cargo.toml:       ${cargo}`);
console.log(`CLI channel:      ${cliChannel}`);
console.log(`Expected CLI:     ${expectedCli}`);
console.log(`Vendored CLI:     ${vendoredCli}`);

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
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(vendoredCli)) {
  console.error("✗ vendored CLI must contain a concrete semantic version");
  process.exit(1);
}
console.log("✓ app versions and pinned vendored CLI are consistent");
