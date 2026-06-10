import {
  FetchLibrariesOperation,
  UninstallLibraryOperation,
} from "../../../../device/operation/LibraryOperations";
import { LibraryManifest } from "../../../../types/messages";

const FILE = 0;
const DIR = 0x4000;

// IlsEntry: [name, type, ignored, size]
type IlsEntry = [string, number, null, number];

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBoard(
  libEntries: IlsEntry[],
  manifest: LibraryManifest = { packages: {} },
  secondLibEntries?: IlsEntry[],
) {
  let ilsCallCount = 0;

  return {
    fs_ils: jest.fn().mockImplementation(() => {
      ilsCallCount++;
      // UninstallLibraryOperation calls fs_ils twice (before and after delete)
      if (secondLibEntries && ilsCallCount > 1) {
        return Promise.resolve(secondLibEntries);
      }
      return Promise.resolve(libEntries);
    }),
    fs_cat_binary: jest
      .fn()
      .mockResolvedValue(Buffer.from(JSON.stringify(manifest))),
    fs_save: jest.fn().mockResolvedValue(undefined),
    fs_rm: jest.fn().mockResolvedValue(undefined),
    fs_rmdir: jest.fn().mockResolvedValue(undefined),
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

// ── FetchLibrariesOperation ──────────────────────────────────────────────────

describe("FetchLibrariesOperation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns an empty array when the board has no /lib folder (withBoard throws)", async () => {
    const device = {
      stateManager: { set: jest.fn() },
      withBoard: jest.fn().mockRejectedValue(new Error("no lib")),
    };
    const result = await FetchLibrariesOperation.execute(device as any);
    expect(result).toEqual([]);
  });

  it("returns an empty array for a board with only manifest.json in /lib", async () => {
    const board = makeBoard([["manifest.json", FILE, null, 20]]);
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    expect(result).toEqual([]);
  });

  it("returns untracked files as items without manifest metadata", async () => {
    const board = makeBoard([["sensor.py", FILE, null, 100]]);
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "sensor.py",
      isDir: false,
      size: 100,
    });
    expect(result[0].url).toBeUndefined();
  });

  it("marks an untracked directory entry as isDir: true", async () => {
    const board = makeBoard([["mypackage", DIR, null, 0]]);
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    expect(result[0].isDir).toBe(true);
  });

  it("returns tracked packages with manifest metadata merged in", async () => {
    const manifest: LibraryManifest = {
      packages: {
        umqtt: {
          url: "https://github.com/micropython/micropython-lib",
          displayName: "umqtt",
          version: "1.0.0",
          installedAt: "2024-01-01",
          files: ["umqtt"],
        },
      },
    };
    const board = makeBoard(
      [
        ["umqtt", DIR, null, 0],
        ["manifest.json", FILE, null, 20],
      ],
      manifest,
    );
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: "umqtt",
      url: "https://github.com/micropython/micropython-lib",
      version: "1.0.0",
    });
  });

  it("does not add a duplicate item for files listed in manifest.files", async () => {
    // Library 'mylib' has files: ['mylib.py'] — the file should not appear twice
    const manifest: LibraryManifest = {
      packages: {
        mylib: {
          url: "https://example.com",
          files: ["mylib.py"],
        },
      },
    };
    const board = makeBoard(
      [
        ["mylib.py", FILE, null, 50],
        ["manifest.json", FILE, null, 10],
      ],
      manifest,
    );
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    // Only the manifest entry, not an extra raw file entry
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("mylib");
  });

  it("falls back to the package key as the covered file when files array is absent", async () => {
    const manifest: LibraryManifest = {
      packages: {
        // no 'files' array — key 'sensor' itself should be covered
        sensor: { url: "https://example.com" },
      },
    };
    const board = makeBoard(
      [
        ["sensor.py", FILE, null, 50],
        ["manifest.json", FILE, null, 10],
      ],
      manifest,
    );
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    // 'sensor.py' is not covered (coverage is 'sensor', not 'sensor.py')
    // → manifest entry 'sensor' + uncovered file 'sensor.py'
    expect(result).toHaveLength(2);
    const names = result.map((r) => r.name);
    expect(names).toContain("sensor");
    expect(names).toContain("sensor.py");
  });

  it("always lists manifest packages before untracked entries", async () => {
    const manifest: LibraryManifest = {
      packages: { mylib: { url: "https://example.com", files: ["mylib.py"] } },
    };
    const board = makeBoard(
      [
        ["extra.py", FILE, null, 30],
        ["mylib.py", FILE, null, 50],
        ["manifest.json", FILE, null, 10],
      ],
      manifest,
    );
    const device = makeDevice(board);
    const result = await FetchLibrariesOperation.execute(device as any);
    expect(result[0].name).toBe("mylib"); // manifest entry first
    expect(result[1].name).toBe("extra.py"); // untracked after
  });

  it("resets fileOpsActive to false after a successful fetch", async () => {
    const board = makeBoard([]);
    const device = makeDevice(board);
    await FetchLibrariesOperation.execute(device as any);
    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });
});

