import * as vscode from "vscode";
import * as path from "path";
import { DeviceManager } from "../DeviceManager";
import { runBoardFile } from "./ScriptRunner";

export class RunFileOperation {
  /**
   * Runs local file on the board while mount is active
   */
  static async executeMountedFile(
    device: DeviceManager,
    filePath: string,
    code: string,
  ) {
    const { mountManager } = device;

    if (mountManager.isActive) {
      mountManager.sendFile(filePath, code);
    }
  }

  /**
   * Runs boardfile on the board and handles boardstate
   */
  static async executeBoardfile(device: DeviceManager, filePath: string) {
    const { stateManager } = device;
    try {
      await device.withBoard(async (board) => {
        stateManager.set({ running: true });

        await runBoardFile(board, filePath, device.connectedPort);
      });

      // Keep the terminal interactive so the user can inspect the run's state
      await device.enterScriptRepl();
    } finally {
      stateManager.set({ running: false });
    }
  }
}
