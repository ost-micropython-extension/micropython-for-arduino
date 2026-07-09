import { DeviceManager } from "../DeviceManager";
import { runCode } from "./ScriptRunner";

export class RunCodeOperation {
  /**
   * Runs code on board and handles board state
   */
  static async execute(device: DeviceManager, code: string, name?: string) {
    const { mountManager, stateManager } = device;

    // Mount mode
    if (mountManager.isActive) {
      mountManager.sendCodeBlock(code);
      return;
    }

    // Normal execution
    await device.withBoard(async (board) => {
      stateManager.set({
        running: true,
      });

      await runCode(board, code, device.connectedPort, name);

      stateManager.set({
        running: false,
      });
    });

    // Keep the terminal interactive so the user can inspect the run's state
    await device.enterScriptRepl();
  }
}
