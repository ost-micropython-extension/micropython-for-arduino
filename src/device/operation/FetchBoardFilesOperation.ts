import { DeviceManager } from "../DeviceManager";
import { FileNode } from "../../types/messages";

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
      children = await device.withBoard(async (board) => {
        return buildBoardTree(board, "/");
      });
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

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} took too long`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timeoutId),
  );
}
