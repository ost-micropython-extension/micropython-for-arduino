import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { StubGenerator } from "../../stubs/StubGenerator";
import { fetchUrl } from "../../webview/utils";
import { addStubsExtraPath } from "../../stubs/PylanceConfig";
import { LibraryManifest } from "../../types/messages";
import {
  CODE_SUPPORT_FOLDER,
  CODE_SUPPORT_GENERATION_LOG_FILE,
} from "../../types/constants";

jest.mock("../../webview/utils");
jest.mock("../../stubs/PylanceConfig");

const mockFetchUrl = fetchUrl as jest.MockedFunction<typeof fetchUrl>;
const mockAddStubsExtraPath = addStubsExtraPath as jest.MockedFunction<
  typeof addStubsExtraPath
>;

const REPO_URL = "https://github.com/user/mylib/tree/main";

const rawContent = (src: string) => src;
const raw404 = () => "404: Not Found";
const contentsResponse = (...names: string[]) =>
  JSON.stringify(names.map((name) => ({ name, path: name, type: "file" })));

function findFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? findFiles(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}

describe("StubGenerator.generateFromGithub (integration)", () => {
  let generator: StubGenerator;
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mpy-stubs-test-"));
    generator = new StubGenerator();
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const codesupportDir = () => path.join(root, CODE_SUPPORT_FOLDER);
  const logPath = () =>
    path.join(root, CODE_SUPPORT_FOLDER, CODE_SUPPORT_GENERATION_LOG_FILE);

  // ── return shape ──────────────────────────────────────────────────────────

  it("always returns an object with a message string", async () => {
    const result = await generator.generateFromGithub(
      { packages: {} },
      root,
      true,
    );
    expect(result).toHaveProperty("message");
    expect(typeof result.message).toBe("string");
  });

  it("returns a success message for an empty manifest (0 packages)", async () => {
    const result = await generator.generateFromGithub(
      { packages: {} },
      root,
      true,
    );
    expect(result.message).toMatch(/✓.*all 0/i);
  });

  // ── directory and log ─────────────────────────────────────────────────────

  it("creates the .mpy_codesupport directory", async () => {
    await generator.generateFromGithub({ packages: {} }, root, true);

    expect(fs.existsSync(codesupportDir())).toBe(true);
  });

  it("appends a log entry regardless of outcome", async () => {
    await generator.generateFromGithub({ packages: {} }, root, true);

    expect(fs.existsSync(logPath())).toBe(true);
    expect(fs.readFileSync(logPath(), "utf8").length).toBeGreaterThan(0);
  });

  it("notes in the log whether triggered manually or automatically", async () => {
    await generator.generateFromGithub({ packages: {} }, root, true);
    expect(fs.readFileSync(logPath(), "utf8")).toContain("manually");

    await generator.generateFromGithub({ packages: {} }, root, false);
    expect(fs.readFileSync(logPath(), "utf8")).toContain(
      "by library installation",
    );
  });

  // ── skipped packages ──────────────────────────────────────────────────────

  it("skips and writes no files for a package with an empty URL", async () => {
    const manifest: LibraryManifest = {
      packages: { ssd1306: { url: "", files: ["ssd1306.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toContain("skipped");
    expect(fs.existsSync(path.join(codesupportDir(), "ssd1306"))).toBe(false);
  });

  it("skips packages with a non-GitHub URL", async () => {
    const manifest: LibraryManifest = {
      packages: {
        foo: { url: "https://gitlab.com/user/foo", files: ["foo.mpy"] },
      },
    };

    const result = await generator.generateFromGithub(manifest, root, false);

    expect(result.message).toContain("skipped");
    expect(findFiles(codesupportDir()).some((f) => f.includes("foo.py"))).toBe(
      false,
    );
  });

  it("skips gracefully when fetchUrl throws", async () => {
    mockFetchUrl.mockRejectedValue(new Error("network error"));

    const manifest: LibraryManifest = {
      packages: { foo: { url: REPO_URL, files: ["foo.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toMatch(/skipped/i);
    expect(findFiles(codesupportDir()).some((f) => f.includes("foo.py"))).toBe(
      false,
    );
  });

  it("skips when no downloadable .py files are found (all 404)", async () => {
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { foo: { url: REPO_URL, files: ["foo.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toMatch(/skipped/i);
    expect(result.readmeFound).toBe(false);
  });

  // ── successful file writing ───────────────────────────────────────────────

  it("writes the .py source file with correct content for a single .mpy board file", async () => {
    mockFetchUrl.mockResolvedValueOnce(rawContent("class MyLib:\n    pass\n"));
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { mylib: { url: REPO_URL, files: ["mylib.mpy"] } },
    };

    await generator.generateFromGithub(manifest, root, true);

    const allFiles = findFiles(codesupportDir());
    const pyFile = allFiles.find((f) => f.endsWith("mylib.py"));
    expect(pyFile).toBeDefined();
    expect(fs.readFileSync(pyFile!, "utf8")).toContain("class MyLib");
  });

  it("writes the README when found in the repo", async () => {
    mockFetchUrl
      .mockResolvedValueOnce(rawContent("class MyLib:\n    pass\n"))
      .mockResolvedValueOnce(rawContent("# MyLib\nSome docs"));

    const manifest: LibraryManifest = {
      packages: { mylib: { url: REPO_URL, files: ["mylib.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    const allFiles = findFiles(codesupportDir());
    const readmeFile = allFiles.find((f) => f.endsWith("README.md"));
    expect(readmeFile).toBeDefined();
    expect(fs.readFileSync(readmeFile!, "utf8")).toContain("# MyLib");
    expect(result.readmeFound).toBe(true);
  });

  it("sets readmeFound to false and does not write README when not in repo", async () => {
    mockFetchUrl.mockResolvedValueOnce(rawContent("x = 1\n"));
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { mylib: { url: REPO_URL, files: ["mylib.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    const allFiles = findFiles(codesupportDir());
    expect(allFiles.some((f) => f.endsWith("README.md"))).toBe(false);
    expect(result.readmeFound).toBe(false);
  });

  it("writes multiple files when board entry is a folder", async () => {
    mockFetchUrl.mockResolvedValueOnce(
      contentsResponse("mylib/core.py", "mylib/display.py"),
    );
    mockFetchUrl.mockResolvedValueOnce(rawContent("class Core:\n    pass\n"));
    mockFetchUrl.mockResolvedValueOnce(
      rawContent("class Display:\n    pass\n"),
    );
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { mylib: { url: REPO_URL, files: ["mylib"] } },
    };

    await generator.generateFromGithub(manifest, root, true);

    const allFiles = findFiles(codesupportDir());
    expect(allFiles.some((f) => f.includes("core.py"))).toBe(true);
    expect(allFiles.some((f) => f.includes("display.py"))).toBe(true);
  });

  // ── success messages ──────────────────────────────────────────────────────

  it("returns a success message for a single successful package", async () => {
    mockFetchUrl.mockResolvedValueOnce(rawContent("def foo(): pass\n"));
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { foo: { url: REPO_URL, files: ["foo.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toMatch(/✓.*foo/i);
    expect(result.message).not.toContain("skipped");
  });

  it("returns a skip message for a package with no downloadable .py files", async () => {
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { foo: { url: REPO_URL, files: ["foo.mpy"] } },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toMatch(/skipped/i);
  });

  it("reports partial success across multiple packages", async () => {
    mockFetchUrl.mockResolvedValueOnce(rawContent("class A:\n    pass\n"));
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: {
        pkg1: { url: REPO_URL, files: ["pkg1.mpy"] },
        pkg2: { url: "", files: ["pkg2.mpy"] },
      },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toContain("1 of 2");
  });

  it("reports all successful when every package has .py files", async () => {
    mockFetchUrl.mockImplementation((url: string) => {
      if (url.includes("pkg1.py")) {
        return Promise.resolve("class A:\n    pass\n");
      }
      if (url.includes("pkg2.py")) {
        return Promise.resolve("class B:\n    pass\n");
      }
      return Promise.resolve("404: Not Found");
    });

    const manifest: LibraryManifest = {
      packages: {
        pkg1: { url: REPO_URL, files: ["pkg1.mpy"] },
        pkg2: { url: REPO_URL, files: ["pkg2.mpy"] },
      },
    };

    const result = await generator.generateFromGithub(manifest, root, true);

    expect(result.message).toMatch(/✓.*all.*2/i);
  });

  // ── side-effects ──────────────────────────────────────────────────────────

  it("calls addStubsExtraPath with root and package name on success", async () => {
    mockFetchUrl.mockResolvedValueOnce(rawContent("x = 1\n"));
    mockFetchUrl.mockResolvedValue(raw404());

    const manifest: LibraryManifest = {
      packages: { mylib: { url: REPO_URL, files: ["mylib.mpy"] } },
    };

    await generator.generateFromGithub(manifest, root, true);

    expect(mockAddStubsExtraPath).toHaveBeenCalledWith(root, "mylib");
  });

  it("does not call addStubsExtraPath when a package is skipped", async () => {
    const manifest: LibraryManifest = {
      packages: { foo: { url: "", files: ["foo.mpy"] } },
    };

    await generator.generateFromGithub(manifest, root, true);

    expect(mockAddStubsExtraPath).not.toHaveBeenCalled();
  });
});
