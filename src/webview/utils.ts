import { exec } from "child_process";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import {
  CODE_SUPPORT_FOLDER,
  FOLDER_OPENED_BOARD_FILES,
} from "../types/constants";

let debugOut: vscode.OutputChannel | undefined;

/**
 * Returns the singleton debug output channel, creating it on first access.
 */
function getDebugOut(): vscode.OutputChannel {
  if (!debugOut) {
    debugOut = vscode.window.createOutputChannel("findPython Debug");
  }
  return debugOut;
}

/**
 * Resolves the absolute path to a Python executable.
 *
 * Resolution order:
 * 1. The active interpreter reported by the **ms-python.python** VS Code
 *    extension (if installed and active).
 * 2. The first entry returned by `which python3` / `which python`
 *    (`where` on Windows), skipping Microsoft Store stubs on Windows.
 *
 * @returns A promise that resolves to the absolute path of the Python
 *   executable.
 * @throws {Error} When no usable Python executable can be found.
 */
export async function findPython(): Promise<string> {
  const pythonPath = await tryPythonExtension();
  if (pythonPath) {
    return pythonPath;
  }

  getDebugOut().appendLine("Falling back to which/where...");
  return findPythonOnPath();
}

/**
 * Attempts to obtain the Python interpreter path from the ms-python extension.
 *
 * @returns The absolute interpreter path, or `undefined` when the extension
 *   is unavailable or does not expose a usable path.
 */
async function tryPythonExtension(): Promise<string | undefined> {
  const pythonExt = vscode.extensions.getExtension("ms-python.python");
  if (!pythonExt) {
    return undefined;
  }

  if (!pythonExt.isActive) {
    await pythonExt.activate();
  }

  try {
    const api = pythonExt.exports;
    const details = api.settings?.getExecutionDetails?.();
    const cmd: string | undefined = details?.execCommand?.[0];

    getDebugOut().appendLine(`VS Code Python Extension found: ${cmd}`);

    if (cmd && path.isAbsolute(cmd)) {
      getDebugOut().appendLine(`Using VS Code Python: ${cmd}`);
      return cmd;
    }
  } catch (e) {
    getDebugOut().appendLine(`VS Code Python Extension error: ${e}`);
  }

  return undefined;
}

/**
 * Searches `PATH` for a Python executable using `which` (Unix) or `where`
 * (Windows), trying `python3` before `python`.
 *
 * On Windows, Microsoft Store stub executables located directly inside a
 * `WindowsApps` directory are skipped.
 *
 * @returns A promise that resolves to the absolute path of the first
 *   acceptable Python executable found.
 * @throws {Error} When no acceptable executable can be located.
 */
function findPythonOnPath(): Promise<string> {
  const candidates = ["python3", "python"];

  return new Promise((resolve, reject) => {
    let idx = 0;

    const tryNext = () => {
      if (idx >= candidates.length) {
        reject(
          new Error(
            "Python not found. Please install Python and make sure to add it to your PATH " +
              "during installation. If Python is already installed, check that it is added to your PATH.",
          ),
        );
        return;
      }

      const candidate = candidates[idx++];
      const locateCmd = process.platform === "win32" ? "where" : "which";

      getDebugOut().appendLine(`Trying: ${locateCmd} ${candidate}`);

      exec(`${locateCmd} ${candidate}`, { timeout: 5000 }, (err, stdout) => {
        if (err) {
          getDebugOut().appendLine(`  ${locateCmd} failed: ${err.message}`);
          tryNext();
          return;
        }

        const paths = stdout.trim().split(/\r?\n/);
        getDebugOut().appendLine(`  Found paths: ${JSON.stringify(paths)}`);

        const resolved = paths.find((p) => isAcceptablePythonPath(p));

        if (resolved) {
          getDebugOut().appendLine(`Resolved to: ${resolved}`);
          getDebugOut().show(true);
          resolve(resolved);
        } else {
          getDebugOut().appendLine("No valid path found");
          tryNext();
        }
      });
    };

    tryNext();
  });
}

/**
 * Returns `true` when the given path points to an acceptable Python executable.
 *
 * @param p - The filesystem path to evaluate.
 * @returns `true` if the path is usable, `false` otherwise.
 */
