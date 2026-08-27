jest.mock("vscode", () => {
  return {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
      openTextDocument: jest.fn(),
      textDocuments: [],
    },

    window: {
      showTextDocument: jest.fn(),
      showInformationMessage: jest.fn(),
      showErrorMessage: jest.fn(),
      showWarningMessage: jest.fn(),
      setStatusBarMessage: jest.fn(() => ({ dispose: jest.fn() })),
      withProgress: jest
        .fn()
        .mockImplementation(
          (
            _opts: unknown,
            task: (
              progress: { report: (value: unknown) => void },
              token: { isCancellationRequested: boolean },
            ) => Promise<unknown>,
          ) => task({ report: jest.fn() }, { isCancellationRequested: false }),
        ),
      tabGroups: {
        all: [],
        close: jest.fn(),
      },
    },
    ProgressLocation: { Notification: 15 },

    Uri: {
      file: (p: string) => ({ fsPath: p, toString: () => p }),
      parse: (p: string) => ({ fsPath: p, toString: () => p }),
    },

    EventEmitter: jest.fn().mockImplementation(() => ({
      event: jest.fn(),
      fire: jest.fn(),
    })),

    ThemeColor: jest.fn(),
    Disposable: jest.fn().mockImplementation((fn) => ({ dispose: fn })),

    FileType: { File: 0 },

    FileSystemError: {
      NoPermissions: (msg: string) => new Error(msg),
    },

    TabInputText: function (this: any, uri: any) {
      this.uri = uri;
    },
  };
});

import * as vscode from "vscode";
import { BoardFileSystemProvider } from "../../../webview/handlers/BoardFileSystemProvider";
import { FOLDER_OPENED_BOARD_FILES } from "../../../types/constants";
import { TransferCancelledError } from "../../../device/operation/BoardFileOperations";

// ── Helpers ─────────────────────────────────────────────────────────────

const mockWorkspaceState = {
  get: jest.fn(),
  update: jest.fn(),
};

const mockContext = {
  workspaceState: mockWorkspaceState,
} as any;

const mockGetFileData = jest.fn();
const mockUploadFileOnRemotePath = jest.fn();

const mockDM = {
  getDevice: jest.fn().mockReturnValue({
    getFileData: mockGetFileData,
    uploadFileOnRemotePath: mockUploadFileOnRemotePath,
  }),
} as any;

function resetSingleton() {
  (BoardFileSystemProvider as any)._instance = undefined;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("BoardFileSystemProvider FULL", () => {
  let provider: BoardFileSystemProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();

    mockWorkspaceState.get.mockReturnValue([]);

    provider = BoardFileSystemProvider.instance(mockDM, mockContext);
  });

  // ── Singleton ─────────────────────────────────────────────────────────

  it("throws without first init", () => {
    resetSingleton();
    expect(() => BoardFileSystemProvider.instance()).toThrow();
  });

  it("returns same instance", () => {
    const second = BoardFileSystemProvider.instance();
    expect(second).toBe(provider);
  });

  // ── Path helpers ──────────────────────────────────────────────────────

  it("localUri works", () => {
    const uri = provider.localUri("/foo/bar.py");
    expect(uri?.fsPath).toContain(FOLDER_OPENED_BOARD_FILES);
  });

  it("remotePath works", () => {
    const uri = vscode.Uri.file(
      `/workspace/${FOLDER_OPENED_BOARD_FILES}/foo.py`,
    );
    expect(provider.remotePath(uri)).toBe("/foo.py");
  });

  it("remotePath returns undefined outside cache", () => {
    const uri = vscode.Uri.file("/workspace/test.py");
    expect(provider.remotePath(uri)).toBeUndefined();
  });

  // ── Decoration ────────────────────────────────────────────────────────

  it("returns decoration when connected", () => {
    provider.onReconnect();
    const uri = vscode.Uri.file(
      `/workspace/${FOLDER_OPENED_BOARD_FILES}/test.py`,
    );
    (provider as any)._boardFiles.add(uri.toString());

    const dec = provider.provideFileDecoration(uri);
    expect(dec?.badge).toBe("📥⏳");
  });

  it("returns disconnected decoration", () => {
    const uri = vscode.Uri.file(
      `/workspace/${FOLDER_OPENED_BOARD_FILES}/test.py`,
    );
    (provider as any)._boardFiles.add(uri.toString());

    provider.onDisconnect();

    const dec = provider.provideFileDecoration(uri);
    expect(dec?.badge).toBe("✕");
  });

  // ── onBoardFileClosed ─────────────────────────────────────────────────

  // ── Download ──────────────────────────────────────────────────────────

  it("download fails without workspace", async () => {
    (vscode.workspace as any).workspaceFolders = undefined;

    await provider.downloadAndOpen("COM3", "/test.py");

    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  // ── Upload ────────────────────────────────────────────────────────────

  it("uploads file", async () => {
    provider.onReconnect();
    const uri = vscode.Uri.file(
      `/workspace/${FOLDER_OPENED_BOARD_FILES}/test.py`,
    );

    (provider as any)._boardFiles.add(uri.toString());

    (vscode.workspace as any).textDocuments = [
      {
        uri,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn().mockReturnValue("content"),
      },
    ];

    mockUploadFileOnRemotePath.mockResolvedValue(undefined);

    await provider.uploadActiveFile(uri, "COM3");

    expect(mockUploadFileOnRemotePath).toHaveBeenCalledWith(
      "content",
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ isCancellationRequested: false }),
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it("shows an info message instead of an error when the upload was cancelled", async () => {
    provider.onReconnect();
    const uri = vscode.Uri.file(
      `/workspace/${FOLDER_OPENED_BOARD_FILES}/test.py`,
    );

    (provider as any)._boardFiles.add(uri.toString());

    (vscode.workspace as any).textDocuments = [
      {
        uri,
        isDirty: false,
        save: jest.fn(),
        getText: jest.fn().mockReturnValue("content"),
      },
    ];

    mockUploadFileOnRemotePath.mockRejectedValue(
      new TransferCancelledError("Upload cancelled"),
    );

    await provider.uploadActiveFile(uri, "COM3");

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Upload cancelled",
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it("upload blocked when disconnected", async () => {
    provider.onDisconnect();

    await provider.uploadActiveFile(
      vscode.Uri.file(`/workspace/${FOLDER_OPENED_BOARD_FILES}/test.py`),
      "COM3",
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it("upload blocked for non-board file", async () => {
    provider.onReconnect();

    await provider.uploadActiveFile(
      vscode.Uri.file("/workspace/test.py"),
      "COM3",
    );

    expect(vscode.window.showWarningMessage).toHaveBeenCalled();
  });

  // ── FileSystem stubs ──────────────────────────────────────────────────

  it("stat returns file", async () => {
    const stat = await provider.stat();
    expect(stat.type).toBe(0);
  });

  it("readDirectory throws", () => {
    expect(() => provider.readDirectory()).toThrow();
  });

  it("delete throws", () => {
    expect(() => provider.delete()).toThrow();
  });
});
