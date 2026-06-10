import * as vscode from "vscode";
import { SidebarProvider } from "./webview/SidebarProvider";
import { BoardFileSystemProvider } from "./webview/handlers/BoardFileSystemProvider";
import { ConnectionManager } from "./device/ConnectionManager";
import { VenvManager } from "./device/VenvManager";

async function ensurePythonExtension(): Promise<void> {
  if (vscode.extensions.getExtension("ms-python.python")) {
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing Python extension...",
      cancellable: false,
    },
    async () => {
      try {
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          "ms-python.python",
        );
        vscode.window.showInformationMessage(
          "Python extension installed successfully.",
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Python extension installation failed: ${(err as Error).message}`,
        );
      }
    },
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32" && arch === "arm64") {
    vscode.window
      .showErrorMessage(
        "MicroPython for Arduino requires the x64 version of Visual Studio Code on Windows. " +
          "ARM64 is not supported.",
        "Download VS Code x64",
      )
      .then((selection) => {
        if (selection === "Download VS Code x64") {
          vscode.env.openExternal(
            vscode.Uri.parse("https://code.visualstudio.com/download"),
          );
        }
      });
    return; // stop activation
  }
  ensurePythonExtension();

  const connectionManager = new ConnectionManager();

  const venvManager = new VenvManager(context.globalStorageUri.fsPath);
  venvManager
    .setup()
    .then(() => {
      connectionManager.mpremotePath = venvManager.mpremotePath;
      venvManager.checkForUpdate();
    })
    .catch(() => {
      // Keep default "mpremote" fallback
    });
  const boardFs = BoardFileSystemProvider.instance(connectionManager, context);
  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    connectionManager,
    context,
  );

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text =
    connectionManager.getCurrentPort() !== undefined
      ? `$(plug) ${connectionManager.getCurrentPort()}`
      : "$(circle-slash) Not connected";
  statusBar.show();

  context.subscriptions.push(
    connectionManager,
    connectionManager.onDidChangePort((port) => {
      statusBar.text =
        port !== undefined
          ? `$(plug) ${port}`
          : "$(circle-slash) Not connected";
    }),
    vscode.window.registerWebviewViewProvider(
      "micropython-arduino.sidebar",
      sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      BoardFileSystemProvider.SCHEME,
      boardFs,
      { isCaseSensitive: true, isReadonly: false },
    ),
    vscode.window.registerFileDecorationProvider(boardFs),
  );

  connectionManager.onDidChangePort((port) => {
    if (port === undefined) {
      boardFs.onDisconnect();
    } else {
      boardFs.onReconnect();
    }
  });

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const closed of e.closed) {
        if (
          closed.input instanceof vscode.TabInputText &&
          boardFs.isBoardFile(closed.input.uri)
        ) {
          boardFs.onBoardFileClosed(closed.input.uri);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mpyArduino.uploadToBoard", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const port = connectionManager.getCurrentPort();
      if (port) {
        await boardFs.uploadActiveFile(editor.document.uri, port);
      }
    }),
  );

  // Ctrl+S on a board-cache file → upload
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (!boardFs.isBoardFile(e.document.uri)) {
        return;
      }
      if (e.reason !== vscode.TextDocumentSaveReason.Manual) {
        return;
      }
      const port = connectionManager.getCurrentPort();
      if (port) {
        e.waitUntil(boardFs.uploadActiveFile(e.document.uri, port));
      }
    }),
  );
}

export function deactivate(): void {}
