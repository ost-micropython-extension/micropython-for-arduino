import { DeviceManager } from "../DeviceManager";
import { writeToReplSession } from "./ScriptRunner";
import { CTRL_C, CTRL_D } from "../../types/constants";

export class SoftResetOperation {
  /**
   * Executes a SoftReset on the board.
   */
  static async execute(device: DeviceManager) {
    const { mountManager, repl, stateManager } = device;

    // Mount mode: send Ctrl+D directly into the Mount REPL
    if (mountManager.isActive) {
      mountManager.sendSoftReset();
      return;
    }

    // Send reset through the script terminal's REPL session
    if (writeToReplSession(device.connectedPort, CTRL_C)) {
      setTimeout(() => writeToReplSession(device.connectedPort, CTRL_D), 100);
      return;
    }

    // Send reset through the open REPL's serial connection
    if (!repl.isOpen) {
      stateManager.set({ replOpen: true });
      await repl.open(device.connectedPort);
      setTimeout(() => repl.softReset(), 300);
    } else {
      repl.softReset();
    }
  }
}