function isAcceptablePythonPath(p: string): boolean {
  if (!p) {
    getDebugOut().appendLine("  Skipping empty path");
    return false;
  }

  if (process.platform === "win32") {
    const lower = p.toLowerCase();
    if (lower.includes("windowsapps")) {
      const parentDir = path.basename(path.dirname(lower));
      if (parentDir === "windowsapps") {
        getDebugOut().appendLine(`  Skipping Store stub: ${p}`);
        return false;
      }
    }
  }

  getDebugOut().appendLine(`  Accepting: ${p}`);
  return true;
}

/**
 * Converts a full GitHub HTTPS URL to the `github:<owner>/<repo>` shorthand.
 *
 * @param url - The GitHub repository URL to convert
 *   (e.g. `https://github.com/owner/repo.git`).
 * @returns The shorthand string (e.g. `github:owner/repo`), or the original
 *   `url` if conversion is not possible.
 *
 */
export function toGithubShorthand(url: string): string {
  const match = url.match(/https?:\/\/github\.com\/(.+?)(?:\.git)?$/);
  return match ? `github:${match[1]}` : url;
}

/**
 * Fetches the full response body of an HTTPS URL as a UTF-8 string.
 *
 * @param url - The HTTPS URL to fetch.
 * @returns A promise that resolves to the response body text.
 * @throws {Error} On HTTP errors (4xx / 5xx), timeouts, or network failures.
 */
export function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "vscode-micropython-arduino" } },
      (res) => {
        // Handle redirects explicitly (https.get does not follow them by default)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          const location = res.headers.location;
          if (location) {
            fetchUrl(location).then(resolve).catch(reject);
            return;
          }
        }

        if (!res.statusCode || res.statusCode >= 400) {
          reject(
            new Error(
              `HTTP ${res.statusCode ?? "unknown"}: ${res.statusMessage ?? "error"} (${url})`,
            ),
          );
          return;
        }

        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
        res.on("error", reject);
      },
    );
    req.setTimeout(10000);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
    req.on("error", reject);
  });
}

/** Characters that are illegal in file/project names across common platforms. */
const ILLEGAL_CHARS = /[\/\\:*?"<>|]/;

/**
 * Validates that a name is suitable for use as a file or project name.
 *
 * @param name - The name string to validate.
 * @returns `undefined` when the name is valid, or a human-readable error
 *   message string when it is not.
 */
export function validateName(name: string): string | undefined {
  if (!name.trim()) {
    return "Name cannot be empty or whitespace.";
  }
  if (ILLEGAL_CHARS.test(name)) {
    return 'Name contains illegal characters: \\ / : * ? " < > |';
  }
  return undefined;
}

/**
 * Wraps a VS Code progress reporter so it can be fed the *cumulative*
 * percentage (0-100) reported by micropython.js's upload/download progress
 * callback, converting it into the incremental updates the progress UI
 * expects.
 */
export function reportTransferProgress(
  progress: vscode.Progress<{ message?: string; increment?: number }>,
): (percent: number) => void {
  let lastPercent = 0;
  return (percent: number) => {
    const increment = Math.max(0, percent - lastPercent);
    lastPercent = percent;
    progress.report({ increment, message: `${percent}%` });
  };
}

/**
 * Opens a folder picker for selecting a workspace folder.
 */
export async function selectFolder(
  quickPickText: string,
): Promise<string | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace open");
    return;
  }

  const workspace = workspaceFolders[0];
  const rootPath = workspace.uri.fsPath;

  const excludedFolders = [
    ".vscode",
    "node_modules",
    ".git",
    ".github",
    "__pycache__",
    CODE_SUPPORT_FOLDER,
    FOLDER_OPENED_BOARD_FILES,
  ];

  const items: {
    label: string;
    description?: string;
    detail?: string;
    fullPath: string;
  }[] = [];

  function createItem(folderPath: string, name: string) {
    items.push({
      label: `$(folder) ${name}`,
      description: folderPath,
      fullPath: folderPath,
    });
  }

  function addFoldersRecursive(folderPath: string) {
    createItem(folderPath, path.basename(folderPath) || "Workspace");

    const entries = fs.readdirSync(folderPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory() || excludedFolders.includes(entry.name)) {
        continue;
      }

      addFoldersRecursive(path.join(folderPath, entry.name));
    }
  }

  addFoldersRecursive(rootPath);

  if (items.length === 1) {
    return items[0].fullPath;
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: quickPickText,
  });

  return selected?.fullPath;
}
