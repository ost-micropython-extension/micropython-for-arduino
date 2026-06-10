import * as fs from "fs";
import * as vscode from "vscode";
import { BoardActionHandler } from "./handlers/BoardActionHandler";
import { LibraryManifest, WebviewMessage } from "../types/messages";
import { WebviewGateway } from "./WebviewGateway";
import { WorkspaceFileHandler } from "./handlers/WorkspaceFileHandler";
import { BoardFileHandler } from "./handlers/BoardFileHandler";
import { StubHandler } from "./handlers/StubHandler";
import { LibraryHandler } from "./handlers/LibraryHandler";
import { MountHandler } from "./handlers/MountHandler";
import { ConnectionManager } from "../device/ConnectionManager";
import { CodeSupportHandler } from "./handlers/CodeSupportHandler";

/**
 * Provides the MicroPython sidebar webview panel.
 *
 * Implements {@link vscode.WebviewViewProvider} so that VS Code can create
 * and restore the view. On creation the provider wires every webview message
 * type to the appropriate domain handler via a {@link WebviewGateway}.
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
  /**
   * @param _extensionUri - Root URI of the extension, used to resolve local
   *   media resources.
   * @param _connectionManager - Manages open device connections and port
   *   lifecycle events.
   * @param _context - Extension context used for persistent global state
   *   (e.g. expanded tree-node sets).
   */
  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _connectionManager: ConnectionManager,
    private readonly _context: vscode.ExtensionContext,
  ) {}

  /**
   * Called by VS Code when the webview view is first shown or restored.
   *
   * Responsibilities:
   * - Configures webview options and injects the sidebar HTML.
   * - Instantiates all domain handlers and a {@link WebviewGateway}.
   * - Registers gateway handlers for every supported message type.
   * - Subscribes to VS Code editor, port, and device state change events.
   *
   * @param webviewView - The view instance provided by VS Code.
   */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtml(webviewView.webview);

    const gateway = new WebviewGateway(webviewView);
    const boardActionHandler = new BoardActionHandler(this._connectionManager);
    const wsFileHandler = new WorkspaceFileHandler(this._connectionManager);
    const boardFileHandler = new BoardFileHandler(this._connectionManager);
    const codeSupportHandler = new CodeSupportHandler();
    const stubHandler = new StubHandler(
      this._connectionManager,
      codeSupportHandler,
    );
    const libraryHandler = new LibraryHandler(
      this._connectionManager,
      codeSupportHandler,
      (port: string, manifest: LibraryManifest) =>
        stubHandler.generateLibraryCodeSupport(port, manifest),
    );
    const mountHandler = new MountHandler(
      this._connectionManager,
      this._context,
    );

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) {
        return;
      }
      gateway.send({
        type: "activeFileChanged",
        path: editor.document.uri.fsPath,
      });
    });

    this._connectionManager.setOnStateChanged((port, state) => {
      gateway.send({ type: "boardState", port, value: state });
    });

    this._connectionManager.startWatching((ports) =>
      gateway.send({ type: "ports", value: ports }),
    );

    gateway.register("initialize", async (_msg, send) => {
      const ports = await this._connectionManager.getPorts();
      send({
        type: "init",
        value: {
          expandedWSNodes: [
            ...(this._context.globalState.get<Map<string, boolean>>(
              "expandedWSNodes",
            ) || new Map()),
          ],
          expandedBFNodes: [
            ...(this._context.globalState.get<Map<string, boolean>>(
              "expandedBFNodes",
            ) || new Map()),
          ],
          ports,
        },
      });

      codeSupportHandler.updateCodeSupport(send, []);

      await libraryHandler.handleGetLibraries(send);
    });

    gateway.register("setExpanded_workspace", (msg) => {
      this._context.globalState.update("expandedWSNodes", [...msg.value]);
    });
    gateway.register("setExpanded_boardfiles", (msg) => {
      this._context.globalState.update("expandedBFNodes", [...msg.value]);
    });

    // Connection
    gateway.register("getPorts", (msg, send) =>
      boardActionHandler.handleGetPorts(msg, send),
    );
    gateway.register("openPort", (msg) =>
      this._connectionManager.open(msg.port),
    );
    gateway.register("closePort", (msg) =>
      this._connectionManager.close(msg.port),
    );
    gateway.register("setCurrent", (msg) =>
      this._connectionManager.setCurrent(msg.port),
    );

    // REPL
    gateway.register("connect", (msg) =>
      boardActionHandler.handleConnectRepl(msg.port),
    );

    // Board actions
    gateway.register("runFile", (msg) =>
      boardActionHandler.handleRunFile(msg.port),
    );
    gateway.register("runSelection", (msg) =>
      boardActionHandler.handleRunSelection(msg.port),
    );
    gateway.register("stopFile", (msg) =>
      boardActionHandler.handleStopRunning(msg.port),
    );
    gateway.register("softReset", (msg) =>
      boardActionHandler.handleSoftReset(msg.port),
    );

    // Workspace actions
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    watcher.onDidCreate(() => {
      void wsFileHandler.handleGetWorkspaceFiles(gateway.send.bind(gateway));
    });
    watcher.onDidDelete(() => {
      void wsFileHandler.handleGetWorkspaceFiles(gateway.send.bind(gateway));
    });
    watcher.onDidChange(() => {
      void wsFileHandler.handleGetWorkspaceFiles(gateway.send.bind(gateway));
    });
    this._context.subscriptions.push(watcher);

    gateway.register("getWorkspaceFiles", (_msg, send) =>
      wsFileHandler.handleGetWorkspaceFiles(send),
    );
    gateway.register("ws_openFile", (msg) =>
      wsFileHandler.handleOpenFile(msg.path),
    );
    gateway.register("ws_openFilePinned", (msg) =>
      wsFileHandler.handleOpenFilePinned(msg.path),
    );
    gateway.register("ws_delete", (msg) =>
      wsFileHandler.handleDeleteFile(msg.path),
    );
    gateway.register("ws_rename", (msg) =>
      wsFileHandler.handleRenameFile(msg.path, msg.isFolder),
    );
    gateway.register("ws_createFile", (msg) =>
      wsFileHandler.handleCreateFile(msg.folderPath),
    );
    gateway.register("ws_createFolder", (msg) =>
      wsFileHandler.handleCreateFolder(msg.folderPath),
    );
    gateway.register("ws_uploadFile", (msg, send) => {
      if (this._connectionManager.getDevice(msg.port).mountActive) {
        vscode.window.showWarningMessage(
          "MicroPython: Upload not available during active mount.",
        );
        return;
      }
      return wsFileHandler.handleUploadFile(msg.path, msg.port, send);
    });
    gateway.register("ws_move", (msg) =>
      wsFileHandler.handleMove(msg.nodePath, msg.targetPath),
    );

    // Board file actions
    gateway.register("getBoardFiles", (msg, send) =>
      boardFileHandler.handleGetBoardFiles(msg.port, send),
    );
    gateway.register("bf_openFile", async (msg) => {
      await boardFileHandler.handleOpenFile(msg.path);
    });
    gateway.register("bf_openFilePinned", (msg) =>
      boardFileHandler.handleOpenFilePinned(msg.path, msg.port),
    );
    gateway.register("bf_delete", (msg, send) =>
      boardFileHandler.handleDelete(msg.path, msg.isFolder, msg.port, send),
    );
    gateway.register("bf_rename", (msg, send) =>
      boardFileHandler.handleRenameFile(msg.path, msg.isFolder, msg.port, send),
    );
    gateway.register("bf_createFile", (msg, send) =>
      boardFileHandler.handleCreateFile(msg.folderPath, msg.port, send),
    );
    gateway.register("bf_createFolder", (msg, send) =>
      boardFileHandler.handleCreateFolder(msg.folderPath, msg.port, send),
    );
    gateway.register("bf_downloadFile", (msg) =>
      boardFileHandler.handleDownloadFile(msg.path, msg.port),
    );
    gateway.register("bf_runFile", (msg) =>
      boardFileHandler.handleRunFile(msg.path, msg.port),
    );
    gateway.register("bf_move", (msg, send) => {
      if (this._connectionManager.getDevice(msg.port).mountActive) {
        vscode.window.showWarningMessage(
          "MicroPython: Move not available during active mount.",
        );
        return;
      }
      return boardFileHandler.handleMove(
        msg.nodePath,
        msg.targetPath,
        msg.port,
        send,
      );
    });

    // Mount
    gateway.register("toggleMount", (msg) =>
      mountHandler.handleToggle(msg.port),
    );

    // Stubs
    gateway.register("generateLibraryStubs", (msg, send) =>
      stubHandler.handleGenerateLibraryStubs(msg.port, send),
    );
    gateway.register("activateCodeSupport", (msg) =>
      codeSupportHandler.handleActivate(msg.name),
    );
    gateway.register("deactivateCodeSupport", (msg) =>
      codeSupportHandler.handleDeactivate(msg.name),
    );
    gateway.register("updateCodeSupport", (msg, send) =>
      codeSupportHandler.updateCodeSupport(send, msg.libs),
    );

    // Libraries
    gateway.register("getLibraries", (_msg, send) =>
      libraryHandler.handleGetLibraries(send),
    );
    gateway.register("getInstalledLibraries", (msg, send) =>
      libraryHandler.handleGetInstalledLibraries(msg.port, send),
    );
    gateway.register("installLibrary", (msg, send) =>
      libraryHandler.handleInstallLibrary(msg.name, msg.url, msg.port, send),
    );
    gateway.register("uninstallLibrary", (msg, send) =>
      libraryHandler.handleUninstallLibrary(
        msg.id,
        msg.displayName,
        msg.port,
        send,
      ),
    );

    webviewView.webview.onDidReceiveMessage((data: WebviewMessage) => {
      gateway.dispatch(data);
    });

    this._connectionManager.onDidChangePort((port) => {
      if (port === undefined) {
        return;
      }
      const device = this._connectionManager.getDeviceForPort(port);
      if (device?.stubPackage) {
        const boardSlug = device.boardName
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "");
        stubHandler.autoInstallBoardStubs(device.stubPackage, boardSlug);
      }
    });
  }

  /**
   * Reads the sidebar HTML template from disk and replaces all resource
   * placeholders with Content Security Policy-safe webview URIs.
   *
   * @param webview - The webview whose `asWebviewUri` method is used to
   *   convert extension-local paths to safe URIs.
   * @returns The fully resolved HTML string ready to assign to
   *   `webview.html`.
   */
  private _getHtml(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(
      this._extensionUri,
      "media",
      "sidebar",
      "sidebar.html",
    );
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    const res = (relPath: string[]) =>
      webview
        .asWebviewUri(vscode.Uri.joinPath(this._extensionUri, ...relPath))
        .toString();

    const resources: Record<string, string> = {
      "theme.css": res(["media", "theme.css"]),
      "sidebar.css": res(["media", "sidebar", "sidebar.css"]),
      "sidebar.js": res(["media", "sidebar", "sidebar.js"]),
    };

    for (const [placeholder, uri] of Object.entries(resources)) {
      html = html.replaceAll(placeholder, uri);
    }

    return html;
  }
}
