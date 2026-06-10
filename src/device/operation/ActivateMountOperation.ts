import { DeviceManager } from "../DeviceManager";

export class ActivateMountOperation {
  /**
   * Activates mount and handles board state
   *
   * To ensure softreset works properly while mount main.py will be renamed before mount is activated.
   */
  static async execute(device: DeviceManager, port: string, folder: string) {
    const { stateManager, repl, mountManager } = device;

    // Close REPL if open so mpremote can grab the serial port
    if (repl.isOpen) {
      repl.close();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    try {
      await device.renameFile(
        "mainWhileMount.py",
        "/",
        "/main.py",
        "/mainWhileMount.py",
      );
    } catch (err) {
      const message = (err as Error).message;
      if (message !== `"main.py" does not exist.`) {
        if (message === `"mainWhileMount.py" already exists in this folder.`) {
          throw new Error(
            "Can not rename main.py from board, since mainWhileMount.py already exists.",
          );
        } else {
          throw err;
        }
      }
    }
    stateManager.set({ mountActive: true });
    mountManager.activate(port, folder);
  }
}
