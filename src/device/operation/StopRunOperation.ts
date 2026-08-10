import { DeviceManager } from "../DeviceManager";
import MicroPython = require("micropython.js");
import { writeToReplSession } from "./ScriptRunner";
import { CTRL_C } from "../../types/constants";

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
    } else if (writeToReplSession(device.connectedPort, CTRL_C)) {
      // Interrupt sent through the script terminal's REPL session
    } else {
      // Normal execution
      if (activeBoard === null) {
        // Nothing started by the extension (e.g. auto-running main.py):
        // stop it and land the user at a REPL prompt
        await device.withBoard(async (board) => {
          await board.stop();
        });
        stateManager.set({
          running: false,
        });
        await device.enterScriptRepl(true);
      } else {
        // A running script — its run flow enters the REPL after stopping
        activeBoard.stop();
        stateManager.set({
          running: false,
        });
      }
    }
  }
}
