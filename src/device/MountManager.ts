import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  CTRL_A,
  CTRL_B,
  CTRL_C,
  CTRL_D,
  CTRL_E,
  CTRL_X,
  getMountReplTitle,
  MOUNT_RUN_FILE,
} from "../types/constants";

/**
 * How code is sent into the mount REPL:
 * - "paste": paste mode — echoes the sent code, works with input()
 * - "raw": raw REPL mode — no echo, but queues a Ctrl-B that a script
 *   reading stdin (e.g. via input()) would receive as a stray byte
 */
export type MountReplMode = "paste" | "raw";

export class MountManager implements vscode.Disposable {
  private _terminal: vscode.Terminal | undefined;
  private _active = false;
  private _clean = true;
  private _exitListener: vscode.Disposable | undefined;
  private _folder = "";

  private readonly _terminalCloseListener: vscode.Disposable;

  constructor(private readonly _mpremotePath: string = "mpremote") {
    this._terminalCloseListener = vscode.window.onDidCloseTerminal((t) => {
      if (t === this._terminal) {
        this._cleanup();
      }
    });
  }

  get isActive(): boolean {
    return this._active;
  }

  get isClean(): boolean {
    return this._clean;
  }

  /**
   * Starts a terminal and executes mpremote mount command for port and workspace folder
   */
  async activate(
    port: string,
    folder: string,
    terminalName?: string,
  ): Promise<void> {
    if (this._active) {
      this._terminal?.show(true);
      return;
    }
    this._folder = folder;

    const env =
      this._mpremotePath !== "mpremote"
        ? {
            PATH: `${path.dirname(this._mpremotePath)}${path.delimiter}${process.env.PATH ?? ""}`,
          }
        : undefined;

    this._terminal = vscode.window.createTerminal({
      name: terminalName || getMountReplTitle(port),
      cwd: folder,
      isTransient: true,
      env,
      iconPath: new vscode.ThemeIcon("circuit-board"),
      color: new vscode.ThemeColor("terminal.ansiBrightBlue"),
    });

    this._terminal.show(true);

    // Small delay to let the shell initialize before sending the command.
    await new Promise((resolve) => setTimeout(resolve, 300));

    this._terminal.sendText(
      `mpremote connect ${port} mount "${folder}" + repl`,
      true,
    );

    this._active = true;
    this._clean = false;

    this._exitListener = vscode.window.onDidEndTerminalShellExecution((e) => {
      if (e.terminal !== this._terminal) {
        return;
      }

      this._clean = true;

      this._cleanup();
    });
  }

  /**
   * Sends a short single-line command into the REPL.
   */
  sendCommand(command: string): void {
    if (!this._active || !this._terminal) {
      return;
    }
    this._terminal.sendText(command, true);
  }

  /**
   * Executes a file via reading and executing content.
   */
  sendFile(filePath: string, code: string): void {
    const relativePath = path
      .relative(this._folder, filePath)
      .replace(/\\/g, "/");
    if (relativePath.startsWith("..")) {
      this.sendCodeBlock(code);
      return;
    }
    this.replMode(`exec(open("${relativePath}").read())`, "paste");
  }

  /**
   * Executes a code block. The code is staged as a temp file in the mounted
   * folder and executed from there, so only a single exec line appears in
   * the terminal and the code bytes never pass through the console input
   * (no non-ASCII escaping needed). The board reads the file through the
   * mount VFS and runs it from RAM.
   */
  sendCodeBlock(code: string): void {
    if (!this._active || !this._terminal) {
      return;
    }
    try {
      fs.writeFileSync(path.join(this._folder, MOUNT_RUN_FILE), code);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Could not stage code in mounted folder: ${(err as Error).message}`,
      );
      return;
    }
    this.replMode(`exec(open("${MOUNT_RUN_FILE}").read())`, "paste");
  }

  /**
   * Sends code into the mount REPL. Paste mode echoes the code and keeps
   * stdin clean for input(); raw REPL mode sends without echo and queues a
   * Ctrl-B that returns the board to the friendly REPL once execution has
   * finished.
   */
  private replMode(code: string, mode: MountReplMode): void {
    if (!this._active || !this._terminal) {
      return;
    }
    this._terminal.sendText(CTRL_C, false); // exit execution / ignore written text
    this._terminal.sendText(mode === "raw" ? CTRL_A : CTRL_E, false);
    setTimeout(() => {
      if (!this._terminal) {
        return;
      }
      this._terminal.sendText(code, false);
      this._terminal.sendText(CTRL_D, false); // execute
      if (mode === "raw") {
        this._terminal.sendText(CTRL_B, false); // back to friendly REPL when done
      }
    }, 50);
  }

  /**
   * Sends interrupt command to terminal
   */
  sendInterrupt(): void {
    if (!this._active || !this._terminal) {
      return;
    }
    this._terminal.sendText(CTRL_C, false);
  }

  /**
   * Sends soft reset command to terminal
   */
  sendSoftReset(): void {
    if (!this._active || !this._terminal) {
      return;
    }
    this._terminal.sendText(CTRL_D, false);
  }

  /**
   * Stops active mount
   */
  async deactivate(): Promise<void> {
    if (!this._active) {
      return;
    }
    await this._gracefulExit();
    this._clean = true;
    this._cleanup();
  }

  private async _gracefulExit(): Promise<void> {
    if (!this._terminal) {
      return;
    }

    this._terminal.sendText(CTRL_X, false);

    // wait for console close and main.py rename
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  private _cleanup(): void {
    if (!this._active) {
      return;
    }
    this._active = false;

    this._exitListener?.dispose();
    this._exitListener = undefined;

    if (this._terminal) {
      this._terminal.dispose();
      this._terminal = undefined;
    }

    this._removeRunFile();
  }

  /**
   * Removes the staged run file from the mounted folder.
   */
  private _removeRunFile(): void {
    if (!this._folder) {
      return;
    }
    try {
      fs.unlinkSync(path.join(this._folder, MOUNT_RUN_FILE));
    } catch {
      // no staged run file present
    }
  }

  async dispose(): Promise<void> {
    this._terminalCloseListener.dispose();
    this._cleanup();
  }
}
