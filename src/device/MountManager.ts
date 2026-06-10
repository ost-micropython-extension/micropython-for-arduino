import * as path from "path";
import * as vscode from "vscode";
import {
  CTRL_C,
  CTRL_D,
  CTRL_E,
  CTRL_X,
  getMountReplTitle,
} from "../types/constants";

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
    this.pasteMode(`exec(open("${relativePath}").read())`);
  }

  /**
   * Executes code via paste mode.
   */
  sendCodeBlock(code: string): void {
    // remove escapeNonAscii when https://github.com/micropython/micropython/pull/18853 is accepted
    this.pasteMode(escapeNonAscii(code));
  }

  private pasteMode(code: string): void {
    if (!this._active || !this._terminal) {
      return;
    }
    this._terminal.sendText(CTRL_C, false); // exit execution / ignore written text
    this._terminal.sendText(CTRL_E, false); // enter paste mode
    setTimeout(() => {
      if (!this._terminal) {
        return;
      }
      this._terminal.sendText(code, false);
      this._terminal.sendText(CTRL_D, false); // execute
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
  }

  async dispose(): Promise<void> {
    this._terminalCloseListener.dispose();
    this._cleanup();
  }
}

/**
 * Returns ascii string with replaced non ascii signs
 */
function escapeNonAscii(str: string): string {
  return str.replace(/[^\x00-\x7F]/g, (ch) => {
    const code = ch.codePointAt(0)!;
    return `\\0x${code.toString(16).padStart(2, "0")}`;
  });
}
