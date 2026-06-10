import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { BoardFileSystemProvider } from "../../webview/handlers/BoardFileSystemProvider";

const mockGetFileData = jest.fn();
const mockDM = {
  getDevice: jest.fn().mockReturnValue({ getFileData: mockGetFileData }),
} as any;

function makeContext(workspaceState: object) {
  return {
    workspaceState,
    globalState: {
      get: jest.fn().mockReturnValue(false),
      update: jest.fn().mockResolvedValue(undefined),
      setKeysForSync: jest.fn(),
    },
  } as any;
}

function makeWorkspaceState(initial: string[] = []) {
  const store: Record<string, unknown> = { boardCacheFiles: initial };
  return {
    get: jest
      .fn()
      .mockImplementation(
        (key: string, def: unknown = []) => store[key] ?? def,
      ),
    update: jest.fn().mockImplementation((_key: string, val: unknown) => {
      store[_key] = val;
    }),
  };
}

function resetSingleton() {
  (BoardFileSystemProvider as any)._instance = undefined;
}

describe("BoardFileSystemProvider (integration)", () => {
  let tmpDir: string;
  let cacheDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mpy-bfsp-test-"));
    cacheDir = path.join(tmpDir, BoardFileSystemProvider.CACHE_DIR);
    jest.clearAllMocks();
    resetSingleton();
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: tmpDir } }];
    (vscode.workspace as any).openTextDocument = jest
      .fn()
      .mockResolvedValue({});
    (vscode.window as any).showTextDocument = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetSingleton();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Restore persisted files ───────────────────────────────────────────────

  it("restores only files that physically exist on disk", () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const existingPath = path.join(cacheDir, "a.py");
    fs.writeFileSync(existingPath, "# a", "utf8");
    const missingPath = path.join(cacheDir, "b.py");

    const ws = makeWorkspaceState([existingPath, missingPath]);
    const p = BoardFileSystemProvider.instance(mockDM, makeContext(ws));

    expect((p as any)._boardFiles.size).toBe(1);
    expect((p as any)._boardFiles.has(existingPath)).toBe(true);
  });

  // ── downloadAndOpen ───────────────────────────────────────────────────────

  it("writes file data to .board_cache/ with correct content", async () => {
    const content = Buffer.from("print('hello')", "utf8");
    mockGetFileData.mockResolvedValue(content);
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("Ok");

    const provider = BoardFileSystemProvider.instance(
      mockDM,
      makeContext(makeWorkspaceState()),
    );
    await provider.downloadAndOpen("COM3", "/test.py");

    const written = fs.readFileSync(path.join(cacheDir, "test.py"));
    expect(written).toEqual(content);
  });

  it("creates nested directories in .board_cache/ for nested board paths", async () => {
    mockGetFileData.mockResolvedValue(Buffer.from("x = 1", "utf8"));
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue("Ok");

    const provider = BoardFileSystemProvider.instance(
      mockDM,
      makeContext(makeWorkspaceState()),
    );
    await provider.downloadAndOpen("COM3", "/lib/mymodule.py");

    expect(fs.existsSync(path.join(cacheDir, "lib", "mymodule.py"))).toBe(true);
  });

  // ── onBoardFileClosed ─────────────────────────────────────────────────────

  it("deletes the cached file from disk when closed", async () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, "test.py");
    fs.writeFileSync(filePath, "# test", "utf8");

    const provider = BoardFileSystemProvider.instance(
      mockDM,
      makeContext(makeWorkspaceState()),
    );
    const uri = vscode.Uri.file(filePath);
    (provider as any)._boardFiles.add(uri.toString());

    await provider.onBoardFileClosed(uri);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("does not delete file if URI is not tracked", async () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, "test.py");
    fs.writeFileSync(filePath, "# test", "utf8");

    const provider = BoardFileSystemProvider.instance(
      mockDM,
      makeContext(makeWorkspaceState()),
    );
    const uri = vscode.Uri.file(filePath);

    await provider.onBoardFileClosed(uri);

    expect(fs.existsSync(filePath)).toBe(true);
  });

  // ── _tryDeleteEmptyParents ────────────────────────────────────────────────

  it("removes empty parent directories up to and including .board_cache/", () => {
    const nestedDir = path.join(cacheDir, "a", "b");
    fs.mkdirSync(nestedDir, { recursive: true });
    const filePath = path.join(nestedDir, "test.py");
    fs.writeFileSync(filePath, "# test", "utf8");
    fs.rmSync(filePath);

    const provider = BoardFileSystemProvider.instance(
      mockDM,
      makeContext(makeWorkspaceState()),
    );
    (provider as any)._tryDeleteEmptyParents(filePath);

    expect(fs.existsSync(path.join(cacheDir, "a", "b"))).toBe(false);
    expect(fs.existsSync(path.join(cacheDir, "a"))).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(false);
  });

  it("stops removing parents when a directory is not empty", () => {
    const nestedDir = path.join(cacheDir, "a", "b");
    fs.mkdirSync(nestedDir, { recursive: true });
    const filePath = path.join(nestedDir, "test.py");
    fs.writeFileSync(filePath, "# test", "utf8");
    fs.writeFileSync(path.join(cacheDir, "other.py"), "# other", "utf8");
    fs.rmSync(filePath);

    const provider = BoardFileSystemProvider.instance(
      mockDM,
      makeContext(makeWorkspaceState()),
    );
    (provider as any)._tryDeleteEmptyParents(filePath);

    expect(fs.existsSync(path.join(cacheDir, "a"))).toBe(false);
    expect(fs.existsSync(cacheDir)).toBe(true);
  });
});
