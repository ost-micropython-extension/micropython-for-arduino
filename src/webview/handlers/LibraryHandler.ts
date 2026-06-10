import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { LibraryManifest } from "../../types/messages";
import { Sender } from "../WebviewGateway";
import { getPackageList } from "../../device/operation/packageRegistry";
import { ConnectionManager } from "../../device/ConnectionManager";
import { removeStubsExtraPath } from "../../stubs/PylanceConfig";
import { CodeSupportHandler } from "./CodeSupportHandler";
import { InstalledLibraryItem } from "../../device/operation/LibraryOperations";
import { CODE_SUPPORT_FOLDER } from "../../types/constants";

export class LibraryHandler {
  constructor(
    private readonly _connectionManager: ConnectionManager,
    private readonly _codeSupportHandler: CodeSupportHandler,
    private readonly _onLibraryInstalled?: (
      port: string,
      manifest: LibraryManifest,
    ) => Promise<boolean>,
  ) {}

  /**
   * Loads installed libraries from the connected board.
   */
  async handleGetLibraries(send: Sender): Promise<void> {
    try {
      const libraries = await getPackageList();
      send({ type: "libraries", value: libraries });
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to load packages: ${(err as Error).message}`,
      );
    }
  }

  async handleGetInstalledLibraries(port: string, send: Sender): Promise<void> {
    const libs = await this._connectionManager.getDevice(port).fetchLibraries();
    send({ type: "installedLibraries", value: libs, port: port });
    this._updateCodeSupport(send, libs);
  }

  /**
   * Installs a library on the connected board.
   */
  async handleInstallLibrary(
    name: string,
    url: string,
    port: string,
    send: Sender,
  ): Promise<void> {
    let readmeFound = false;

    try {
      const device = this._connectionManager.getDevice(port);

      const result = await device.installLibrary({ name: name, url: url });

      if (result) {
        send({ type: "installedLibraries", value: result.items, port: port });
        send({ type: "installResult", success: true });
        const filteredManifest = {
          ...result.manifest,
          packages: Object.fromEntries(
            Object.entries(result.manifest.packages).filter(
              ([, value]) => value.url === url,
            ),
          ),
        };
        try {
          const displayName = Object.values(filteredManifest.packages)[0]
            .displayName;
          if (displayName) {
            name = displayName;
          }
        } catch (err) {
          vscode.window.showWarningMessage(
            "Installation was successful but no new file or folder in lib detected. No Code Support will be installed.",
          );
          return;
        }

        readmeFound =
          (await this._onLibraryInstalled?.(port, filteredManifest).catch(
            console.error,
          )) || false;
        this._updateCodeSupport(send, result.items);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Installation failed: ${(err as Error).message}`,
      );
      send({ type: "installResult", success: false });
      return;
    }

    try {
      if (readmeFound) {
        const workspaceFolder =
          vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        const uri = vscode.Uri.file(
          path.join(workspaceFolder!, CODE_SUPPORT_FOLDER, name, "README.md"),
        );
        await vscode.commands.executeCommand("markdown.showPreview", uri);
      }
    } catch (_err) {
      /*ignore*/
    }
  }

  /**
   * Uninstalls a library from the connected board.
   */
  async handleUninstallLibrary(
    id: string,
    displayName: string,
    port: string,
    send: Sender,
  ): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      `Uninstall "${displayName || id}" from the board?`,
      { modal: true },
      "Uninstall",
    );
    if (choice !== "Uninstall") {
      send({ type: "uninstallResult", success: false });
      return;
    }

    let onFinish = () => {};

    try {
      const device = this._connectionManager.getDevice(port);
      const updatedItems = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uninstalling ${displayName || id}…`,
          cancellable: false,
        },
        () => device.uninstallLibrary(id),
      );

      if (updatedItems) {
        send({ type: "installedLibraries", value: updatedItems, port });
        onFinish = () => this._updateCodeSupport(send, updatedItems);
      }

      vscode.window.showInformationMessage(
        `✓ ${displayName || id} uninstalled.`,
      );
      send({ type: "uninstallResult", success: true });
    } catch (err) {
      vscode.window.showErrorMessage(
        `Uninstall failed: ${(err as Error).message}`,
      );
      send({ type: "uninstallResult", success: false });
      return;
    }

    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!displayName || !wsRoot) {
      return;
    }

    const folderPath = path.join(wsRoot, CODE_SUPPORT_FOLDER, displayName);
    if (!fs.existsSync(folderPath)) {
      return;
    }

    const choiceCodeSupport = await vscode.window.showInformationMessage(
      `Remove Code Support for "${displayName}" from this workspace?`,
      { modal: true },
      "Remove",
      "Keep",
    );
    if (choiceCodeSupport === "Remove") {
      try {
        fs.rmSync(path.join(wsRoot, CODE_SUPPORT_FOLDER, displayName), {
          recursive: true,
          force: true,
        });
        removeStubsExtraPath(wsRoot, displayName);
        vscode.window.showInformationMessage(
          `Code Support removed for ${displayName}`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to delete Code Support: ${(err as Error).message}`,
        );
      }
    }
    onFinish();
  }

  /**
   * Updates the available code support libraries in the webview.
   */
  private _updateCodeSupport(send: Sender, libs: InstalledLibraryItem[]) {
    this._codeSupportHandler.updateCodeSupport(
      send,
      libs.map((lib) => lib.displayName).filter((name) => name !== undefined),
    );
  }
}
