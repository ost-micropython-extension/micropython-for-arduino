import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { configureWorkspaceStubs } from "../../stubs/PylanceConfig";
import { LibraryManifest } from "../../types/messages";
import { findPython } from "../utils";
import { StubGenerator } from "../../stubs/StubGenerator";
import { ConnectionManager } from "../../device/ConnectionManager";
import { CodeSupportHandler } from "./CodeSupportHandler";
import { Sender } from "../WebviewGateway";
import {
  BOARD_CODE_SUPPORT_SUBFOLDER,
  CODE_SUPPORT_FOLDER,
} from "../../types/constants";

const execAsync = promisify(exec);

export class StubHandler {
  private readonly _stubGenerator = new StubGenerator();

  constructor(
    private readonly _connectionManager: ConnectionManager,
    private readonly _codeSupportHandler: CodeSupportHandler,
  ) {}

  /**
   * Automatically installs board-specific code support packages.
   */
  async autoInstallBoardStubs(
    stubPackage: string,
    boardSlug: string,
  ): Promise<void> {
    const enabled = vscode.workspace
      .getConfiguration("micropython-for-arduino")
      .get<boolean>("autoInstallBoardCodeSupport", true);
    if (!enabled) {
      return;
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return;
    }

    const boardStubsRelPath = `${CODE_SUPPORT_FOLDER}/${BOARD_CODE_SUPPORT_SUBFOLDER}/${boardSlug}`;
    const boardStubsAbsPath = path.join(
      root,
      CODE_SUPPORT_FOLDER,
      BOARD_CODE_SUPPORT_SUBFOLDER,
      boardSlug,
    );

    try {
      const py = await findPython();

      if (fs.existsSync(boardStubsAbsPath)) {
        configureWorkspaceStubs(root, boardStubsRelPath);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));

      const { stdout } = await execAsync(
        `${py} -m pip install --target "${boardStubsAbsPath}" "${stubPackage}"`,
        { timeout: 120000 },
      );

      if (stdout.includes("Successfully installed")) {
        configureWorkspaceStubs(root, boardStubsRelPath);

        const action = await vscode.window.showInformationMessage(
          `✓ Board code support updated.`,
          "Disable Auto-Install",
        );
        if (action === "Disable Auto-Install") {
          await vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "micropython-for-arduino.autoInstallBoardCodeSupport",
          );
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Board code support setup failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Generates library code support from the board manifest.
   */
  async generateLibraryCodeSupport(
    port: string,
    manifest?: LibraryManifest,
  ): Promise<boolean> {
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot) {
      vscode.window.showErrorMessage("No workspace open.");
      return false;
    }

    const regenerate = manifest === undefined;

    try {
      const resolved =
        manifest ??
        (await this._connectionManager.getDevice(port).readManifest());
      if (!resolved) {
        return false;
      }

      const result = await this._stubGenerator.generateFromGithub(
        resolved,
        wsRoot,
        regenerate,
      );
      vscode.window.showInformationMessage(result.message);
      return result.readmeFound || false;
    } catch (err) {
      vscode.window.showErrorMessage((err as Error).message);
      return false;
    }
  }

  /**
   * Generates library stubs and updates the webview state.
   */
  async handleGenerateLibraryStubs(port: string, send: Sender): Promise<void> {
    await this.generateLibraryCodeSupport(port);
    this._codeSupportHandler.updateCodeSupport(send);
  }
}
