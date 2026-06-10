import { DeviceManager } from "../../device/DeviceManager";
import { readManifest } from "../../device/manifest";
import { LibraryManifest } from "../../types/messages";

export class ReadManifestOperation {
  /**
   * Reads manifest.json from the board lib folder
   */
  static async execute(device: DeviceManager): Promise<LibraryManifest | null> {
    return device.withBoard(async (board) => readManifest(board));
  }
}
