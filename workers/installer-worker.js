/**
 * installer-worker.js
 *
 * Runs in a child process spawned by installPackage().
 * stdout  → forwarded to the VS Code Output Channel
 * stderr  → forwarded to the VS Code Output Channel
 * exit 0  → success, capturedVersion written to stdout as last line: "VERSION:<x.y.z>"
 * exit 1  → failure, error message on stderr
 *
 * argv[2]  registryName   e.g. "aioble-security"
 * argv[3]  packageRef     e.g. custom URL or same as registryName
 * argv[4]  serialPort     e.g. "COM3"
 */

"use strict";

const path = require("path");
const { pathToFileURL } = require("url");

const [, , registryName, packageRef, serialPort] = process.argv;

if (!registryName || !serialPort) {
  process.stderr.write("installer-worker: missing arguments\n");
  process.exit(1);
}

async function main() {
  const upyRoot = path.dirname(require.resolve("upy-package"));

  const { PackageManager } = await import(
    pathToFileURL(path.join(upyRoot, "index.js")).href
  );

  const { Packager } = await import(
    pathToFileURL(require.resolve("upy-packager/logic/packager.js")).href
  );

  const pm = new PackageManager();
  const device = { serialPort };

  let capturedVersion;
  const origPackage = Packager.prototype.package;
  Packager.prototype.package = async function (...args) {
    const result = await origPackage.apply(this, args);
    const match = result?.archivePath?.match(/-(\d+\.\d+(?:\.\d+)?)\.tar\.gz/);
    if (match) {
      capturedVersion = match[1];
    }
    return result;
  };

  try {
    try {
      const pkg = await pm.getPackage(registryName);
      await pm.installPackage(pkg, device);
    } catch {
      await pm.installPackageFromURL(packageRef, device);
    }
  } finally {
    Packager.prototype.package = origPackage;
  }

  if (capturedVersion) {
    process.stdout.write(`VERSION:${capturedVersion}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err?.message ?? String(err)}\n`);
  if (err?.stack) {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
