import { DeviceManager } from "../DeviceManager";
import { BoardOperationCancelledError } from "../errors";
import { withTimeout } from "../withTimeout";
import { FileNode } from "../../types/messages";

/**
 * A failed read often succeeds on the next try — seen on Windows, where the
 * first access to a COM port sometimes fails and a manual refresh then works.
 * One automatic retry saves the user that refresh. Reading the tree changes
 * nothing on the board, so repeating it is safe.
 */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;

export class FetchBoardFilesOperation {
  /**
   * Fetches board file tree and handles board state
   */
  static async execute(
    device: DeviceManager,
    port: string,
  ): Promise<FileNode[]> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    let children;
    try {
      children = await readTreeWithRetry(device);
    } catch (err) {
      stateManager.set({ fileOpsActive: false });
      throw err;
    }

    const displayName = port.split("/").pop() ?? port;

    const nodes: FileNode[] = [
      {
        id: "/",
        name: displayName,
        type: "folder",
        children: children,
        root: true,
      },
    ];
    return nodes;
  }
}

/**
 * Reads the board file tree, retrying after a failed attempt (see MAX_ATTEMPTS).
 */
async function readTreeWithRetry(device: DeviceManager): Promise<FileNode[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await device.withBoard((board) => buildBoardTree(board, "/"));
    } catch (err) {
      const giveUp =
        attempt >= MAX_ATTEMPTS ||
        // A busy board won't be less busy a moment later
        err instanceof BoardOperationCancelledError ||
        // The user disconnected in the meantime
        !device.stateManager.get().connected;
      if (giveUp) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

/**
 * Recusively reads board file tree
 */
async function buildBoardTree(
  board: any,
  dirPath: string,
): Promise<FileNode[]> {
  const entries = await withTimeout(
    board.fs_ils(dirPath === "/" ? undefined : dirPath),
    3000,
    `Reading Boardtree`,
  );
  const nodes: FileNode[] = [];

  for (const [name, type, , size] of entries as any) {
    const isDir = type === 0x4000;
    const fullPath = dirPath === "/" ? `/${name}` : `${dirPath}/${name}`;

    if (isDir) {
      const children = await buildBoardTree(board, fullPath);
      nodes.push({ id: fullPath, name, type: "folder", children });
    } else {
      nodes.push({
        id: fullPath,
        name,
        type: "file",
        meta: { size: size ?? 0 },
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
