import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { Sender } from "../WebviewGateway";
import { BoardOperationCancelledError } from "../../device/DeviceManager";
import { validateName, selectFolder } from "../utils";
import { BoardFileSystemProvider } from "./BoardFileSystemProvider";
import { ConnectionManager } from "../../device/ConnectionManager";

export class BoardFileHandler {
  constructor(private readonly _connectionManager: ConnectionManager) {}

  /**
   * Fetches the complete board file tree.
   */
  async handleGetBoardFiles(port: string, send: Sender): Promise<void> {
    try {
      if (!port) {
        return;
      }
      const nodes = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Fetching boardfiles...",
          cancellable: false,
        },
        () => this._connectionManager.getDevice(port).fetchFiles(),
      );

      send({ type: "boardFiles", port, nodes });
    } catch (err) {
      if (err instanceof BoardOperationCancelledError) {
        return; // Port changed – a new getBoardFiles will follow automatically
      }
      vscode.window.showErrorMessage(
        "Fetching boardfiles: " + (err as Error).message,
      );
      send({
        type: "boardFiles",
        port,
        nodes: [],
        error: (err as Error).message,
      });
    }
  }

  /**
   * Focuses the board file if its already open.
   */
  async handleOpenFile(path: string): Promise<boolean> {
    const localUri = BoardFileSystemProvider.instance().localUri(path);

    if (!localUri) {
      return false;
    }

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === localUri.toString()
        ) {
          await vscode.window.showTextDocument(tab.input.uri, {
            preview: false,
            preserveFocus: false,
          });
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Downloads and opens a board file persistently.
   */
  async handleOpenFilePinned(path: string, port: string): Promise<void> {
    if (
      (await this.handleOpenFile(path)) ||
      this._connectionManager.getDevice(port).mountActive
    ) {
      return;
    }
    await BoardFileSystemProvider.instance().downloadAndOpen(port, path);
  }

  /**
   * Deletes a board file or folder.
   */
  async handleDelete(
    path: string,
    isFolder: boolean,
    port: string,
    send: Sender,
  ): Promise<void> {
    const label = path.split("/").pop() ?? path;

    const answer = await vscode.window.showWarningMessage(
      `Delete "${label}" from the board? This cannot be undone.`,
      { modal: true },
      "Delete",
    );
    if (answer !== "Delete") {
      return;
    }

    try {
      await this._connectionManager.getDevice(port).deleteFile(isFolder, path);
      send({ type: "bf_nodeDeleted", nodeId: path, port });
      vscode.window.showInformationMessage(`${label} deleted`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to delete "${label}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Renames a board file or folder.
   */
  async handleRenameFile(
    nodePath: string,
    isFolder: boolean,
    port: string,
    send: Sender,
  ): Promise<void> {
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
        );
        if (proceed !== "Continue") {
          return;
        }
      }
    }

    const newPath = dir === "/" ? `/${newName}` : `${dir}/${newName}`;

    try {
      await this._connectionManager
        .getDevice(port)
        .renameFile(newName, dir, nodePath, newPath);
      send({
        type: "bf_nodeRenamed",
        nodeId: nodePath,
        newId: newPath,
        newName,
        port,
      });
      vscode.window.showInformationMessage(`Renamed ${oldName} to ${newName}`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Rename failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Creates a new file on the board.
   */
  async handleCreateFile(
    folderPath: string,
    port: string,
    send: Sender,
  ): Promise<void> {
    const fileName = await vscode.window.showInputBox({
      prompt: "Enter name for new file",
      placeHolder: "example.py",
      value: ".py",
      valueSelection: [0, 0],
      validateInput: validateName,
    });
    if (!fileName) {
      return;
    }

    const fullPath =
      folderPath === "/" ? `/${fileName}` : `${folderPath}/${fileName}`;

    try {
      await this._connectionManager
        .getDevice(port)
        .createFile(fileName, folderPath, fullPath);
      send({
        type: "bf_nodeCreated",
        parentId: folderPath,
        node: {
          id: fullPath,
          name: fileName,
          type: "file",
          meta: { size: 1 },
        },
        select: true,
        port,
      });
      vscode.window.showInformationMessage(`${fileName} created`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Creation failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Creates a new folder on the board.
   */
  async handleCreateFolder(
    folderPath: string,
    port: string,
    send: Sender,
  ): Promise<void> {
    const folderName = await vscode.window.showInputBox({
      prompt: "Enter folder name",
      placeHolder: "folderName",
      validateInput: validateName,
    });

    if (!folderName) {
      return;
    }

    const fullPath =
      folderPath === "/" ? `/${folderName}` : `${folderPath}/${folderName}`;

    try {
      await this._connectionManager
        .getDevice(port)
        .createFolder(folderName, folderPath, fullPath);
      send({
        type: "bf_nodeCreated",
        parentId: folderPath,
        node: {
          id: fullPath,
          name: folderName,
          type: "folder",
          children: [],
        },
        select: true,
        port,
      });
      vscode.window.showInformationMessage(`${folderName} created`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to create folder "${folderName}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Downloads a board file into the workspace.
   */
  async handleDownloadFile(nodePath: string, port: string): Promise<void> {
    const fileName = nodePath.split("/").pop() ?? nodePath;

    const folderPath = await selectFolder(
      `Select target folder for ${fileName}`,
    );

    if (!folderPath) {
      return;
    }

    const filePath = path.join(folderPath, fileName);
    const uri = vscode.Uri.file(filePath);

    if (fs.existsSync(filePath)) {
      const answer = await vscode.window.showWarningMessage(
        `"${fileName}" already exists in the selected folder.`,
        { modal: true, detail: "Do you want to replace it?" },
        "Replace",
      );

      if (answer !== "Replace") {
        return;
      }
    }

    try {
      const data = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Downloading ${fileName}...`,
          cancellable: false,
        },
        () => this._connectionManager.getDevice(port).getFileData(nodePath),
      );

      await vscode.workspace.fs.writeFile(uri, data);

      vscode.window.showInformationMessage(`Download finished`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to download "${fileName}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Executes a Python file on the board.
   */
  async handleRunFile(path: string, port: string): Promise<void> {
    if (!path.endsWith(".py")) {
      vscode.window.showWarningMessage(
        "Run Boardfile: Only Python files (.py) can be executed.",
      );
      return;
    }

    try {
      await this._connectionManager.getDevice(port).runBoardfile(path);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to run boardfile: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Moves a board file or folder to another location.
   */
  async handleMove(
    nodePath: string,
    targetPath: string,
    port: string,
    send: Sender,
  ): Promise<void> {
    const name = path.basename(nodePath);
    const targetName = targetPath === "/" ? port : path.basename(targetPath);
    const newPath = `${targetPath === "/" ? "" : targetPath}/${name}`;
    try {
      await this._connectionManager.getDevice(port).move(nodePath, newPath);

      vscode.window.showInformationMessage(`Moved ${name} to ${targetName}`);
      send({ type: "refreshBoardFiles", port: port });
    } catch (err) {
      if (err instanceof BoardOperationCancelledError) {
        vscode.window.showWarningMessage("Can't move while board is in use");
      } else {
        const message = (err as Error).message;
        vscode.window.showErrorMessage(`Move failed: ${message}`);
      }
    }
  }
}
