import { WorkspaceFileHandler } from "../../../webview/handlers/WorkspaceFileHandler";

// ---- MOCK FS ----
jest.mock("fs", () => ({
  readdirSync: jest.fn(),
}));

// ---- MOCK VSCODE (FIXED: no hoisting issues) ----
jest.mock("vscode", () => {
  const showTextDocument = jest.fn();
  const showWarningMessage = jest.fn();
  const showErrorMessage = jest.fn();
  const showInputBox = jest.fn();
  const showInformationMessage = jest.fn();

  const mockDelete = jest.fn();
  const mockRename = jest.fn();
  const mockWriteFile = jest.fn();
  const mockCreateDirectory = jest.fn();
  const mockStat = jest.fn();
  const closeTabs = jest.fn();

  return {
    Uri: {
      file: (p: string) => ({ fsPath: p }),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: "/root" } }],
      fs: {
        delete: mockDelete,
        rename: mockRename,
        writeFile: mockWriteFile,
        createDirectory: mockCreateDirectory,
        stat: mockStat,
      },
    },
    window: {
      showTextDocument,
      showWarningMessage,
      showErrorMessage,
      showInputBox,
      showInformationMessage,
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
        close: closeTabs,
      },
    },
    ProgressLocation: { Notification: 15 },
    TabInputText: class {},

    // expose mocks for tests
    __mocks__: {
      showTextDocument,
      showWarningMessage,
      showErrorMessage,
      showInputBox,
      showInformationMessage,
      mockDelete,
      mockRename,
      mockWriteFile,
      mockCreateDirectory,
      mockStat,
      closeTabs,
    },
  };
});

