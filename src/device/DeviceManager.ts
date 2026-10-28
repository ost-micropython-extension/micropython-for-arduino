import * as vscode from "vscode";
import MicroPython = require("micropython.js");
import { ReplTerminal } from "./ReplTerminal";
import { MountManager } from "./MountManager";
import { BoardStateManager } from "./BoardStateManager";
import { BoardState } from "../types/boardState";
import { RunFileOperation } from "./operation/RunFileOperation";
import { StopRunOperation } from "./operation/StopRunOperation";
import { RunCodeOperation } from "./operation/RunCodeOperation";
import { SoftResetOperation } from "./operation/SoftResetOperation";
import { FileNode, LibraryManifest } from "../types/messages";
import { FetchBoardFilesOperation } from "./operation/FetchBoardFilesOperation";
import { BoardFileOperations } from "./operation/BoardFileOperations";
import {
  FetchLibrariesOperation,
  InstallLibraryInput,
  InstallLibraryResult,
  InstalledLibraryItem,
  InstallLibraryOperation,
  UninstallLibraryOperation,
} from "./operation/LibraryOperations";
import { ReadManifestOperation } from "./operation/ReadManifestOperation";
import { ActivateMountOperation } from "./operation/ActivateMountOperation";
import {
  disposeReplSessionTerminal,
  enterReplSession,
  exitReplSession,
} from "./operation/ScriptRunner";
import {
  getMountReplTitle,
  getReplTitle,
  getScriptTerminalTitle,
} from "../types/constants";
import { BoardOperationCancelledError, TimeoutError } from "./errors";
import { withTimeout } from "./withTimeout";

export { BoardOperationCancelledError };

/**
 * How long to wait for micropython.js to open the port and finish its
 * raw-REPL handshake. A healthy board needs about a second. The library
 * gives up on a silent handshake after 10 s and rejects with a specific
 * error (TIMEOUT, DISCONNECTED, PORT_ERROR); this limit is deliberately
 * longer so that error wins whenever the library can detect the failure.
 * It only fires for hangs the library cannot see, such as the OS-level
 * port open or a board that keeps sending output.
 */
const OPEN_TIMEOUT_MS = 15_000;

/** How long to wait for the port to close before giving up on it. */
const CLOSE_TIMEOUT_MS = 3_000;

/**
 * Contains logic to access the board.
 * Forwards actions to operations.
 */
export class DeviceManager implements vscode.Disposable {
  readonly stateManager: BoardStateManager;
  readonly connectedPort: string;
  readonly repl: ReplTerminal;
  readonly mountManager: MountManager;
  /** Cancels the current long-running board operation (e.g. a file transfer) on dispose. */
  private _cancelBoard: (() => void) | undefined;
  private _activeBoard: InstanceType<typeof MicroPython> | null = null;
  private _verifying: Promise<void> = Promise.resolve();
  private readonly _closeListener: vscode.Disposable;

