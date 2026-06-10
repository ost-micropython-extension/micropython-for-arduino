import MicroPython = require("micropython.js");
import { LibraryManifest } from "../types/messages";

const MANIFEST_PATH = "/lib/manifest.json";

/**
 * Reads manifest.json from board.
 */
export async function readManifest(
  board: InstanceType<typeof MicroPython>,
): Promise<LibraryManifest> {
  try {
    const bytes = await board.fs_cat_binary(MANIFEST_PATH);
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as LibraryManifest;
  } catch {
    return { packages: {} };
  }
}

/**
 * Writes manifest.json to the board.
 */
export async function writeManifest(
  board: InstanceType<typeof MicroPython>,
  manifest: LibraryManifest,
): Promise<void> {
  await board.fs_save(JSON.stringify(manifest), MANIFEST_PATH);
}
