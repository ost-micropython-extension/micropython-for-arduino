import * as vscode from "vscode";
import MicroPython = require("micropython.js");
import { CTRL_C, CTRL_D, ENTER_REPL, getReplTitle } from "../types/constants";

export class ReplTerminal implements vscode.Disposable {
  private _board: InstanceType<typeof MicroPython> | undefined;
  private _terminal: vscode.Terminal | undefined;
  private _writeEmitter: vscode.EventEmitter<string> | undefined;
  private _dataHandler: ((data: Buffer) => void) | undefined;
  private readonly _closeListener: vscode.Disposable;

  constructor() {
    // When the user manually closes the terminal panel, clean up the board
    this._closeListener = vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === this._terminal) {
        this._disposeBoard();
        this._terminal = undefined;
        this._writeEmitter?.dispose();
        this._writeEmitter = undefined;
      }
    });
  }

  /**
   * Returns if REPL terminal exists
   */
  get isOpen(): boolean {
    return this._terminal !== undefined;
  }

  /**
   * Opens REPL terminal for connected board
   */
  async open(port: string): Promise<void> {
    if (this._terminal !== undefined) {
      this._terminal.show(true);
      return;
    }

    const board = new MicroPython();
    await board.open(port);
    this._board = board;

    const writeEmitter = new vscode.EventEmitter<string>();
    this._writeEmitter = writeEmitter;

    // Forward incoming serial data to the pseudo-terminal
    this._dataHandler = (data: Buffer) => {
      writeEmitter.fire(data.toString());
    };

    // Switch serial to flowing mode so data events fire continuously
    board.serial.resume();
    board.serial.on("data", this._dataHandler);

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {
        board.serial.write(Buffer.from(ENTER_REPL));
      },
      close: () => {
        this.close();
      },
      handleInput: (data: string) => {
        if (board.serial?.isOpen) {
          board.serial.write(Buffer.from(data));
        }
      },
    };

    this._terminal = vscode.window.createTerminal({
      name: getReplTitle(port),
      pty,
      iconPath: new vscode.ThemeIcon("circuit-board"),
      color: new vscode.ThemeColor("terminal.ansiBrightBlue"),
    });
    this._terminal.show(true);
  }

  softReset(): void {
    if (this._board?.serial?.isOpen) {
      this._board.serial.write(Buffer.from(CTRL_C));
      setTimeout(() => {
        this._board?.serial?.write(Buffer.from(CTRL_D));
      }, 100);
    }
  }

  interrupt(): void {
    if (this._board?.serial?.isOpen) {
      this._board.serial.write(Buffer.from(CTRL_C));
    }
  }

  close(): void {
    this._disposeBoard();
    this._terminal?.dispose();
    this._terminal = undefined;
    this._writeEmitter?.dispose();
    this._writeEmitter = undefined;
  }

  private _disposeBoard(): void {
    if (this._board) {
      if (this._dataHandler) {
        this._board.serial?.removeListener("data", this._dataHandler);
        this._dataHandler = undefined;
      }
      this._board.close(); // async – fire and forget, port released shortly after
      this._board = undefined;
    }
  }

  dispose(): void {
    this._closeListener.dispose();
    this.close();
  }
}
