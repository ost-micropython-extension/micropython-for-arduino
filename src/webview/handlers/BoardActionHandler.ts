import * as vscode from "vscode";
import * as path from "path";
import { WebviewMessage } from "../../types/messages";
import { Sender } from "../WebviewGateway";
import { ConnectionManager } from "../../device/ConnectionManager";

export class BoardActionHandler {
  constructor(private readonly _connectionManager: ConnectionManager) {}

  /**
   * Loads all available serial ports.
   */
  async handleGetPorts(_msg: WebviewMessage, send: Sender): Promise<void> {
    try {
      const ports = await this._connectionManager.getPorts();
      send({ type: "ports", value: ports });
    } catch (err) {
      send({ type: "ports", value: [] });
      vscode.window.showErrorMessage(
        `Failed to load ports: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Opens a REPL connection for the selected board.
   */
  async handleConnectRepl(port: string): Promise<void> {
    try {
      await this._connectionManager.getDevice(port).openRepl();
    } catch (err) {
      vscode.window.showErrorMessage((err as Error).message);
    }
  }

  /**
   * Runs the currently opened Python file on the board.
   */
  async handleRunFile(port: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("Run current file: No file open.");
      return;
    }

    const uri = editor.document.uri;
    const filePath = uri.fsPath;
    const fileName = path.basename(filePath);

    if (editor.document.isUntitled) {
      try {
        await this._connectionManager
          .getDevice(port)
          .runCode(editor.document.getText(), filePath);
      } catch (err) {
        vscode.window.showErrorMessage((err as Error).message);
      }
      return;
    }

    if (!filePath.endsWith(".py")) {
      vscode.window.showWarningMessage(
        "Run current file: Only Python files (.py) can be executed.",
      );
      return;
    }

    try {
      const device = this._connectionManager.getDevice(port);
      if (device.mountActive) {
        if (editor.document.isDirty) {
          await editor.document.save();
        }
        await device.runFileWhileMount(filePath, editor.document.getText());
      } else {
        await device.runCode(editor.document.getText(), fileName);
      }
    } catch (err) {
      vscode.window.showErrorMessage((err as Error).message);
    }
  }

  /**
   * Runs the selected Python code on the board.
   */
  async handleRunSelection(port: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("Run Selection: No file open.");
      return;
    }
    const selection = editor.selection;
    const code = editor.document.getText(selection);
    if (!code.trim()) {
      vscode.window.showWarningMessage("Run Selection: No code selected.");
      return;
    }

    try {
      const fixedCode = fixIndentation(code, editor, selection);
      const device = this._connectionManager.getDevice(port);
      await device.runCode(fixedCode);
    } catch (err) {
      vscode.window.showErrorMessage((err as Error).message);
    }
  }

  /**
   * Stops the currently running board program.
   */
  handleStopRunning(port: string): void {
    this._connectionManager.getDevice(port).stopExecution();
  }

  /**
   * Performs a soft reset on the board.
   */
  async handleSoftReset(port: string): Promise<void> {
    this._connectionManager.getDevice(port).softReset();
  }
}

/**
 * Removes shared indentation from selected code.
 */
function fixIndentation(
  code: string,
  editor: vscode.TextEditor,
  selection: vscode.Selection,
): string {
  const lines = code.split("\n");

  const firstFullLine = editor.document.lineAt(selection.start.line).text;
  const baseIndentMatch = firstFullLine.match(/^(\s+)/);
  if (!baseIndentMatch) {
    return code;
  }

  const baseIndent = baseIndentMatch[1];

  return lines
    .map((line, i) => {
      if (line.trim().length === 0) {
        return line;
      }

      if (i === 0) {
        return line.startsWith(baseIndent)
          ? line.slice(baseIndent.length)
          : line;
      }

      if (!line.startsWith(baseIndent)) {
        throw new Error(
          `Run Selection: Inconsistent indentation — line "${line.trimEnd()}" has less indentation than the first selected line.`,
        );
      }
      return line.slice(baseIndent.length);
    })
    .join("\n");
}