describe("WorkspaceFileHandler", () => {
  let handler: WorkspaceFileHandler;
  let send: jest.Mock;
  let vscode: any;
  let mocks: any;

  beforeEach(() => {
    const mockCM = {
      getDevice: jest.fn().mockReturnValue({
        uploadFile: jest.fn().mockResolvedValue(undefined),
      }),
    } as any;
    handler = new WorkspaceFileHandler(mockCM);
    send = jest.fn();

    vscode = require("vscode");
    mocks = vscode.__mocks__;

    jest.clearAllMocks();
  });

  // -------------------------------
  // getWorkspaceFiles
  // -------------------------------
  it("returns empty if no workspace", async () => {
    vscode.workspace.workspaceFolders = undefined;

    await handler.handleGetWorkspaceFiles(send);

    expect(send).toHaveBeenCalledWith({
      type: "workspaceFiles",
      nodes: [],
    });
  });

  // -------------------------------
  // open file
  // -------------------------------
  it("opens file", async () => {
    await handler.handleOpenFile("/file.txt");

    expect(mocks.showTextDocument).toHaveBeenCalled();
  });

  it("opens file pinned", async () => {
    await handler.handleOpenFilePinned("/file.txt");

    expect(mocks.showTextDocument).toHaveBeenCalledWith(expect.anything(), {
      preview: false,
    });
  });

  // -------------------------------
  // delete
  // -------------------------------
  it("deletes file when confirmed", async () => {
    mocks.showWarningMessage.mockResolvedValue("Delete");

    await handler.handleDeleteFile("/file.txt");

    expect(mocks.mockDelete).toHaveBeenCalled();
  });

  it("does nothing if delete cancelled", async () => {
    mocks.showWarningMessage.mockResolvedValue(undefined);

    await handler.handleDeleteFile("/file.txt");

    expect(mocks.mockDelete).not.toHaveBeenCalled();
  });

  // -------------------------------
  // rename
  // -------------------------------
  it("renames file successfully", async () => {
    mocks.showInputBox.mockResolvedValue("new.txt");
    mocks.mockStat.mockRejectedValue(new Error("not exists"));

    await handler.handleRenameFile("/old.txt", false);

    expect(mocks.mockRename).toHaveBeenCalled();
  });

  it("prevents rename if file exists", async () => {
    mocks.showInputBox.mockResolvedValue("new.txt");
    mocks.mockStat.mockResolvedValue(true);

    await handler.handleRenameFile("/old.txt", false);

    expect(mocks.showErrorMessage).toHaveBeenCalled();
    expect(mocks.mockRename).not.toHaveBeenCalled();
  });

  // -------------------------------
  // create file
  // -------------------------------
  it("creates file", async () => {
    mocks.showInputBox.mockResolvedValue("file.py");
    mocks.mockStat.mockRejectedValue(new Error("not exists"));

    await handler.handleCreateFile("/root");

    expect(mocks.mockWriteFile).toHaveBeenCalled();
    expect(mocks.showTextDocument).toHaveBeenCalled();
  });

  // -------------------------------
  // create folder
  // -------------------------------
  it("creates folder", async () => {
    mocks.showInputBox.mockResolvedValue("folder");
    mocks.mockStat.mockRejectedValue(new Error("not exists"));

    await handler.handleCreateFolder("/root");

    expect(mocks.mockCreateDirectory).toHaveBeenCalled();
  });

  // -------------------------------
  // upload
  // -------------------------------
  it("uploads file successfully", async () => {
    const uploadFile = jest.fn().mockResolvedValue("/parent/path");

    const mockCM = {
      getDevice: jest.fn().mockReturnValue({
        uploadFile,
      }),
    } as any;

    handler = new WorkspaceFileHandler(mockCM);

    await handler.handleUploadFile("/file.txt", "COM3", send);

    // ensure upload was called correctly, with a progress callback and
    // cancellation token forwarded from withProgress
    expect(uploadFile).toHaveBeenCalledWith(
      "/file.txt",
      "file.txt",
      expect.any(Function),
      expect.objectContaining({ isCancellationRequested: false }),
    );

    // ensure withProgress executed upload, cancellably
    expect(vscode.window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ cancellable: true }),
      expect.any(Function),
    );

    // ensure success message
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      "Upload successful",
    );

    // ensure event sent
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bf_nodeCreated",
        parentId: "/parent/path",
        node: expect.objectContaining({
          id: "/parent/path/file.txt",
          name: "file.txt",
          type: "file",
        }),
        port: "COM3",
      }),
    );
  });

  it("does NOT send event if upload returns no parentPath", async () => {
    const uploadFile = jest.fn().mockResolvedValue(undefined);

    const mockCM = {
      getDevice: jest.fn().mockReturnValue({
        uploadFile,
      }),
    } as any;

    handler = new WorkspaceFileHandler(mockCM);

    await handler.handleUploadFile("/file.txt", "COM3", send);

    expect(uploadFile).toHaveBeenCalled();

    expect(send).not.toHaveBeenCalled();
  });

  it("handles upload failure", async () => {
    const uploadFile = jest.fn().mockRejectedValue(new Error("fail"));

    const mockCM = {
      getDevice: jest.fn().mockReturnValue({
        uploadFile,
      }),
    } as any;

    handler = new WorkspaceFileHandler(mockCM);

    await handler.handleUploadFile("/file.txt", "COM3", send);

    expect(mocks.showErrorMessage).toHaveBeenCalledWith("Upload failed: fail");
  });

  it("shows an info message instead of an error when the upload was cancelled", async () => {
    const uploadFile = jest
      .fn()
      .mockRejectedValue(new Error("Upload cancelled"));

    const mockCM = {
      getDevice: jest.fn().mockReturnValue({
        uploadFile,
      }),
    } as any;

    handler = new WorkspaceFileHandler(mockCM);

    await handler.handleUploadFile("/file.txt", "COM3", send);

    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      "Upload cancelled",
    );
    expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  });

  // ── buildWorkspaceTree (via handleGetWorkspaceFiles) ────────────────────────

  describe("handleGetWorkspaceFiles (tree building)", () => {
    function makeDirent(name: string, isDir: boolean) {
      return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      };
    }

    let readdirSync: jest.Mock;

    beforeEach(() => {
      const fsMock = require("fs");
      readdirSync = fsMock.readdirSync as jest.Mock;
      vscode.workspace.workspaceFolders = [{ uri: { fsPath: "/ws" } }];
    });

    it("sends a single root node with the workspace folder name", async () => {
      readdirSync.mockReturnValue([]);

      await handler.handleGetWorkspaceFiles(send);

      const msg = (send as jest.Mock).mock.calls[0][0];
      expect(msg.nodes).toHaveLength(1);
      expect(msg.nodes[0]).toMatchObject({
        name: "ws",
        type: "folder",
        root: true,
      });
    });

    it("filters out ignored directories (node_modules, __pycache__, dist, out)", async () => {
      readdirSync.mockReturnValue([
        makeDirent("node_modules", true),
        makeDirent("__pycache__", true),
        makeDirent("dist", true),
        makeDirent("out", true),
        makeDirent("main.py", false),
      ]);

      await handler.handleGetWorkspaceFiles(send);

      const children = (send as jest.Mock).mock.calls[0][0].nodes[0]
        .children as any[];
      const names = children.map((c: any) => c.name);
      expect(names).toEqual(["main.py"]);
    });

    it("filters out hidden directories (leading dot)", async () => {
      readdirSync.mockReturnValue([
        makeDirent(".git", true),
        makeDirent(".github", true),
        makeDirent(".vscode", true),
        makeDirent(".board_cache", true),
        makeDirent(".mpy_codesupport", true),
        makeDirent("main.py", false),
      ]);

      await handler.handleGetWorkspaceFiles(send);

      const children = (send as jest.Mock).mock.calls[0][0].nodes[0]
        .children as any[];
      expect(children.map((c: any) => c.name)).toEqual(["main.py"]);
    });

    it("filters out hidden files (leading dot)", async () => {
      readdirSync.mockReturnValue([
        makeDirent(".DS_Store", false),
        makeDirent(".gitignore", false),
        makeDirent(".mpy_run.py", false),
        makeDirent("main.py", false),
      ]);

      await handler.handleGetWorkspaceFiles(send);

      const children = (send as jest.Mock).mock.calls[0][0].nodes[0]
        .children as any[];
      expect(children.map((c: any) => c.name)).toEqual(["main.py"]);
    });

    it("sorts folders before files and each group alphabetically", async () => {
      readdirSync
        .mockReturnValueOnce([
          makeDirent("z.py", false),
          makeDirent("lib", true),
          makeDirent("a.py", false),
          makeDirent("boot", true),
        ])
        .mockReturnValue([]); // any sub-folder calls return empty

      await handler.handleGetWorkspaceFiles(send);

      const children = (send as jest.Mock).mock.calls[0][0].nodes[0]
        .children as any[];
      expect(children.map((c: any) => c.name)).toEqual([
        "boot",
        "lib",
        "a.py",
        "z.py",
      ]);
    });

    it("builds a recursive tree for nested directories", async () => {
      readdirSync
        .mockReturnValueOnce([makeDirent("lib", true)])
        .mockReturnValueOnce([makeDirent("sensor.py", false)]);

      await handler.handleGetWorkspaceFiles(send);

      const root = (send as jest.Mock).mock.calls[0][0].nodes[0];
      expect(root.children[0].name).toBe("lib");
      expect(root.children[0].children[0].name).toBe("sensor.py");
    });
  });
});
