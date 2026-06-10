import * as path from "path";
import * as vscode from "vscode";
import { fork } from "child_process";
import { pathToFileURL } from "url";
import { LibraryEntry } from "../../types/messages";

interface RawPackage {
  name?: string;
  url?: string;
  docs?: string;
  author?: string;
  description?: string;
  tags?: string[];
  version?: string;
}

interface PackageManager {
  getPackageList(): Promise<RawPackage[]>;
  getPackage(name: string): Promise<RawPackage>;
  installPackage(
    pkg: RawPackage,
    device: { serialPort: string },
  ): Promise<void>;
  installPackageFromURL(
    url: string,
    device: { serialPort: string },
  ): Promise<void>;
}

interface UpyPackageModule {
  PackageManager: new () => PackageManager;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "");
}

/**
 * Returns a list of installable libraries
 */
export async function getPackageList(): Promise<LibraryEntry[]> {
  const upyRoot = path.dirname(require.resolve("upy-package"));
  const { PackageManager } = (await import(
    pathToFileURL(path.join(upyRoot, "index.js")).href
  )) as UpyPackageModule;
  const pm = new PackageManager();
  const packages = await pm.getPackageList();

  return packages.map((p) => ({
    name: p.name ?? "",
    url: p.url ?? p.docs ?? "",
    author: p.author ?? "",
    description: p.description ?? "",
    tags: p.tags ?? [],
  }));
}

/**
 * Installs package on the board
 */
export async function installPackage(
  registryName: string,
  packageRef: string,
  serialPort: string,
): Promise<string | undefined> {
  const outputChannel = vscode.window.createOutputChannel(
    `${registryName || "Library"} Installation`,
  );
  outputChannel.show(true);

  return new Promise<string | undefined>((resolve, reject) => {
    const workerPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "workers",
      "installer-worker.js",
    );

    const child = fork(workerPath, [registryName, packageRef, serialPort], {
      silent: true,
      execArgv: [],
    });

    let capturedVersion: string | undefined;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const cleaned = stripAnsi(line).trim();
        if (!cleaned) {
          continue;
        }

        const versionMatch = cleaned.match(/^VERSION:(.+)$/);
        if (versionMatch) {
          capturedVersion = versionMatch[1];
        } else {
          outputChannel.appendLine(cleaned);
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const cleaned = stripAnsi(line).trim();
        if (cleaned) {
          outputChannel.appendLine(`[error] ${cleaned}`);
        }
      }
    });

    child.on("error", (err) => {
      outputChannel.appendLine(`[Worker error]: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code) => {
      // Flush any remaining buffered output
      if (stdoutBuffer.trim()) {
        outputChannel.appendLine(stripAnsi(stdoutBuffer).trim());
      }
      if (stderrBuffer.trim()) {
        outputChannel.appendLine(`[error] ${stripAnsi(stderrBuffer).trim()}`);
      }

      if (code === 0) {
        resolve(capturedVersion);
      } else {
        outputChannel.appendLine(`--- Failed (exit code ${code}) ---`);
        reject(new Error(`installer-worker exited with code ${code}`));
      }
    });
  });
}
