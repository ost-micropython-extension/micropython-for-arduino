import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ConnectionManager } from "../../device/ConnectionManager";
import { FOLDER_OPENED_BOARD_FILES } from "../../types/constants";
import { reportTransferProgress } from "../utils";

const BOARD_FILES_KEY = "boardCacheFiles";

export class BoardFileSystemProvider
  implements vscode.FileSystemProvider, vscode.FileDecorationProvider
{
  static readonly SCHEME = "board";
  static readonly CACHE_DIR = FOLDER_OPENED_BOARD_FILES;

  private static _instance: BoardFileSystemProvider | undefined;

  /**
   * Returns the singleton BoardFileSystemProvider instance.
   */
  static instance(
    connectionManager?: ConnectionManager,
    ctx?: vscode.ExtensionContext,
  ): BoardFileSystemProvider {
    if (!BoardFileSystemProvider._instance) {
      if (!connectionManager || !ctx) {
        throw new Error(
          "ConnectionManager and ExtensionContext required on first call",
        );
      }
      BoardFileSystemProvider._instance = new BoardFileSystemProvider(
        connectionManager,
        ctx,
      );
    }
    return BoardFileSystemProvider._instance;
  }

  private _connected = false;
  private readonly _boardFiles = new Set<string>();

  private constructor(
    private readonly _connectionManager: ConnectionManager,
    private readonly _ctx: vscode.ExtensionContext,
  ) {
    this._restorePersistedFiles();
  }

  /**
   * Restores cached board files from workspace state.
   */
  private _restorePersistedFiles(): void {
    const saved = this._ctx.workspaceState.get<string[]>(BOARD_FILES_KEY, []);
    for (const uriStr of saved) {
      const uri = vscode.Uri.parse(uriStr);
      if (fs.existsSync(uri.fsPath)) {
        this._boardFiles.add(uriStr);
      }
    }
    if (this._boardFiles.size) {
      setTimeout(() => {
        this._decEmitter.fire(
          [...this._boardFiles].map((s) => vscode.Uri.parse(s)),
        );
      }, 500);
    }
  }

  /**
   * Persists cached board files in workspace state.
   */
  private _persistFiles(): void {
    this._ctx.workspaceState.update(BOARD_FILES_KEY, [...this._boardFiles]);
  }

  private readonly _fsEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this._fsEmitter.event;
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  private readonly _decEmitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[]
  >();
  readonly onDidChangeFileDecorations = this._decEmitter.event;

  /**
   * Provides file decorations for cached board files.
   */
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (!this._boardFiles.has(uri.toString())) {
      return;
    }
    if (!this._connected) {
      return {
        badge: "✕",
        tooltip: "Board disconnected",
        color: new vscode.ThemeColor("errorForeground"),
        propagate: false,
      };
    }
    return {
      badge: "📥⏳",
      tooltip: "Temporary downloaded file from board",
      color: new vscode.ThemeColor("terminal.ansiCyan"),
      propagate: false,
    };
  }

  /**
   * Returns the local board cache directory.
   */
  private _cacheDir(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]
      ? path.join(
          vscode.workspace.workspaceFolders[0].uri.fsPath,
          BoardFileSystemProvider.CACHE_DIR,
        )
      : undefined;
  }

  /**
   * Converts a board file path to a local cache path.
   */
  private _localPath(boardFilePath: string): string | undefined {
    const cacheDir = this._cacheDir();
    if (!cacheDir) {
      return undefined;
    }
    const relative = boardFilePath.startsWith("/")
      ? boardFilePath.slice(1)
      : boardFilePath;
    return path.join(cacheDir, relative);
  }

  /**
   * Converts a cached local file path back to a board path.
   */
  remotePath(fileUri: vscode.Uri): string | undefined {
    const cacheDir = this._cacheDir();
    if (!cacheDir) {
      return undefined;
    }
    const rel = path.relative(cacheDir, fileUri.fsPath);
    if (rel.startsWith("..")) {
      return undefined;
    }
    return "/" + rel.replace(/\\/g, "/");
  }

  /**
   * Checks whether a URI belongs to a cached board file.
   */
  isBoardFile(uri: vscode.Uri): boolean {
    return this._boardFiles.has(uri.toString());
  }

  /**
   * Returns the local URI for a board file.
   */
  localUri(boardFilePath: string): vscode.Uri | undefined {
    const local = this._localPath(boardFilePath);
    return local ? vscode.Uri.file(local) : undefined;
  }

  /**
   * Updates decorations when the board disconnects.
   */
  onDisconnect(): void {
    this._connected = false;
    if (this._boardFiles.size) {
      this._decEmitter.fire(
        [...this._boardFiles].map((s) => vscode.Uri.parse(s)),
      );
    }
  }

  /**
   * Updates decorations when the board reconnects.
   */
  onReconnect(): void {
    this._connected = true;
    if (this._boardFiles.size) {
      this._decEmitter.fire(
        [...this._boardFiles].map((s) => vscode.Uri.parse(s)),
      );
    }
  }

  /**
   * Removes cached files when a board file editor is closed.
   */
  async onBoardFileClosed(uri: vscode.Uri): Promise<void> {
    if (!this._boardFiles.has(uri.toString())) {
      return;
    }

    if (fs.existsSync(uri.fsPath)) {
      fs.rmSync(uri.fsPath, { force: true });
      this._tryDeleteEmptyParents(uri.fsPath);
    }

    this._boardFiles.delete(uri.toString());
    this._persistFiles();
    this._decEmitter.fire(uri);
  }

  /**
   * Deletes empty cache folders recursively.
   */
  private _tryDeleteEmptyParents(filePath: string): void {
    const cacheDir = this._cacheDir();
    if (!cacheDir) {
      return;
    }
    let dir = path.dirname(filePath);
    while (dir !== cacheDir && dir.startsWith(cacheDir)) {
      try {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
    try {
      fs.rmdirSync(cacheDir);
    } catch {
      /* not empty */
    }
  }

  /**
   * Downloads a board file and opens it locally.
   */
  async downloadAndOpen(port: string, boardFilePath: string): Promise<void> {
    const fileName = boardFilePath.split("/").pop() ?? boardFilePath;
    const localPath = this._localPath(boardFilePath);

    if (!localPath) {
      vscode.window.showErrorMessage(
        "No workspace folder open – cannot cache board file.",
      );
      return;
    }

    try {
      const data = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Reading ${fileName}...`,
          cancellable: false,
        },
        () =>
          this._connectionManager.getDevice(port).getFileData(boardFilePath),
      );
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, Buffer.from(data));

      const localUri = vscode.Uri.file(localPath);
      this._boardFiles.add(localUri.toString());
      this._persistFiles();
      this._decEmitter.fire(localUri);

      const doc = await vscode.workspace.openTextDocument(localUri);
      await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
      });

      const isMac = process.platform === "darwin";
      const saveShortcut = isMac ? "⌘S" : "Ctrl+S";
      const doNotShow = this._ctx.globalState.get<boolean>(
        "openBoardfileDialog.doNotShowAgain",
        false,
      );

      if (doNotShow) {
        return;
      }

      const selection = await vscode.window.showInformationMessage(
        `Editing "${fileName}" as a temporary file`,
        {
          modal: true,
          detail: `Saving the file will upload it back to the board.\n${saveShortcut}: Upload to board\nClose editor tab: Delete local copy`,
        },
        "Ok",
        "Don't show again",
      );

      if (selection === "Don't show again") {
        this._ctx.globalState.setKeysForSync([
          "openBoardfileDialog.doNotShowAgain",
        ]);
        await this._ctx.globalState.update(
          "openBoardfileDialog.doNotShowAgain",
          true,
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed opening "${fileName}": ${(err as Error).message}`,
      );
    }
  }

  /**
   * Uploads a cached board file back to the board.
   */
  async uploadActiveFile(uri: vscode.Uri, port: string): Promise<void> {
    if (!this._connected) {
      vscode.window.showErrorMessage(
        "Board disconnected – reconnect before uploading.",
      );
      return;
    }

    if (!this._boardFiles.has(uri.toString())) {
      vscode.window.showWarningMessage(
        "Active file is not a board file. Open a file from the board tree first.",
      );
      return;
    }

    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === uri.toString(),
    );

    if (!doc) {
      vscode.window.showErrorMessage(
        `Could not find Document: ${uri.toString()}`,
      );
      return;
    }

    if (doc.isDirty) {
      await doc.save();
    }

    const content = Buffer.from(doc.getText(), "utf8");
    const remotePath = this.remotePath(uri) ?? path.basename(uri.fsPath);
    const fileName = path.basename(uri.fsPath);
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${fileName} to board`,
          cancellable: true,
        },
        async (progress, token) =>
          this._connectionManager
            .getDevice(port)
            .uploadFileOnRemotePath(
              Buffer.from(content).toString("utf8"),
              remotePath,
              reportTransferProgress(progress),
              token,
            ),
      );

      vscode.window.showInformationMessage(`Uploaded ${fileName} to board`);
    } catch (err) {
      const message = (err as Error).message;
      if (message === "Upload cancelled") {
        vscode.window.showInformationMessage("Upload cancelled");
        return;
      }
      vscode.window.showErrorMessage(`Failed uploading: ${message}`);
    }
  }

  /**
   * Returns basic file metadata.
   */
  async stat(): Promise<vscode.FileStat> {
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 };
  }
  async readFile(): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async writeFile(): Promise<void> {}
  readDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("not supported");
  }
  createDirectory(): never {
    throw vscode.FileSystemError.NoPermissions("not supported");
  }
  delete(): never {
    throw vscode.FileSystemError.NoPermissions("not supported");
  }
  rename(): never {
    throw vscode.FileSystemError.NoPermissions("not supported");
  }
}
