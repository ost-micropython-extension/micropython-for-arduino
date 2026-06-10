import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { BoardFileHandler } from "../../../webview/handlers/BoardFileHandler";

jest.mock("../../../webview/handlers/BoardFileSystemProvider", () => ({
  BoardFileSystemProvider: {
    instance: jest.fn().mockReturnValue({
      localUri: jest.fn().mockReturnValue(undefined),
      downloadAndOpen: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const PORT = "COM3";

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    fetchFiles: jest.fn().mockResolvedValue([]),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    renameFile: jest.fn().mockResolvedValue(undefined),
    createFile: jest.fn().mockResolvedValue(undefined),
    createFolder: jest.fn().mockResolvedValue(undefined),
    getFileData: jest.fn().mockResolvedValue(new Uint8Array([65, 66, 67])),
    mountActive: false,
    runBoardfile: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeConnectionManager(deviceOverrides: Record<string, unknown> = {}) {
  const device = makeDevice(deviceOverrides);
  return {
    _device: device,
    getDevice: jest.fn().mockReturnValue(device),
  } as any;
}

function makeSend() {
  return jest.fn();
}

// ── Tests ───────────────────────────────────────────────────────────────────
describe("BoardFileHandler", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── handleGetBoardFiles ──────────────────────────────────────────────────
  describe("handleGetBoardFiles", () => {
    it("does nothing when port is empty", async () => {
      const cm = makeConnectionManager();
      const send = makeSend();

      await new BoardFileHandler(cm).handleGetBoardFiles("", send);

      expect(send).not.toHaveBeenCalled();
    });

    it("sends file nodes returned by fetchFiles", async () => {
      const nodes = [{ id: "/main.py", name: "main.py", type: "file" }];
      const cm = makeConnectionManager({
        fetchFiles: jest.fn().mockResolvedValue(nodes),
      });
      const send = makeSend();

      await new BoardFileHandler(cm).handleGetBoardFiles(PORT, send);

      expect(send).toHaveBeenCalledWith({
        type: "boardFiles",
        port: PORT,
        nodes,
      });
    });

    it("sends error when fetchFiles throws", async () => {
      const cm = makeConnectionManager({
        fetchFiles: jest.fn().mockRejectedValue(new Error("boom")),
      });
      const send = makeSend();

      await new BoardFileHandler(cm).handleGetBoardFiles(PORT, send);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "boardFiles",
          port: PORT,
          error: "boom",
        }),
      );
    });
  });

  // ── handleDelete ─────────────────────────────────────────────────────────
  describe("handleDelete", () => {
    it("does nothing if user cancels confirmation", async () => {
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
        undefined,
      );
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleDelete(
        "/main.py",
        false,
        PORT,
        makeSend(),
      );

      expect(cm._device.deleteFile).not.toHaveBeenCalled();
    });

    it("calls deleteFile for a file and sends nodeDeleted", async () => {
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
        "Delete",
      );
      const cm = makeConnectionManager();
      const send = makeSend();

      await new BoardFileHandler(cm).handleDelete(
        "/main.py",
        false,
        PORT,
        send,
      );

      expect(cm._device.deleteFile).toHaveBeenCalledWith(false, "/main.py");
      expect(send).toHaveBeenCalledWith({
        type: "bf_nodeDeleted",
        nodeId: "/main.py",
        port: PORT,
      });
    });

    it("calls deleteFile for a folder and sends nodeDeleted", async () => {
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
        "Delete",
      );
      const cm = makeConnectionManager();
      const send = makeSend();

      await new BoardFileHandler(cm).handleDelete("/lib", true, PORT, send);

      expect(cm._device.deleteFile).toHaveBeenCalledWith(true, "/lib");
      expect(send).toHaveBeenCalledWith({
        type: "bf_nodeDeleted",
        nodeId: "/lib",
        port: PORT,
      });
    });

    it("shows error message on failure", async () => {
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
        "Delete",
      );
      const cm = makeConnectionManager({
        deleteFile: jest.fn().mockRejectedValue(new Error("denied")),
      });

      await new BoardFileHandler(cm).handleDelete(
        "/main.py",
        false,
        PORT,
        makeSend(),
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("denied"),
      );
    });
  });

  // ── handleRenameFile ─────────────────────────────────────────────────────
  describe("handleRenameFile", () => {
    it("does nothing if input box is cancelled", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleRenameFile(
        "/main.py",
        false,
        PORT,
        makeSend(),
      );

      expect(cm._device.renameFile).not.toHaveBeenCalled();
    });

    it("does nothing if new name equals old name", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("main.py");
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleRenameFile(
        "/main.py",
        false,
        PORT,
        makeSend(),
      );

      expect(cm._device.renameFile).not.toHaveBeenCalled();
    });

    it("calls renameFile and sends nodeRenamed", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("renamed.py");
      const cm = makeConnectionManager();
      const send = makeSend();

      await new BoardFileHandler(cm).handleRenameFile(
        "/main.py",
        false,
        PORT,
        send,
      );

      expect(cm._device.renameFile).toHaveBeenCalledWith(
        "renamed.py",
        "/",
        "/main.py",
        "/renamed.py",
      );
      expect(send).toHaveBeenCalledWith({
        type: "bf_nodeRenamed",
        newId: "/renamed.py",
        newName: "renamed.py",
        nodeId: "/main.py",
        port: PORT,
      });
    });

    it("warns on extension change and aborts if user cancels", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("main.txt");
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
        "Cancel",
      );
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleRenameFile(
        "/main.py",
        false,
        PORT,
        makeSend(),
      );

      expect(cm._device.renameFile).not.toHaveBeenCalled();
    });

    it("shows error when renameFile throws", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("renamed.py");
      const cm = makeConnectionManager({
        renameFile: jest.fn().mockRejectedValue(new Error("already exists")),
      });

      await new BoardFileHandler(cm).handleRenameFile(
        "/main.py",
        false,
        PORT,
        makeSend(),
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      );
    });
  });

  // ── handleCreateFile ─────────────────────────────────────────────────────
  describe("handleCreateFile", () => {
    it("does nothing if input is cancelled", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleCreateFile("/", PORT, makeSend());

      expect(cm._device.createFile).not.toHaveBeenCalled();
    });

    it("calls createFile and sends nodeCreated", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("new.py");
      const cm = makeConnectionManager();
      const send = makeSend();

      await new BoardFileHandler(cm).handleCreateFile("/", PORT, send);

      expect(cm._device.createFile).toHaveBeenCalledWith(
        "new.py",
        "/",
        "/new.py",
      );
      expect(send).toHaveBeenCalledWith({
        type: "bf_nodeCreated",
        node: {
          id: "/new.py",
          meta: { size: 1 },
          name: "new.py",
          type: "file",
        },
        parentId: "/",
        select: true,
        port: PORT,
      });
    });

    it("creates file in subfolder with correct path", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("util.py");
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleCreateFile("/lib", PORT, makeSend());

      expect(cm._device.createFile).toHaveBeenCalledWith(
        "util.py",
        "/lib",
        "/lib/util.py",
      );
    });

    it("shows error when createFile throws", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("main.py");
      const cm = makeConnectionManager({
        createFile: jest.fn().mockRejectedValue(new Error("already exists")),
      });

      await new BoardFileHandler(cm).handleCreateFile("/", PORT, makeSend());

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      );
    });
  });

  // ── handleCreateFolder ───────────────────────────────────────────────────
  describe("handleCreateFolder", () => {
    it("does nothing if input is cancelled", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleCreateFolder("/", PORT, makeSend());

      expect(cm._device.createFolder).not.toHaveBeenCalled();
    });

    it("calls createFolder and sends nodeCreated", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("lib");
      const cm = makeConnectionManager();
      const send = makeSend();

      await new BoardFileHandler(cm).handleCreateFolder("/", PORT, send);

      expect(cm._device.createFolder).toHaveBeenCalledWith("lib", "/", "/lib");
      expect(send).toHaveBeenCalledWith({
        type: "bf_nodeCreated",
        node: { children: [], id: "/lib", name: "lib", type: "folder" },
        parentId: "/",
        select: true,
        port: PORT,
      });
    });

    it("shows error when createFolder throws", async () => {
      (vscode.window.showInputBox as jest.Mock).mockResolvedValue("lib");
      const cm = makeConnectionManager({
        createFolder: jest.fn().mockRejectedValue(new Error("already exists")),
      });

      await new BoardFileHandler(cm).handleCreateFolder("/", PORT, makeSend());

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
      );
    });
  });

  // ── handleDownloadFile ───────────────────────────────────────────────────
  describe("handleDownloadFile", () => {
    beforeEach(() => {
      (vscode.workspace as any).workspaceFolders = [
        { uri: { fsPath: "/workspace" } },
      ];

      (vscode.workspace as any).fs = {
        writeFile: jest.fn().mockResolvedValue(undefined),
      };

      // IMPORTANT: quick pick selects first folder (root)
      (vscode.window.showQuickPick as jest.Mock).mockImplementation(
        async (items: any[]) => items[0],
      );

      // folder scanning
      jest.spyOn(fs, "readdirSync").mockReturnValue([] as any);

      // file does not exist by default
      jest.spyOn(fs, "existsSync").mockReturnValue(false);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("calls getFileData and writes to workspace", async () => {
      const cm = makeConnectionManager();

      await new BoardFileHandler(cm).handleDownloadFile("/main.py", PORT);

      expect(cm._device.getFileData).toHaveBeenCalledWith("/main.py");

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
    });
  });
});
