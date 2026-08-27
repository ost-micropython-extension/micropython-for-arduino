import * as vscode from "vscode";
import {
  BoardFileOperations,
  TransferCancelledError,
} from "../../../../device/operation/BoardFileOperations";

// IlsEntry: [name, type, ignored, size]
const FILE = 0;
const DIR = 0x4000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBoard(ilsByPath: Record<string, [string, number][]> = {}) {
  return {
    fs_ils: jest
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(ilsByPath[path] ?? []),
      ),
    fs_save: jest.fn().mockResolvedValue(undefined),
    fs_rm: jest.fn().mockResolvedValue(undefined),
    fs_rmdir: jest.fn().mockResolvedValue(undefined),
    fs_mkdir: jest.fn().mockResolvedValue(undefined),
    fs_rename: jest.fn().mockResolvedValue(undefined),
    fs_put: jest.fn().mockResolvedValue(undefined),
    fs_cat_binary: jest.fn().mockResolvedValue(Buffer.from("")),
    run: jest.fn().mockResolvedValue(undefined),
  };
}

function makeDevice(board: ReturnType<typeof makeBoard>) {
  return {
    stateManager: { set: jest.fn() },
    setCancelOnDispose: jest.fn(),
    withBoard: jest
      .fn()
      .mockImplementation(async (cb: (b: typeof board) => unknown) =>
        cb(board),
      ),
  };
}

// ── create ───────────────────────────────────────────────────────────────────

describe("BoardFileOperations.create()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls fs_save with newline content at the given full path", async () => {
    const board = makeBoard({ "/": [] }); // file does not exist yet
    const device = makeDevice(board);

    await BoardFileOperations.create(device as any, "test.py", "/", "/test.py");

    expect(board.fs_save).toHaveBeenCalledWith("\n", "/test.py");
  });

  it("throws when the file already exists in the target folder", async () => {
    const board = makeBoard({ "/": [["test.py", FILE]] });
    const device = makeDevice(board);

    await expect(
      BoardFileOperations.create(device as any, "test.py", "/", "/test.py"),
    ).rejects.toThrow('"test.py" already exists in this folder.');
  });

  it("resets fileOpsActive to false after creation (finally block)", async () => {
    const board = makeBoard({ "/": [] });
    const device = makeDevice(board);

    await BoardFileOperations.create(device as any, "new.py", "/", "/new.py");

    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });
});

// ── createFolder ──────────────────────────────────────────────────────────────

describe("BoardFileOperations.createFolder()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls fs_mkdir at the given full path", async () => {
    const board = makeBoard({ "/": [] });
    const device = makeDevice(board);

    await BoardFileOperations.createFolder(device as any, "lib", "/", "/lib");

    expect(board.fs_mkdir).toHaveBeenCalledWith("/lib");
  });

  it("throws when the folder already exists", async () => {
    const board = makeBoard({ "/": [["lib", DIR]] });
    const device = makeDevice(board);

    await expect(
      BoardFileOperations.createFolder(device as any, "lib", "/", "/lib"),
    ).rejects.toThrow('"lib" already exists in this folder.');
  });
});

// ── rename ────────────────────────────────────────────────────────────────────

describe("BoardFileOperations.rename()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls fs_rename with old and new path", async () => {
    const board = makeBoard({
      "/": [["main.py", FILE]], // old name exists, new name does not
    });
    const device = makeDevice(board);

    await BoardFileOperations.rename(
      device as any,
      "renamed.py",
      "/",
      "/main.py",
      "/renamed.py",
    );

    expect(board.fs_rename).toHaveBeenCalledWith("/main.py", "/renamed.py");
  });

  it("throws when the source file does not exist", async () => {
    const board = makeBoard({ "/": [] }); // nothing in root
    const device = makeDevice(board);

    await expect(
      BoardFileOperations.rename(device as any, "b.py", "/", "/a.py", "/b.py"),
    ).rejects.toThrow('"a.py" does not exist.');
  });

  it("throws when the target name already exists", async () => {
    const board = makeBoard({
      "/": [
        ["a.py", FILE],
        ["b.py", FILE],
      ], // both exist
    });
    const device = makeDevice(board);

    await expect(
      BoardFileOperations.rename(device as any, "b.py", "/", "/a.py", "/b.py"),
    ).rejects.toThrow('"b.py" already exists in this folder.');
  });
});

