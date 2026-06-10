import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import { findPython } from "../webview/utils";

const execFileAsync = promisify(execFile);

export class VenvManager {
  private readonly _venvPath: string;

  constructor(globalStoragePath: string) {
    this._venvPath = path.join(globalStoragePath, "venv");
  }

  /**
   * Returns path to mpremote
   */
  get mpremotePath(): string {
    return process.platform === "win32"
      ? path.join(this._venvPath, "Scripts", "mpremote.exe")
      : path.join(this._venvPath, "bin", "mpremote");
  }

  /**
   * Returns path to pip
   */
  private get _pipPath(): string {
    return process.platform === "win32"
      ? path.join(this._venvPath, "Scripts", "pip.exe")
      : path.join(this._venvPath, "bin", "pip");
  }

  /**
   * Check if mpremote has a newer version.
   * If newer version was found ask user if he wants to update.
   */
  async checkForUpdate(): Promise<void> {
    if (!fs.existsSync(this.mpremotePath)) {
      return;
    }
    try {
      const showResult = await execFileAsync(this._pipPath, [
        "show",
        "mpremote",
      ]);
      const match = showResult.stdout.match(/^Version:\s*(\S+)/m);
      if (!match) {
        return;
      }
      const installed = match[1];

      const latest = await this._fetchLatestPypiVersion();
      if (!latest || !_isNewer(latest, installed)) {
        return;
      }

      const choice = await vscode.window.showInformationMessage(
        `A new version of mpremote is available: ${latest} (installed: ${installed}).`,
        "Update",
        "Later",
      );
      if (choice !== "Update") {
        return;
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Updating mpremote...",
            cancellable: false,
          },
          async () => {
            await execFileAsync(
              this._pipPath,
              ["install", "--upgrade", "mpremote"],
              { timeout: 120000 },
            );
          },
        );
        vscode.window.showInformationMessage(`mpremote updated to ${latest}.`);
      } catch (err) {
        vscode.window.showErrorMessage(
          `mpremote update failed: ${(err as Error).message}`,
        );
      }
    } catch {
      // PyPI down, unexpected output
    }
  }

  private _fetchLatestPypiVersion(): Promise<string | null> {
    return new Promise((resolve) => {
      const req = https.get("https://pypi.org/pypi/mpremote/json", (res) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data) as { info: { version: string } };
            resolve(json.info.version);
          } catch {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  /**
   * Creates a venv environment with the needed tools for the extension.
   */
  async setup(): Promise<void> {
    if (fs.existsSync(this.mpremotePath)) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Setting up MicroPython tools...",
        cancellable: false,
      },
      async () => {
        const out = vscode.window.createOutputChannel("MicroPython Setup");
        try {
          fs.mkdirSync(path.dirname(this._venvPath), { recursive: true });

          if (!fs.existsSync(this._pipPath)) {
            const py = await findPython();
            out.appendLine(
              `Creating venv: "${py}" -m venv "${this._venvPath}"`,
            );
            const venvResult = await execFileAsync(
              py,
              ["-m", "venv", "--clear", this._venvPath],
              {
                timeout: 30000,
              },
            );
            if (venvResult.stdout) {
              out.appendLine(venvResult.stdout);
            }
            if (venvResult.stderr) {
              out.appendLine(venvResult.stderr);
            }
          }

          out.appendLine(`Installing mpremote via "${this._pipPath}"`);
          const pipResult = await execFileAsync(
            this._pipPath,
            ["install", "mpremote"],
            { timeout: 120000 },
          );
          if (pipResult.stdout) {
            out.appendLine(pipResult.stdout);
          }
          if (pipResult.stderr) {
            out.appendLine(pipResult.stderr);
          }

          vscode.window.showInformationMessage(
            "mpremote installed successfully.",
          );
        } catch (err) {
          const e = err as {
            message?: string;
            stderr?: string;
            stdout?: string;
          };
          const detail =
            e.stderr?.trim() || e.stdout?.trim() || e.message || String(err);
          out.appendLine(`ERROR: ${e.message}`);
          if (e.stderr) {
            out.appendLine(`stderr: ${e.stderr}`);
          }
          if (e.stdout) {
            out.appendLine(`stdout: ${e.stdout}`);
          }
          out.show(true);
          vscode.window.showErrorMessage(
            `MicroPython tools setup failed: ${detail}`,
          );
          throw err;
        }
      },
    );
  }
}

function _isNewer(candidate: string, installed: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(installed);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}
