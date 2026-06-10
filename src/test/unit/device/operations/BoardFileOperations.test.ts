import { BoardFileOperations } from "../../../../device/operation/BoardFileOperations";

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
    expect(board.fs_save).toHaveBeenCalledWith("x = 1", "/main.py");
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
    expect(board.fs_save).toHaveBeenCalledWith("code", "/lib/sub/sensor.py");
  });

  it("resets fileOpsActive to false after a successful upload", async () => {
    const board = makeBoard();
    const device = makeDevice(board);

    await BoardFileOperations.uploadContent(device as any, "x", "/f.py");

    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });
});
