import { DeviceManager } from "../DeviceManager";

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
