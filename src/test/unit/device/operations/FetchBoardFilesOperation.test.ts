import { FetchBoardFilesOperation } from "../../../../device/operation/FetchBoardFilesOperation";
import { FileNode } from "../../../../types/messages";

// IlsEntry: [name, type, ignored, size]
const FILE = 0;
const DIR = 0x4000;

type IlsEntry = [string, number, null, number];

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBoard(ilsMap: Record<string, IlsEntry[]>) {
  return {
    fs_ils: jest.fn().mockImplementation((path: string | undefined) => {
      // micropython.js passes undefined for the root directory
      const key = path === undefined ? "/" : path;
      return Promise.resolve(ilsMap[key] ?? []);
    }),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FetchBoardFilesOperation", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Root node ───────────────────────────────────────────────────────────────

  describe("root node", () => {
    it("uses the last path segment of a full port path as the display name", async () => {
      const device = makeDevice(makeBoard({ "/": [] }));
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "/dev/ttyACM0",
      );
      expect(root.name).toBe("ttyACM0");
    });

    it("uses the port string directly when it has no path separators", async () => {
      const device = makeDevice(makeBoard({ "/": [] }));
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.name).toBe("COM3");
    });

    it("returns a single root node with id '/', type folder, and root flag", async () => {
      const device = makeDevice(makeBoard({ "/": [] }));
      const result = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ id: "/", type: "folder", root: true });
    });

    it("returns an empty children array for an empty board", async () => {
      const device = makeDevice(makeBoard({ "/": [] }));
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children).toEqual([]);
    });
  });

  // ── Sorting ─────────────────────────────────────────────────────────────────

  describe("sorting", () => {
    it("places folders before files", async () => {
      const board = makeBoard({
        "/": [
          ["main.py", FILE, null, 100],
          ["lib", DIR, null, 0],
        ],
        "/lib": [],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      const children = root.children!;
      expect(children[0].type).toBe("folder");
      expect(children[1].type).toBe("file");
    });

    it("sorts files alphabetically when all entries are files", async () => {
      const board = makeBoard({
        "/": [
          ["z.py", FILE, null, 10],
          ["a.py", FILE, null, 10],
          ["m.py", FILE, null, 10],
        ],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children!.map((c) => c.name)).toEqual([
        "a.py",
        "m.py",
        "z.py",
      ]);
    });

    it("sorts folders alphabetically when all entries are folders", async () => {
      const board = makeBoard({
        "/": [
          ["zoo", DIR, null, 0],
          ["alpha", DIR, null, 0],
          ["mid", DIR, null, 0],
        ],
        "/zoo": [],
        "/alpha": [],
        "/mid": [],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children!.map((c) => c.name)).toEqual([
        "alpha",
        "mid",
        "zoo",
      ]);
    });

    it("sorts within each group (folders first, then alphabetical)", async () => {
      const board = makeBoard({
        "/": [
          ["z.py", FILE, null, 10],
          ["lib", DIR, null, 0],
          ["a.py", FILE, null, 10],
          ["boot", DIR, null, 0],
        ],
        "/lib": [],
        "/boot": [],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children!.map((c) => c.name)).toEqual([
        "boot",
        "lib",
        "a.py",
        "z.py",
      ]);
    });
  });

  // ── Node structure ──────────────────────────────────────────────────────────

  describe("node structure", () => {
    it("attaches file size to file node meta", async () => {
      const board = makeBoard({
        "/": [["main.py", FILE, null, 1234]],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children![0].meta?.size).toBe(1234);
    });

    it("uses 0 as fallback when size is missing", async () => {
      const board = makeBoard({
        "/": [["main.py", FILE, null, 0]],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children![0].meta?.size).toBe(0);
    });

    it("sets file node id to the full path", async () => {
      const board = makeBoard({
        "/": [["main.py", FILE, null, 10]],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children![0].id).toBe("/main.py");
    });

    it("builds nested folder structure recursively", async () => {
      const board = makeBoard({
        "/": [["lib", DIR, null, 0]],
        "/lib": [["sensor.py", FILE, null, 50]],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      const libFolder = root.children![0];
      expect(libFolder.name).toBe("lib");
      expect(libFolder.type).toBe("folder");
      expect(libFolder.children).toHaveLength(1);
      expect(libFolder.children![0].name).toBe("sensor.py");
    });

    it("builds deeply nested folder trees", async () => {
      const board = makeBoard({
        "/": [["a", DIR, null, 0]],
        "/a": [["b", DIR, null, 0]],
        "/a/b": [["deep.py", FILE, null, 5]],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      const deep = root.children![0].children![0].children![0];
      expect(deep.name).toBe("deep.py");
      expect(deep.id).toBe("/a/b/deep.py");
    });

    it("gives folder nodes an empty children array when the folder is empty", async () => {
      const board = makeBoard({
        "/": [["lib", DIR, null, 0]],
        "/lib": [],
      });
      const device = makeDevice(board);
      const [root] = await FetchBoardFilesOperation.execute(
        device as any,
        "COM3",
      );
      expect(root.children![0].children).toEqual([]);
    });
  });

  // ── State management ────────────────────────────────────────────────────────

  describe("state management", () => {
    it("sets fileOpsActive to true before the board operation", async () => {
      const device = makeDevice(makeBoard({ "/": [] }));
      await FetchBoardFilesOperation.execute(device as any, "COM3");
      expect(device.stateManager.set).toHaveBeenCalledWith({
        fileOpsActive: true,
      });
    });

    it("does NOT reset fileOpsActive after a successful operation (no finally block)", async () => {
      // FetchBoardFilesOperation only resets fileOpsActive on error; the caller
      // is responsible for clearing the flag once the tree has been delivered.
      const device = makeDevice(makeBoard({ "/": [] }));
      await FetchBoardFilesOperation.execute(device as any, "COM3");
      const calls = (device.stateManager.set as jest.Mock).mock.calls;
      expect(calls.at(-1)).toEqual([{ fileOpsActive: true }]);
    });

    it("resets fileOpsActive to false and re-throws when the board operation fails", async () => {
      const failingBoard = {
        fs_ils: jest.fn().mockRejectedValue(new Error("connection lost")),
      };
      const device = makeDevice(failingBoard as any);

      await expect(
        FetchBoardFilesOperation.execute(device as any, "COM3"),
      ).rejects.toThrow("connection lost");

      expect(device.stateManager.set).toHaveBeenCalledWith({
        fileOpsActive: false,
      });
    });
  });
});
