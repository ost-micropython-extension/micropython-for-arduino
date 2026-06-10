import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CodeSupportItem } from "../../types/messages";
import {
  removeStubsExtraPath,
  addStubsExtraPath,
} from "../../stubs/PylanceConfig";
import { Sender } from "../WebviewGateway";
import {
  BOARD_CODE_SUPPORT_SUBFOLDER,
  CODE_SUPPORT_FOLDER,
} from "../../types/constants";

export class CodeSupportHandler {
  _libCache: string[] = [];

  /**
   * Activates code support for a library.
   */
  handleActivate(name: string): void {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) {
      vscode.window.showErrorMessage("No Workspace open");
      return;
    }
    addStubsExtraPath(wsRoot, name);
  }

  /**
   * Deactivates code support for a library.
   */
  handleDeactivate(name: string): void {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) {
      vscode.window.showErrorMessage("No Workspace open");
      return;
    }
    removeStubsExtraPath(wsRoot, name);
  }

  /**
   * Sends the current code support state to the webview.
   */
  updateCodeSupport(send: Sender, installedLibs?: string[]): void {
    if (installedLibs === undefined) {
      installedLibs = this._libCache;
    } else {
      this._libCache = installedLibs;
    }
    const value: CodeSupportItem[] = _getCodeSupportItems(installedLibs);
    send({ type: "codeSupport", value });
  }
}

/**
 * Builds the list of available code support items.
 */
function _getCodeSupportItems(installedLibs: string[]): CodeSupportItem[] {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage("No Workspace open");
    return [];
  }
  const codeSupportRoot = path.join(workspacePath, CODE_SUPPORT_FOLDER);
  const settingsPath = path.join(workspacePath, ".vscode", "settings.json");

  const codeSupportNames = new Set<string>();
  if (fs.existsSync(codeSupportRoot)) {
    for (const entry of fs.readdirSync(codeSupportRoot, {
      withFileTypes: true,
    })) {
      if (entry.isDirectory() && entry.name !== BOARD_CODE_SUPPORT_SUBFOLDER) {
        codeSupportNames.add(entry.name);
      }
    }
  }

  const activePaths = new Set<string>();
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const stripped = raw.replace(/\/\/[^\n]*/g, "");
      const settings = JSON.parse(stripped);
      const extraPaths: string[] =
        settings?.["python.analysis.extraPaths"] ?? [];
      for (const p of extraPaths) {
        const segments = p.replace(/\\/g, "/").split("/");
        const mpyIndex = segments.indexOf(CODE_SUPPORT_FOLDER);
        if (
          mpyIndex !== -1 &&
          segments[mpyIndex + 1] !== BOARD_CODE_SUPPORT_SUBFOLDER
        ) {
          const libName = segments[mpyIndex + 1];
          if (libName) {
            activePaths.add(libName);
          }
        }
      }
    } catch {
      // Malformed settings — treat as no active paths
    }
  }

  const installedSet = new Set(installedLibs);
  const allNames = new Set<string>([...installedSet, ...codeSupportNames]);

  const result: CodeSupportItem[] = [];
  for (const name of allNames) {
    const installed = installedSet.has(name);
    const codesupport = codeSupportNames.has(name);

    if (!installed && !codesupport) {
      continue;
    }

    result.push({
      displayName: name,
      installed,
      codesupport,
      active: activePaths.has(name),
    });
  }

  return result;
}
