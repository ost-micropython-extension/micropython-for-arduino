import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createAIInstructions } from "../../stubs/PylanceConfig";

const SECTION_START = "<!-- micropython-for-arduino:start -->";
const SECTION_END = "<!-- micropython-for-arduino:end -->";

describe("createAIInstructions (integration)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mpy-test-"));
    (vscode.workspace as any).getConfiguration = jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue(true),
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const githubDir = () => path.join(root, ".github");
  const copilotPath = () =>
    path.join(root, ".github", "copilot-instructions.md");
  const claudePath = () => path.join(root, "CLAUDE.md");

  // ── copilot-instructions.md ───────────────────────────────────────────────

  describe("copilot-instructions.md", () => {
    it("creates .github directory and file with section markers when both are missing", () => {
      createAIInstructions(root);

      expect(fs.existsSync(githubDir())).toBe(true);
      const content = fs.readFileSync(copilotPath(), "utf8");
      expect(content).toContain(SECTION_START);
      expect(content).toContain(SECTION_END);
      expect(content).toContain("# MicroPython Context");
    });

    it("creates file correctly when .github directory already exists", () => {
      fs.mkdirSync(githubDir());

      createAIInstructions(root);

      const content = fs.readFileSync(copilotPath(), "utf8");
      expect(content).toContain(SECTION_START);
      expect(content).toContain("# MicroPython Context");
    });

    it("does not modify file that already contains section markers", () => {
      fs.mkdirSync(githubDir());
      const original = `# Custom\n\n${SECTION_START}\ncustom content\n${SECTION_END}\n`;
      fs.writeFileSync(copilotPath(), original, "utf8");

      createAIInstructions(root);

      expect(fs.readFileSync(copilotPath(), "utf8")).toBe(original);
    });

    it("appends section to existing file without markers", () => {
      fs.mkdirSync(githubDir());
      fs.writeFileSync(copilotPath(), "# Custom instructions", "utf8");

      createAIInstructions(root);

      const content = fs.readFileSync(copilotPath(), "utf8");
      expect(content).toContain("# Custom instructions");
      expect(content).toContain(SECTION_START);
      expect(content).toContain("# MicroPython Context");
    });
  });

  // ── CLAUDE.md ─────────────────────────────────────────────────────────────

  describe("CLAUDE.md", () => {
    it("creates CLAUDE.md with section markers when file does not exist", () => {
      createAIInstructions(root);

      const content = fs.readFileSync(claudePath(), "utf8");
      expect(content).toContain(SECTION_START);
      expect(content).toContain(SECTION_END);
      expect(content).toContain("# MicroPython Context");
    });

    it("does not modify CLAUDE.md that already contains section markers", () => {
      const original = `# My Project\n\n${SECTION_START}\ncustom content\n${SECTION_END}`;
      fs.writeFileSync(claudePath(), original, "utf8");

      createAIInstructions(root);

      expect(fs.readFileSync(claudePath(), "utf8")).toBe(original);
    });

    it("appends section to existing CLAUDE.md without markers, preserving existing content", () => {
      const existing = "# My Project\n\nSome existing instructions.";
      fs.writeFileSync(claudePath(), existing, "utf8");

      createAIInstructions(root);

      const content = fs.readFileSync(claudePath(), "utf8");
      expect(content).toContain("# My Project");
      expect(content).toContain("Some existing instructions.");
      expect(content).toContain(SECTION_START);
    });

    it("does not create CLAUDE.md when generateClaudeMd is disabled", () => {
      (vscode.workspace as any).getConfiguration = jest.fn().mockReturnValue({
        get: jest
          .fn()
          .mockImplementation((key: string) => key !== "generateClaudeMd"),
      });

      createAIInstructions(root);

      expect(fs.existsSync(claudePath())).toBe(false);
    });
  });
});
