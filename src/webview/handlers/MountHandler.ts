import * as vscode from "vscode";
import { ConnectionManager } from "../../device/ConnectionManager";
import { selectFolder } from "../utils";

export class MountHandler {
  constructor(
    private readonly _connectionManager: ConnectionManager,
    private readonly _ctx: vscode.ExtensionContext,
  ) {}

  /**
   * Toggles the mount state of a board.
   */
  async handleToggle(port: string): Promise<void> {
    try {
      if (this._connectionManager.getDevice(port).mountActive) {
        this.handleDeactivate(port);
      } else {
        this.handleActivate(port);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to mount: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Activates mpremote mount for the board.
   */
  async handleActivate(port: string): Promise<void> {
    try {
      const mountFolder = await selectFolder(
        `Select folder that will be mounted`,
      );
      if (!mountFolder) {
        return;
      }

      await this._connectionManager.getDevice(port).activateMount(mountFolder);

      const doNotShow = this._ctx.globalState.get<boolean>(
        "activateMountDialog.doNotShowAgain",
        false,
      );

      if (doNotShow) {
        return;
      }

      const selection = await vscode.window.showInformationMessage(
        `The board now has access to your local directory. Make sure to unmount before closing VS Code.`,
        "Ok",
        "Don't show again",
      );

      if (selection === "Don't show again") {
        this._ctx.globalState.setKeysForSync([
          "activateMountDialog.doNotShowAgain",
        ]);
        await this._ctx.globalState.update(
          "activateMountDialog.doNotShowAgain",
          true,
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage((err as Error).message);
    }
  }

  /**
   * Deactivates the active board mount.
   */
  async handleDeactivate(port: string): Promise<void> {
    await this._connectionManager.getDevice(port).deactivateMount();
  }
}