// ── UninstallLibraryOperation ─────────────────────────────────────────────────

describe("UninstallLibraryOperation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("removes a file library using fs_rm", async () => {
    const manifest: LibraryManifest = {
      packages: {
        sensor: { url: "https://example.com", files: ["sensor.py"] },
      },
    };
    const board = makeBoard(
      [["sensor.py", FILE, null, 50]],
      manifest,
      [], // board after deletion
    );
    const device = makeDevice(board);

    await UninstallLibraryOperation.execute(device as any, "sensor");

    expect(board.fs_rm).toHaveBeenCalledWith("/lib/sensor.py");
  });

  it("removes a directory library using board.run with a recursive delete script", async () => {
    const manifest: LibraryManifest = {
      packages: {
        umqtt: { url: "https://example.com", files: ["umqtt"] },
      },
    };
    const board = makeBoard([["umqtt", DIR, null, 0]], manifest, []);
    const device = makeDevice(board);

    await UninstallLibraryOperation.execute(device as any, "umqtt");

    // A directory must be deleted with a MicroPython recursive-rm script, not fs_rm
    expect(board.run).toHaveBeenCalled();
    expect(board.fs_rm).not.toHaveBeenCalled();
    const script: string = board.run.mock.calls[0][0];
    expect(script).toContain("/lib/umqtt");
  });

  it("removes the package from the manifest after uninstall", async () => {
    const manifest: LibraryManifest = {
      packages: {
        sensor: { url: "https://example.com", files: ["sensor.py"] },
      },
    };
    const board = makeBoard([["sensor.py", FILE, null, 50]], manifest, []);
    const device = makeDevice(board);

    await UninstallLibraryOperation.execute(device as any, "sensor");

    // fs_save is called by writeManifest; the saved JSON must not contain 'sensor'
    expect(board.fs_save).toHaveBeenCalled();
    const savedJson = JSON.parse(board.fs_save.mock.calls[0][0]);
    expect(savedJson.packages).not.toHaveProperty("sensor");
  });

  it("falls back to deleting the package key itself when no files array is in the manifest", async () => {
    const manifest: LibraryManifest = {
      packages: {
        sensor: { url: "https://example.com" }, // no 'files' array
      },
    };
    const board = makeBoard([["sensor", FILE, null, 50]], manifest, []);
    const device = makeDevice(board);

    await UninstallLibraryOperation.execute(device as any, "sensor");

    expect(board.fs_rm).toHaveBeenCalledWith("/lib/sensor");
  });

  it("returns the updated library list after uninstall", async () => {
    const manifest: LibraryManifest = {
      packages: {
        a: { url: "https://example.com/a", files: ["a.py"] },
        b: { url: "https://example.com/b", files: ["b.py"] },
      },
    };
    // After removing 'a', only 'b.py' remains
    const board = makeBoard(
      [
        ["a.py", FILE, null, 10],
        ["b.py", FILE, null, 20],
      ],
      manifest,
      [["b.py", FILE, null, 20]],
    );
    const device = makeDevice(board);

    const result = await UninstallLibraryOperation.execute(device as any, "a");

    expect(result).not.toBeNull();
    expect(result!.map((r) => r.name)).not.toContain("a");
    expect(result!.map((r) => r.name)).toContain("b");
  });

  it("resets fileOpsActive to false after a successful uninstall", async () => {
    const board = makeBoard(
      [],
      { packages: { sensor: { url: "x", files: [] } } },
      [],
    );
    const device = makeDevice(board);

    await UninstallLibraryOperation.execute(device as any, "sensor");

    const calls = (device.stateManager.set as jest.Mock).mock.calls;
    expect(calls.at(-1)).toEqual([{ fileOpsActive: false }]);
  });
});
