import { DeviceManager } from "../DeviceManager";
import MicroPython = require("micropython.js");

export class StopRunOperation {
  /**
   * Stops execution in mount, repl or running script
   */
  static async execute(
    device: DeviceManager,
    activeBoard: InstanceType<typeof MicroPython> | null,
  ) {
    const { mountManager, repl, stateManager } = device;

    // Mount mode
    if (mountManager.isActive) {
      mountManager.sendInterrupt();
    } else if (repl.isOpen) {
      repl.interrupt();
    } else {
      // Normal execution
      if (activeBoard === null) {
        device.withBoard(async (board) => {
          board.stop();
        });
      } else {
        activeBoard.stop();
      }
      stateManager.set({
        running: false,
      });
    }
  }
}