  constructor(
    port: string,
    stateListener: (port: string, state: BoardState) => void,
    mpremotePath: string = "mpremote",
  ) {
    this.stateManager = new BoardStateManager(
      {
        connected: true,
        mountActive: false,
        fileOpsActive: false,
        running: false,
        replOpen: false,
      },
      port,
      stateListener,
    );
    this.repl = new ReplTerminal();
    this.mountManager = new MountManager(mpremotePath);
    this.connectedPort = port;

    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    this._closeListener = vscode.window.onDidCloseTerminal(async (terminal) => {
      if (terminal.name === getReplTitle(this.connectedPort)) {
        this.stateManager.set({ replOpen: false });
      } else if (terminal.name === getScriptTerminalTitle(this.connectedPort)) {
        // ScriptRunner closes the session's serial connection itself
        if (!this.repl.isOpen) {
          this.stateManager.set({ replOpen: false });
        }
      } else if (terminal.name === getMountReplTitle(this.connectedPort)) {
        if (!this.mountManager.isClean) {
          // terminal was killed - reopen mount and unmount correctly after delay
          vscode.window.showErrorMessage("Mount terminal was killed");
          const wpf = vscode.workspace.workspaceFolders;
          if (wpf && this.connectedPort) {
            vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "closing mount properly",
                cancellable: false,
              },
              async () => {
                await this.mountManager.activate(
                  port,
                  wpf[0].uri.fsPath,
                  "secureMountExit",
                );
                await delay(5000); // would be better to await >>>, but not possible
                await this.mountManager.deactivate();
                this.renameMainAfterMount();
              },
            );
          }
        } else {
          this.renameMainAfterMount();
        }
      }
    });
  }

  private async renameMainAfterMount() {
    this.stateManager.set({ fileOpsActive: true, mountActive: false });
    await this.renameFile("main.py", "/", "/mainWhileMount.py", "/main.py");
  }

  // FILES
  async fetchFiles(): Promise<FileNode[]> {
    return await FetchBoardFilesOperation.execute(this, this.connectedPort);
  }
  async deleteFile(isFolder: boolean, path: string) {
    return await BoardFileOperations.delete(this, isFolder, path);
  }
  async renameFile(
    newName: string,
    dir: string,
    path: string,
    newPath: string,
  ) {
    return await BoardFileOperations.rename(this, newName, dir, path, newPath);
  }
  async createFile(fileName: string, folderPath: string, fullPath: string) {
    return await BoardFileOperations.create(
      this,
      fileName,
      folderPath,
      fullPath,
    );
  }
  async createFolder(folderName: string, folderPath: string, fullPath: string) {
    return await BoardFileOperations.createFolder(
      this,
      folderName,
      folderPath,
      fullPath,
    );
  }
  async getFileData(
    path: string,
    onProgress?: (percent: number) => void,
    token?: vscode.CancellationToken,
  ) {
    return await BoardFileOperations.getFileData(this, path, onProgress, token);
  }
  async uploadFile(
    path: string,
    name: string,
    onProgress?: (percent: number) => void,
    token?: vscode.CancellationToken,
  ): Promise<string | undefined> {
    return await BoardFileOperations.uploadFile(
      this,
      path,
      name,
      onProgress,
      token,
    );
  }
  async uploadFileOnRemotePath(
    content: string,
    remotePath: string,
    onProgress?: (percent: number) => void,
    token?: vscode.CancellationToken,
  ) {
    await BoardFileOperations.uploadContent(
      this,
      content,
      remotePath,
      onProgress,
      token,
    );
  }
  async move(nodePath: string, newPath: string) {
    await BoardFileOperations.move(this, nodePath, newPath);
  }

  // RUN
  async runFileWhileMount(filePath: string, code: string) {
    await RunFileOperation.executeMountedFile(this, filePath, code);
  }
  async runBoardfile(filePath: string) {
    await RunFileOperation.executeBoardfile(this, filePath);
  }
  async runCode(code: string, name?: string) {
    await RunCodeOperation.execute(this, code, name);
  }
  stopExecution() {
    StopRunOperation.execute(this, this._activeBoard);
  }
  softReset() {
    SoftResetOperation.execute(this);
  }

  // REPL
  async openRepl(): Promise<void> {
    if (await exitReplSession(this.connectedPort)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await this.repl.open(this.connectedPort);
    this.stateManager.set({ replOpen: true });
  }

  /**
   * Attaches an interactive REPL to the script output terminal after a run
   * or stop, so the user can enter commands based on the executed code.
   * With `createTerminal`, a missing script terminal is created and shown.
   */
  async enterScriptRepl(createTerminal: boolean = false): Promise<void> {
    if (this.mountManager.isActive || this.repl.isOpen) {
      return;
    }
    try {
      if (await enterReplSession(this.connectedPort, createTerminal)) {
        this.stateManager.set({ replOpen: true });
      }
    } catch {
      // Terminal stays non-interactive when the port cannot be reopened
    }
  }

  // MOUNT
  get mountActive() {
    return this.mountManager.isActive;
  }
  async deactivateMount() {
    await this.mountManager.deactivate();
  }
  async activateMount(folder: string) {
    await ActivateMountOperation.execute(this, this.connectedPort, folder);
  }

  // LIBRARY + STUBS
  fetchLibraries(): Promise<InstalledLibraryItem[]> {
    return FetchLibrariesOperation.execute(this);
  }
  installLibrary(
    input: InstallLibraryInput,
  ): Promise<InstallLibraryResult | null> {
    return InstallLibraryOperation.execute(this, input);
  }
  uninstallLibrary(name: string): Promise<InstalledLibraryItem[] | null> {
    return UninstallLibraryOperation.execute(this, name);
  }
  readManifest(): Promise<LibraryManifest | null> {
    return ReadManifestOperation.execute(this);
  }

  /**
   * Verifies that the board on this port is reachable by requesting a REPL
   * prompt. Fails when the serial port cannot be opened, is held by another
   * application, or the board does not respond within the timeout.
   * Concurrent withBoard() calls wait until verification has finished.
   */
  async verifyConnection(timeoutMs: number = 5000): Promise<void> {
    this._verifying = this._runWithBoard(
      (board) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Board did not respond.")),
            timeoutMs,
          );
          board.get_prompt().then(
            () => {
              clearTimeout(timer);
              resolve();
            },
            (err: Error) => {
              clearTimeout(timer);
              reject(err);
            },
          );
        }),
    );
    await this._verifying;
  }

  /**
   * Registers a callback that aborts the current long-running board
   * operation (e.g. a file transfer) once, invoked when the device is
   * disposed (e.g. on disconnect). Pass `undefined` to clear it once the
   * operation has finished. Only one operation can hold this at a time,
   * which matches `withBoard()`'s single-operation guarantee.
   */
  setCancelOnDispose(cancel: (() => void) | undefined): void {
    this._cancelBoard = cancel;
  }

  /**
   * Opens a fresh board connection for the duration of the callback.
   * Closes the REPL terminal first to ensure exclusive serial port access.
   * Throws if a board operation is already in progress.
   */
  async withBoard<T>(
    callback: (board: InstanceType<typeof MicroPython>) => Promise<T>,
  ): Promise<T> {
    await this._verifying;
    if (this._activeBoard) {
      throw new BoardOperationCancelledError();
    }
    return this._runWithBoard(callback);
  }

  private async _runWithBoard<T>(
    callback: (board: InstanceType<typeof MicroPython>) => Promise<T>,
  ): Promise<T> {
    if (this.repl.isOpen) {
      this.repl.close();
      this.stateManager.set({ replOpen: false });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (await exitReplSession(this.connectedPort)) {
      this.stateManager.set({ replOpen: false });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const board = new MicroPython();
    this._activeBoard = board;
    try {
      await this._openBoard(board);
      await board.stop(); // Ctrl-C – ensure board is at >>> prompt
      await new Promise((resolve) => setTimeout(resolve, 150));
      return await callback(board);
    } finally {
      this._activeBoard = null;
      await this._closeBoard(board);
    }
  }

  /**
   * Opens the port, but never waits forever. micropython.js runs the
   * raw-REPL handshake of open() inside a serial callback, so when a
   * handshake step fails (board resetting, busy or not answering) the
   * returned promise simply never settles. Without this limit the board
   * would stay marked as busy and every later operation would be rejected.
   */
  private async _openBoard(
    board: InstanceType<typeof MicroPython>,
  ): Promise<void> {
    try {
      await withTimeout(
        board.open(this.connectedPort),
        OPEN_TIMEOUT_MS,
        `Opening ${this.connectedPort}`,
      );
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new Error(
          `${this.connectedPort} did not respond. The board may be resetting, busy or in use by another application.`,
        );
      }
      throw err;
    }
  }

  /**
   * Releases the port. Best effort: a failing or hanging close must not hide
   * the result of the operation that just ran.
   */
  private async _closeBoard(
    board: InstanceType<typeof MicroPython>,
  ): Promise<void> {
    try {
      await withTimeout(
        board.close(),
        CLOSE_TIMEOUT_MS,
        `Closing ${this.connectedPort}`,
      );
    } catch {
      // The port may already be gone (board reset or unplugged)
    }
  }

  async dispose(): Promise<void> {
    if (this.mountManager.isActive) {
      await this.mountManager.deactivate();
    }

    if (this.repl.isOpen) {
      this.repl.close();
    }
    await disposeReplSessionTerminal(this.connectedPort);

    this._activeBoard?.stop();
    this._activeBoard = null;
    this._cancelBoard?.();

    this.repl.dispose();
    this.mountManager.dispose();
    this._closeListener.dispose();

    this.stateManager.set({
      connected: false,
      mountActive: false,
      replOpen: false,
      fileOpsActive: false,
      running: false,
    });
  }
}
