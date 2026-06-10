import * as vscode from "vscode";
import { RunFileOperation } from "../../../../device/operation/RunFileOperation";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBoard() {
  return {
    run: jest.fn().mockResolvedValue("OK\x04\x04>"),
  };
}

function makeDevice(board: ReturnType<typeof makeBoard>) {
  return {
    stateManager: { set: jest.fn() },
    connectedPort: "COM3",
    mountManager: { isActive: false as boolean, sendFile: jest.fn() },
    withBoard: jest
      .fn()
      .mockImplementation(async (cb: (b: typeof board) => unknown) =>
        cb(board),
      ),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RunFileOperation.executeMountedFile()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: "/workspace" } },
    ];
  });

  it("does nothing when mount is not active", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await RunFileOperation.executeMountedFile(
      device as any,
      "/workspace/main.py",
      'print("test")',
    );

    expect(device.mountManager.sendFile).not.toHaveBeenCalled();
  });

  it("sends the file name as a relative path to sendFile", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    device.mountManager.isActive = true;

    await RunFileOperation.executeMountedFile(
      device as any,
      "/workspace/main.py",
      'print("test")',
    );

    expect(device.mountManager.sendFile).toHaveBeenCalledWith(
      "/workspace/main.py",
      'print("test")',
    );
  });

  it("normalises backslashes to forward slashes in the relative path", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    device.mountManager.isActive = true;

    // sub-directory — on Windows path.relative produces backslashes
    await RunFileOperation.executeMountedFile(
      device as any,
      "/workspace/lib/sensor.py",
      'print("test")',
    );

    const sentPath = (device.mountManager.sendFile as jest.Mock).mock
      .calls[0][0] as string;
    expect(sentPath).not.toContain("\\");
    expect(sentPath).toBe("/workspace/lib/sensor.py");
  });
});

describe("RunFileOperation.executeBoardfile()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls withBoard", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await RunFileOperation.executeBoardfile(device as any, "/main.py");

    expect(device.withBoard).toHaveBeenCalled();
  });

  it("sets running:true inside withBoard and running:false in finally", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await RunFileOperation.executeBoardfile(device as any, "/main.py");

    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls[0]).toEqual([{ running: true }]);
    expect(calls.at(-1)).toEqual([{ running: false }]);
  });

  it("resets running:false in finally even when withBoard throws", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    (device.withBoard as jest.Mock).mockRejectedValue(
      new Error("board timeout"),
    );

    await expect(
      RunFileOperation.executeBoardfile(device as any, "/main.py"),
    ).rejects.toThrow("board timeout");

    expect(device.stateManager.set).toHaveBeenCalledWith({ running: false });
  });
});
