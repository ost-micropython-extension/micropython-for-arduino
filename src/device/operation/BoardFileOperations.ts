import { DeviceManager } from "../DeviceManager";
import * as vscode from "vscode";

export class BoardFileOperations {
  /**
   * Uploads workspace file to the board.
   * Opens a Quick Pick menu with folders on the board to select target folder.
   */
  static async uploadFile(
    device: DeviceManager,
    path: string,
    name: string,
  ): Promise<string | undefined> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });
    let targetPath: string | undefined;

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
          throw new Error("Upload cancelled");
        }

        targetPath = selected.value;

        if (await checkBoardPathExists(board, targetPath, name)) {
          const answer = await vscode.window.showWarningMessage(
            `"${name}" already exists in ${targetPath}`,
            { modal: true, detail: "Do you want to replace it?" },
            "Replace",
          );

          if (answer !== "Replace") {
            throw new Error("Upload cancelled");
          }
        }

        await board.fs_put(
          path,
          `${targetPath === "/" ? targetPath : targetPath + "/"}${name}`,
        );
      });
      return targetPath;
    } catch (err) {
      throw err;
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }

  /**
   * Overwrites or creates content at the path on the board
   */
  static async uploadContent(
    device: DeviceManager,
    content: string,
    path: string,
  ) {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    try {
      await device.withBoard(async (board) => {
        const dir = path.substring(0, path.lastIndexOf("/"));
        if (dir && dir !== "/") {
          await ensureDir(board, dir);
        }

        await board.fs_save(content, path);
      });
    } catch (err) {
      throw err;
    } finally {
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
   */
  static async getFileData(
    device: DeviceManager,
    path: string,
  ): Promise<Uint8Array> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });

    try {
      return await device.withBoard(async (board) => {
        const raw = await board.fs_cat_binary(path);
        return Buffer.from(raw);
      });
    } catch (err) {
      throw err;
    } finally {
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
        if (await checkBoardPathExists(board, dir, newName)) {
          const answer = await vscode.window.showWarningMessage(
            `"${newName}" already exists in ${dir}`,
            { modal: true, detail: "Do you want to replace it?" },
            "Replace",
          );

          if (answer !== "Replace") {
            throw new Error("cancelled");
          }
          await deleteBoardPath(board, newPath);
        }
        await board.fs_rename(path, newPath);
      });
    } catch (err) {
      stateManager.set({ fileOpsActive: false });
      throw err;
    }
  }
}

/** Recursively delete a folder on the board */
async function deleteBoardPath(board: any, targetPath: string): Promise<void> {
  const entries = await board
    .fs_ils(targetPath)
    .catch(() => null as null | any[]);
  for (const [name, type] of entries) {
    const childPath = `${targetPath}/${name}`;
    if (type === 0x4000) {
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
    const isDir = type === 0x4000;
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
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`${label} took too long`)), ms),
  );
  return Promise.race([promise, timeout]);
}