// ── move ──────────────────────────────────────────────────────────────────────

describe("BoardFileOperations.move()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls fs_rename and resets fileOpsActive to false after a successful move", async () => {
    const board = makeBoard({ "/lib": [] }); // target does not exist yet
    const device = makeDevice(board);

    await BoardFileOperations.move(device as any, "/main.py", "/lib/main.py");

    expect(board.fs_rename).toHaveBeenCalledWith("/main.py", "/lib/main.py");
    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });

  it("deletes the existing target and renames when the user confirms replace", async () => {
    const board = makeBoard({
      "/lib": [["main.py", FILE]],
    });
    const device = makeDevice(board);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
      "Replace",
    );

    await BoardFileOperations.move(device as any, "/main.py", "/lib/main.py");

    expect(board.fs_rm).toHaveBeenCalledWith("/lib/main.py");
    expect(board.fs_rename).toHaveBeenCalledWith("/main.py", "/lib/main.py");
  });

  it("throws and resets fileOpsActive when the user declines to replace", async () => {
    const board = makeBoard({
      "/lib": [["main.py", FILE]],
    });
    const device = makeDevice(board);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
      undefined,
    );

    await expect(
      BoardFileOperations.move(device as any, "/main.py", "/lib/main.py"),
    ).rejects.toThrow("cancelled");

    expect(board.fs_rename).not.toHaveBeenCalled();
    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });

  it("recursively deletes an existing folder target (not fs_rm) before renaming", async () => {
    const board = makeBoard({
      "/": [["lib", DIR]],
      "/lib": [["sensor.py", FILE]],
    });
    const device = makeDevice(board);
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
      "Replace",
    );

    await BoardFileOperations.move(device as any, "/other-lib", "/lib");

    expect(board.fs_rm).toHaveBeenCalledWith("/lib/sensor.py");
    expect(board.fs_rmdir).toHaveBeenCalledWith("/lib");
    expect(board.fs_rename).toHaveBeenCalledWith("/other-lib", "/lib");
  });
});

// ── delete ────────────────────────────────────────────────────────────────────

describe("BoardFileOperations.delete()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls fs_rm for a file", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.delete(device as any, false, "/main.py");

    expect(board.fs_rm).toHaveBeenCalledWith("/main.py");
  });

  it("recursively deletes a folder: removes children then calls fs_rmdir", async () => {
    const board = makeBoard({
      "/lib": [["sensor.py", FILE]],
    });
    const device = makeDevice(board);

    await BoardFileOperations.delete(device as any, true, "/lib");

    expect(board.fs_rm).toHaveBeenCalledWith("/lib/sensor.py");
    expect(board.fs_rmdir).toHaveBeenCalledWith("/lib");
  });

  it("tolerates fs_ils failing while listing a folder's children and still removes it", async () => {
    const board = makeBoard();
    board.fs_ils.mockRejectedValueOnce(new Error("folder vanished"));
    const device = makeDevice(board);

    await expect(
      BoardFileOperations.delete(device as any, true, "/lib"),
    ).resolves.toBeUndefined();

    expect(board.fs_rm).not.toHaveBeenCalled();
    expect(board.fs_rmdir).toHaveBeenCalledWith("/lib");
  });
});

// ── uploadContent (tests ensureDir path-splitting logic) ─────────────────────

