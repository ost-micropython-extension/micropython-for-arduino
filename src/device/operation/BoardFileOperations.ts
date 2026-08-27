import { DeviceManager } from "../DeviceManager";
import * as vscode from "vscode";

/** ilistdir() entry type for a directory (files are 0x8000). */
const DIR_TYPE = 0x4000;

/**
 * Thrown when a file transfer (upload/download) is cancelled — via the
 * progress notification's cancel button, the device being disposed (e.g.
 * disconnect), or the user declining a destination/replace prompt. Lets
 * callers detect cancellation reliably via `instanceof` instead of
 * string-comparing error messages.
 */
export class TransferCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferCancelledError";
  }
}

export class BoardFileOperations {
  /**
   * Uploads workspace file to the board.
   * Opens a Quick Pick menu with folders on the board to select target folder.
   * `onProgress` is called with the cumulative upload percentage (0-100).
   * The transfer is aborted (throwing "Upload cancelled") when `token` is
   * cancelled or the device is disposed (e.g. on disconnect) while it runs.
   */
  static async uploadFile(
    device: DeviceManager,
    path: string,
    name: string,
    onProgress?: (percent: number) => void,
    token?: vscode.CancellationToken,
  ): Promise<string | undefined> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });
    let targetPath: string | undefined;
    const cancellation = registerFileTransferCancellation(
      device,
      token,
      "Upload cancelled",
    );

    try {
      await device.withBoard(async (board) => {
        const nodes: { path: string; folderName: string }[] =
          await buildBoardTree(board, "/");

        let selected:
          | { label?: string; description?: string; value: string }
          | undefined;
        if (nodes.length === 1) {
          selected = { value: nodes[0].path };
        } else {
          selected = await vscode.window.showQuickPick(
            nodes.map((n) => ({
              label: n.folderName,
              description: n.path,
              value: n.path,
            })),
            {
              placeHolder: `Select destination folder for ${name}`,
            },
          );
        }

        if (!selected) {
          throw new TransferCancelledError("Upload cancelled");
        }

        targetPath = selected.value;

        if (await checkBoardPathExists(board, targetPath, name)) {
          const answer = await vscode.window.showWarningMessage(
            `"${name}" already exists in ${targetPath}`,
            { modal: true, detail: "Do you want to replace it?" },
            "Replace",
          );

          if (answer !== "Replace") {
            throw new TransferCancelledError("Upload cancelled");
          }
        }

        await board.fs_put(
          path,
          `${targetPath === "/" ? targetPath : targetPath + "/"}${name}`,
          cancellation.dataConsumer(onProgress),
        );
      });
      return targetPath;
    } catch (err) {
      throw err;
    } finally {
      cancellation.dispose();
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Overwrites or creates content at the path on the board.
   * `onProgress` is called with the cumulative upload percentage (0-100).
   * The transfer is aborted (throwing "Upload cancelled") when `token` is
   * cancelled or the device is disposed (e.g. on disconnect) while it runs.
   */
  static async uploadContent(
    device: DeviceManager,
    content: string,
    path: string,
    onProgress?: (percent: number) => void,
    token?: vscode.CancellationToken,
  ) {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });
    const cancellation = registerFileTransferCancellation(
      device,
      token,
      "Upload cancelled",
    );

    try {
      await device.withBoard(async (board) => {
        const dir = path.substring(0, path.lastIndexOf("/"));
        if (dir && dir !== "/") {
          await ensureDir(board, dir);
        }

        await board.fs_save(
          content,
          path,
          cancellation.dataConsumer(onProgress),
        );
      });
    } catch (err) {
      throw err;
    } finally {
      cancellation.dispose();
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Deletes file or folder from the board
   */
  static async delete(
    device: DeviceManager,
    isFolder: boolean,
    path: string,
  ): Promise<void> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    try {
      await device.withBoard(async (board) => {
        if (isFolder) {
          await deleteBoardPath(board, path);
        } else {
          await board.fs_rm(path);
        }
      });
    } catch (err) {
      throw err;
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Renames file or folder.
   * Throws if file to rename does not exist or new path already exists.
   */
  static async rename(
    device: DeviceManager,
    newName: string,
    dir: string,
    path: string,
    newPath: string,
  ): Promise<void> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    const oldName = path.split("/").pop()!;

    try {
      await device.withBoard(async (board) => {
        if (!(await checkBoardPathExists(board, dir, oldName))) {
          throw new Error(`"${oldName}" does not exist.`);
        }
        if (await checkBoardPathExists(board, dir, newName)) {
          throw new Error(`"${newName}" already exists in this folder.`);
        }
        await board.fs_rename(path, newPath);
      });
    } catch (err) {
      throw err;
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Creates a new file in target folder if not already exists.
   * If exists throws error.
   */
  static async create(
    device: DeviceManager,
    fileName: string,
    folderPath: string,
    fullPath: string,
  ): Promise<void> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    try {
      await device.withBoard(async (board) => {
        if (await checkBoardPathExists(board, folderPath, fileName)) {
          throw new Error(`"${fileName}" already exists in this folder.`);
        }
        await board.fs_save("\n", fullPath);
      });
    } catch (err) {
      throw err;
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Creates a new folder in target folder if not already exists.
   * If exists throws error.
   */
  static async createFolder(
    device: DeviceManager,
    folderName: string,
    folderPath: string,
    fullPath: string,
  ): Promise<void> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    try {
      await device.withBoard(async (board) => {
        if (await checkBoardPathExists(board, folderPath, folderName)) {
          throw new Error(`"${folderName}" already exists in this folder.`);
        }
        await board.fs_mkdir(fullPath);
      });
    } catch (err) {
      throw err;
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Returns content of board file.
   * `onProgress` is called with the cumulative download percentage (0-100).
   * The transfer is aborted (throwing "Download cancelled") when `token` is
   * cancelled or the device is disposed (e.g. on disconnect) while it runs.
   */
  static async getFileData(
    device: DeviceManager,
    path: string,
    onProgress?: (percent: number) => void,
    token?: vscode.CancellationToken,
  ): Promise<Uint8Array> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });
    const cancellation = registerFileTransferCancellation(
      device,
      token,
      "Download cancelled",
    );

    try {
      return await device.withBoard(async (board) => {
        const raw = await board.fs_cat_binary(
          path,
          cancellation.dataConsumer(onProgress),
        );
        return Buffer.from(raw);
      });
    } catch (err) {
      throw err;
    } finally {
      cancellation.dispose();
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Moves board file or folder to new path.
   * If new path already exists asks to replace.
   */
  static async move(device: DeviceManager, path: string, newPath: string) {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    try {
      await device.withBoard(async (board) => {
        const newName = newPath.split("/").pop();
        if (!newName) {
          throw new Error("could not read name of new Path");
        }
        const dir = newPath.split("/").slice(0, -1).join("/") || "/";
        const existingType = await boardEntryType(board, dir, newName);
        if (existingType !== undefined) {
          const answer = await vscode.window.showWarningMessage(
            `"${newName}" already exists in ${dir}`,
            { modal: true, detail: "Do you want to replace it?" },
            "Replace",
          );

          if (answer !== "Replace") {
            throw new Error("cancelled");
          }
          if (existingType === DIR_TYPE) {
            await deleteBoardPath(board, newPath);
          } else {
            await board.fs_rm(newPath);
          }
        }
        await board.fs_rename(path, newPath);
      });
    } catch (err) {
      throw err;
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }
}

/**
 * Wires up cancellation for a file transfer (upload or download) from two
 * sources: the given `CancellationToken` (e.g. the "Cancel" button on the
 * progress notification) and the device being disposed (e.g. on
 * disconnect). Returns a `dataConsumer` factory to pass as micropython.js's
 * per-chunk progress callback, which throws `cancelledMessage` once
 * cancellation was requested — this is the only point at which an
 * in-progress fs_put/fs_save/fs_cat_binary can be aborted.
 *
 * The progress value itself arrives as either a "NN%" string (fs_save,
 * fs_cat_binary) or a bare number (fs_put, as of micropython.js v2.1.2 —
 * inconsistent with its own docs, but harmless since both parse the same).
 */
function registerFileTransferCancellation(
  device: DeviceManager,
  token: vscode.CancellationToken | undefined,
  cancelledMessage: string,
) {
  // Initialize from the token's current state too — a listener registered
  // after the token was already cancelled would otherwise never see that
  // (the cancellation event fires once and doesn't replay for late listeners).
  let cancelled = token?.isCancellationRequested ?? false;
  const tokenListener = token?.onCancellationRequested(() => {
    cancelled = true;
  });
  device.setCancelOnDispose(() => {
    cancelled = true;
  });

  return {
    dataConsumer(onProgress?: (percent: number) => void) {
      return (percentValue: string | number) => {
        if (cancelled) {
          throw new TransferCancelledError(cancelledMessage);
        }
        const percent = parseInt(String(percentValue), 10);
        if (!Number.isNaN(percent)) {
          onProgress?.(percent);
        }
      };
    },
    dispose() {
      tokenListener?.dispose();
      device.setCancelOnDispose(undefined);
    },
  };
}

/** Recursively delete a folder on the board */
async function deleteBoardPath(board: any, targetPath: string): Promise<void> {
  // Tolerate fs_ils() failing (e.g. the folder is already gone) by treating
  // it as having no children, rather than crashing the for-of below on null.
  const entries = await board.fs_ils(targetPath).catch(() => [] as any[]);
  for (const [name, type] of entries) {
    const childPath = `${targetPath}/${name}`;
    if (type === DIR_TYPE) {
      await deleteBoardPath(board, childPath);
    } else {
      await board.fs_rm(childPath);
    }
  }
  await board.fs_rmdir(targetPath);
}

async function checkBoardPathExists(
  board: any,
  parentDir: string,
  name: string,
): Promise<boolean> {
  const entries = await board.fs_ils(parentDir);
  return entries.some(([entryName]: [string]) => entryName === name);
}

/**
 * Returns the ilistdir() type of `name` inside `parentDir` (DIR_TYPE for a
 * folder, something else for a file), or undefined if it does not exist.
 * Used so callers can tell whether an existing path to be replaced is a
 * file or a folder before deciding how to remove it.
 */
async function boardEntryType(
  board: any,
  parentDir: string,
  name: string,
): Promise<number | undefined> {
  const entries = await board.fs_ils(parentDir);
  const entry = entries.find(([entryName]: [string]) => entryName === name);
  return entry?.[1];
}

/** Creates directory if it does not exist */
async function ensureDir(board: any, dir: string) {
  const parts = dir.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      await board.fs_mkdir(current);
    } catch {
      // directory already exists, continue
    }
  }
}

/** Recursivly reads board folder tree  */
async function buildBoardTree(
  board: any,
  dirPath = "/",
): Promise<{ folderName: string; path: string }[]> {
  const entries = await withTimeout(
    board.fs_ils(dirPath === "/" ? undefined : dirPath),
    3000,
    `Reading Boardtree`,
  );
  const nodes: { folderName: string; path: string }[] = [];
  if (dirPath === "/") {
    nodes.push({ folderName: "root", path: dirPath });
  }

  for (const [name, type, ,] of entries as any) {
    const isDir = type === DIR_TYPE;
    const fullPath = dirPath === "/" ? `/${name}` : `${dirPath}/${name}`;

    if (isDir) {
      nodes.push({ path: fullPath, folderName: name });
      const children = await buildBoardTree(board, fullPath);
      for (const { folderName, path } of children) {
        nodes.push({ path: path, folderName: folderName });
      }
    }
  }

  return nodes;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} took too long`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
