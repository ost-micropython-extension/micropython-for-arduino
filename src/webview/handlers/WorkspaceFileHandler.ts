import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { FileNode } from "../../types/messages";
import { Sender } from "../WebviewGateway";
import { validateName } from "../utils";
import { ConnectionManager } from "../../device/ConnectionManager";
import { FOLDER_OPENED_BOARD_FILES } from "../../types/constants";

/**
 * Directories that will not show in workspace tree.
 */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  "dist",
  "out",
  ".vscode",
  FOLDER_OPENED_BOARD_FILES,
]);

/**
 * Contains handlers for workspace file tree actions.
 */
export class WorkspaceFileHandler {
  constructor(private readonly _connectionManager: ConnectionManager) {}

  /**
   * Loads the workspace file tree and sends it to the webview.
   */
  async handleGetWorkspaceFiles(send: Sender): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      send({ type: "workspaceFiles", nodes: [] });
      return;
    }
    try {
      const children = buildWorkspaceTree(root, root);
      const nodes: FileNode[] = [
        {
          id: root,
          name: path.basename(root),
          type: "folder",
          children: children,
          root: true,
        },
      ];
      send({ type: "workspaceFiles", nodes });
    } catch (err) {
      send({
        type: "workspaceFiles",
        nodes: [],
        error: (err as Error).message,
      });
    }
  }

  /**
   * Opens a file in the editor.
   */
  async handleOpenFile(path: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.window.showTextDocument(uri);
  }

  /**
   * Opens a file in a pinned editor tab.
   */
  async handleOpenFilePinned(path: string): Promise<void> {
    const uri = vscode.Uri.file(path);
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  /**
   * Deletes a workspace file or folder after confirmation.
   */
  async handleDeleteFile(nodePath: string): Promise<void> {
    const name = path.basename(nodePath);
    const choice = await vscode.window.showWarningMessage(
      `Permanently delete "${name}"?`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") {
      return;
    }

    try {
      const uri = vscode.Uri.file(nodePath);
      const targetPath = uri.fsPath;

      const tabsToClose: vscode.Tab[] = [];

      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            const tabPath = tab.input.uri.fsPath;

            if (
              tabPath === targetPath ||
              tabPath.startsWith(targetPath + path.sep)
            ) {
              tabsToClose.push(tab);
            }
          }
        }
      }

      if (tabsToClose.length > 0) {
        await vscode.window.tabGroups.close(tabsToClose);
      }

      await vscode.workspace.fs.delete(uri, {
        recursive: true,
      });
    } catch (err) {
      vscode.window.showErrorMessage(
        `Delete failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Renames a workspace file or folder.
   */
  async handleRenameFile(nodePath: string, isFolder: boolean): Promise<void> {
    const dir = path.dirname(nodePath);
    const oldName = path.basename(nodePath);
    const newName = await vscode.window.showInputBox({
      prompt: `Enter new name for "${oldName}"`,
      placeHolder: oldName,
      value: oldName,
      valueSelection: [0, oldName.length - path.extname(oldName).length],
      validateInput: validateName,
    });
    if (!newName || newName === oldName) {
      return;
    }
    if (!isFolder) {
      const oldExt = path.extname(oldName);
      const newExt = path.extname(newName);
      if (oldExt && newExt !== oldExt) {
        const proceed = await vscode.window.showWarningMessage(
          `Changing extension from "${oldExt}" to "${newExt}". Continue?`,
          { modal: true },
          "Continue",
          "Cancel",
        );
        if (proceed !== "Continue") {
          return;
        }
      }
    }
    const newPath = path.join(dir, newName);
    if (await checkExists(newPath)) {
      vscode.window.showErrorMessage(
        `"${newName}" already exists in this folder.`,
      );
      return;
    }
    try {
      await vscode.workspace.fs.rename(
        vscode.Uri.file(nodePath),
        vscode.Uri.file(newPath),
      );
    } catch (err) {
      vscode.window.showErrorMessage(
        `Rename file failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Creates a new empty file in the workspace.
   */
  async handleCreateFile(folderPath: string): Promise<void> {
    const newName = await vscode.window.showInputBox({
      prompt: "Enter name for new file",
      placeHolder: "example.py",
      value: ".py",
      valueSelection: [0, 0],
      validateInput: validateName,
    });
    if (!newName) {
      return;
    }
    const newFilePath = path.join(folderPath, newName);
    if (await checkExists(newFilePath)) {
      vscode.window.showErrorMessage(
        `"${newName}" already exists in this folder.`,
      );
      return;
    }
    try {
      const uri = vscode.Uri.file(newFilePath);
      await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      await vscode.window.showTextDocument(uri);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Create file failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Creates a new folder in the workspace.
   */
  async handleCreateFolder(folderPath: string): Promise<void> {
    const newFolder = await vscode.window.showInputBox({
      prompt: "Enter name for new folder",
      placeHolder: "folderName",
      validateInput: validateName,
    });
    if (!newFolder) {
      return;
    }
    const newFolderPath = path.join(folderPath, newFolder);
    if (await checkExists(newFolderPath)) {
      vscode.window.showErrorMessage(
        `"${newFolder}" already exists in this folder.`,
      );
      return;
    }
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(newFolderPath));
    } catch (err) {
      vscode.window.showErrorMessage(
        `Create folder failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Uploads a workspace file to the connected board.
   */
  async handleUploadFile(
    nodePath: string,
    port: string,
    send: Sender,
  ): Promise<void> {
    const name = path.basename(nodePath);
    try {
      const parentPath = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${name}...`,
          cancellable: false,
        },
        () =>
          this._connectionManager.getDevice(port).uploadFile(nodePath, name),
      );
      if (parentPath) {
        send({
          type: "bf_nodeCreated",
          parentId: parentPath,
          node: {
            id: `${parentPath === "/" ? "" : parentPath}/${name}`,
            name,
            type: "file",
          },
          select: false,
          port: port,
        });
        vscode.window.showInformationMessage(`Upload successful`);
      }
    } catch (err) {
      const message = (err as Error).message;
      vscode.window.showErrorMessage(`Upload failed: ${message}`);
    }
  }

  /**
   * Moves a file or folder to another workspace folder.
   */
  async handleMove(nodePath: string, targetPath: string): Promise<void> {
    const name = path.basename(nodePath);
    const targetName = path.basename(targetPath);
    const newPath = path.join(targetPath, name);
    if (fs.existsSync(newPath)) {
      const answer = await vscode.window.showWarningMessage(
        `"${name}" already exists in the target folder.`,
        { modal: true, detail: "Do you want to replace it?" },
        "Replace",
      );

      if (answer !== "Replace") {
        return;
      }
    }
    try {
      const uriNodePath = vscode.Uri.file(nodePath);
      const uriNewPath = vscode.Uri.file(newPath);
      await vscode.workspace.fs.rename(uriNodePath, uriNewPath, {
        overwrite: true,
      });
      vscode.window.showInformationMessage(`Moved ${name} to ${targetName}`);
    } catch (err) {
      const message = (err as Error).message;
      vscode.window.showErrorMessage(`Move failed: ${message}`);
    }
  }
}

/**
 * Builds a recursive workspace file tree.
 * Ignored folders are skipped.
 */
function buildWorkspaceTree(dirPath: string, root: string): FileNode[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const children = buildWorkspaceTree(fullPath, root);
      nodes.push({
        id: fullPath,
        name: entry.name,
        type: "folder",
        children,
      });
    } else if (entry.isFile()) {
      nodes.push({
        id: fullPath,
        name: entry.name,
        type: "file",
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

/**
 * Checks whether a file or folder exists.
 */
async function checkExists(filePath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}