describe("BoardFileOperations.uploadContent()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("saves content directly when target is in the root folder", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.uploadContent(device as any, "x = 1", "/main.py");

    // Root path — no ensureDir calls needed
    expect(board.fs_mkdir).not.toHaveBeenCalled();
    expect(board.fs_save).toHaveBeenCalledWith(
      "x = 1",
      "/main.py",
      expect.any(Function),
    );
  });

  it("calls fs_mkdir for each segment of a nested path before saving", async () => {
    const board = makeBoard();
    // fs_mkdir throws for existing dirs, which ensureDir ignores
    board.fs_mkdir.mockRejectedValueOnce(new Error("exists")); // /lib already exists
    board.fs_mkdir.mockResolvedValueOnce(undefined); // /lib/sub is new

    const device = makeDevice(board);

    await BoardFileOperations.uploadContent(
      device as any,
      "code",
      "/lib/sub/sensor.py",
    );

    expect(board.fs_mkdir).toHaveBeenCalledWith("/lib");
    expect(board.fs_mkdir).toHaveBeenCalledWith("/lib/sub");
    expect(board.fs_save).toHaveBeenCalledWith(
      "code",
      "/lib/sub/sensor.py",
      expect.any(Function),
    );
  });

  it("resets fileOpsActive to false after a successful upload", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.uploadContent(device as any, "x", "/f.py");

    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });

  it("aborts and clears the cancel-on-dispose hook when cancelled", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    const source = new (
      vscode as unknown as {
        CancellationTokenSource: new () => {
          token: unknown;
          cancel: () => void;
        };
      }
    ).CancellationTokenSource();

    board.fs_save.mockImplementation(
      async (
        _content: string,
        _dest: string,
        dataConsumer?: (p: string) => void,
      ) => {
        source.cancel();
        dataConsumer?.("50%");
      },
    );

    await expect(
      BoardFileOperations.uploadContent(
        device as any,
        "x",
        "/f.py",
        undefined,
        source.token as never,
      ),
    ).rejects.toThrow("Upload cancelled");

    expect(device.setCancelOnDispose).toHaveBeenLastCalledWith(undefined);
  });
});

// ── uploadFile (progress reporting and cancellation) ──────────────────────────

describe("BoardFileOperations.uploadFile()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("auto-selects the root folder when it is the only destination and reports progress", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    const onProgress = jest.fn();

    board.fs_put.mockImplementation(
      async (
        _src: string,
        _dest: string,
        dataConsumer?: (p: string) => void,
      ) => {
        dataConsumer?.("0%");
        dataConsumer?.("50%");
      },
    );

    const result = await BoardFileOperations.uploadFile(
      device as any,
      "/local/main.py",
      "main.py",
      onProgress,
    );

    expect(result).toBe("/");
    expect(board.fs_put).toHaveBeenCalledWith(
      "/local/main.py",
      "/main.py",
      expect.any(Function),
    );
    expect(onProgress).toHaveBeenCalledWith(0);
    expect(onProgress).toHaveBeenCalledWith(50);
  });

  it("aborts the transfer when the cancellation token fires mid-upload", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    const source = new (
      vscode as unknown as {
        CancellationTokenSource: new () => {
          token: unknown;
          cancel: () => void;
        };
      }
    ).CancellationTokenSource();

    board.fs_put.mockImplementation(
      async (
        _src: string,
        _dest: string,
        dataConsumer?: (p: string) => void,
      ) => {
        dataConsumer?.("30%"); // first chunk still goes through
        source.cancel();
        dataConsumer?.("60%"); // aborted before this chunk
      },
    );

    await expect(
      BoardFileOperations.uploadFile(
        device as any,
        "/local/main.py",
        "main.py",
        undefined,
        source.token as never,
      ),
    ).rejects.toThrow(TransferCancelledError);
  });

  it("aborts the transfer when the token was already cancelled before the upload started", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    const source = new (
      vscode as unknown as {
        CancellationTokenSource: new () => {
          token: unknown;
          cancel: () => void;
        };
      }
    ).CancellationTokenSource();
    // Cancelled up front — onCancellationRequested will never fire again,
    // so this only works if the initial token state is read directly.
    source.cancel();

    board.fs_put.mockImplementation(
      async (
        _src: string,
        _dest: string,
        dataConsumer?: (p: string) => void,
      ) => {
        dataConsumer?.("10%");
      },
    );

    await expect(
      BoardFileOperations.uploadFile(
        device as any,
        "/local/main.py",
        "main.py",
        undefined,
        source.token as never,
      ),
    ).rejects.toThrow("Upload cancelled");
  });

  it("aborts the transfer when the device is disposed mid-upload", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    let cancelHook: (() => void) | undefined;
    device.setCancelOnDispose = jest.fn((cb: (() => void) | undefined) => {
      cancelHook = cb;
    });

    board.fs_put.mockImplementation(
      async (
        _src: string,
        _dest: string,
        dataConsumer?: (p: string) => void,
      ) => {
        // Simulates DeviceManager.dispose() firing the hook on disconnect
        cancelHook?.();
        dataConsumer?.("50%");
      },
    );

    await expect(
      BoardFileOperations.uploadFile(
        device as any,
        "/local/main.py",
        "main.py",
      ),
    ).rejects.toThrow("Upload cancelled");
  });

  it("clears the cancel-on-dispose hook once the upload finishes", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.uploadFile(
      device as any,
      "/local/main.py",
      "main.py",
    );

    expect(device.setCancelOnDispose).toHaveBeenLastCalledWith(undefined);
  });
});

// ── getFileData (progress reporting and cancellation) ─────────────────────────

describe("BoardFileOperations.getFileData()", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the file content as a Buffer", async () => {
    const board = makeBoard();
    board.fs_cat_binary.mockResolvedValue(Buffer.from("hello"));
    const device = makeDevice(board);

    const result = await BoardFileOperations.getFileData(
      device as any,
      "/main.py",
    );

    expect(board.fs_cat_binary).toHaveBeenCalledWith(
      "/main.py",
      expect.any(Function),
    );
    expect(result).toEqual(Buffer.from("hello"));
  });

  it("reports progress via onProgress as chunks arrive", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    const onProgress = jest.fn();

    board.fs_cat_binary.mockImplementation(
      async (_path: string, dataConsumer?: (p: string) => void) => {
        dataConsumer?.("0%");
        dataConsumer?.("50%");
        dataConsumer?.("100%");
        return Buffer.from("data");
      },
    );

    await BoardFileOperations.getFileData(
      device as any,
      "/main.py",
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledWith(0);
    expect(onProgress).toHaveBeenCalledWith(50);
    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it("aborts the transfer when the cancellation token fires mid-download", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    const source = new (
      vscode as unknown as {
        CancellationTokenSource: new () => {
          token: unknown;
          cancel: () => void;
        };
      }
    ).CancellationTokenSource();

    board.fs_cat_binary.mockImplementation(
      async (_path: string, dataConsumer?: (p: string) => void) => {
        dataConsumer?.("30%");
        source.cancel();
        dataConsumer?.("60%");
        return Buffer.from("data");
      },
    );

    await expect(
      BoardFileOperations.getFileData(
        device as any,
        "/main.py",
        undefined,
        source.token as never,
      ),
    ).rejects.toThrow("Download cancelled");
  });

  it("aborts the transfer when the device is disposed mid-download", async () => {
    const board = makeBoard();
    const device = makeDevice(board);
    let cancelHook: (() => void) | undefined;
    device.setCancelOnDispose = jest.fn((cb: (() => void) | undefined) => {
      cancelHook = cb;
    });

    board.fs_cat_binary.mockImplementation(
      async (_path: string, dataConsumer?: (p: string) => void) => {
        cancelHook?.();
        dataConsumer?.("50%");
        return Buffer.from("data");
      },
    );

    await expect(
      BoardFileOperations.getFileData(device as any, "/main.py"),
    ).rejects.toThrow("Download cancelled");
  });

  it("clears the cancel-on-dispose hook once the download finishes", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.getFileData(device as any, "/main.py");

    expect(device.setCancelOnDispose).toHaveBeenLastCalledWith(undefined);
  });

  it("resets fileOpsActive to false after a successful download", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.getFileData(device as any, "/main.py");

    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });
});
