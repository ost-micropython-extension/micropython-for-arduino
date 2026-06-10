import * as path from "path";
import * as fs from "fs";
import { CodeSupportHandler } from "../../../webview/handlers/CodeSupportHandler";
import * as vscode from "vscode";
import {
  CODE_SUPPORT_FOLDER,
  BOARD_CODE_SUPPORT_SUBFOLDER,
} from "../../../types/constants";

jest.mock("fs");

// ── Helpers ──────────────────────────────────────────────────────────────────

const WS = "/workspace";

function makeSend() {
  return jest.fn();
}

function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

/** Stubs fs calls. Uses path.join to match production code on all platforms. */
function setupFs({
  codeSupportDirs = [] as string[],
  settingsJson = undefined as string | undefined,
} = {}) {
  const codeSupportRoot = path.join(WS, CODE_SUPPORT_FOLDER);
  const settingsPath = path.join(WS, ".vscode", "settings.json");

  (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
    if (p === codeSupportRoot) {
      return codeSupportDirs.length > 0;
    }
    if (p === settingsPath) {
      return settingsJson !== undefined;
    }
    return false;
  });

  (fs.readdirSync as jest.Mock).mockReturnValue(
    codeSupportDirs.map((name) => makeDirent(name, true)),
  );

  if (settingsJson !== undefined) {
    (fs.readFileSync as jest.Mock).mockReturnValue(settingsJson);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CodeSupportHandler", () => {
  let handler: CodeSupportHandler;
  let send: ReturnType<typeof makeSend>;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new CodeSupportHandler();
    send = makeSend();

    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: WS } }];
  });

  // ── updateCodeSupport: _libCache ─────────────────────────────────────────────

  describe("updateCodeSupport() — library cache", () => {
    it("sends a codeSupport message with the provided libs", () => {
      setupFs();
      handler.updateCodeSupport(send, ["mylib"]);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "codeSupport" }),
      );
    });

    it("uses the cached libs list when called without arguments on the second call", () => {
      setupFs();
      handler.updateCodeSupport(send, ["mylib"]);
      send.mockClear();

      handler.updateCodeSupport(send);

      const msg = send.mock.calls[0][0];
      expect(msg.value.some((i: any) => i.displayName === "mylib")).toBe(true);
    });

    it("returns an empty value array when no workspace is open", () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      handler.updateCodeSupport(send, []);
      expect(send).toHaveBeenCalledWith({ type: "codeSupport", value: [] });
    });
  });

  // ── _getCodeSupportItems: installed libs ──────────────────────────────────────

  describe("_getCodeSupportItems() — installed libraries", () => {
    it("marks a library as installed:true when it appears in installedLibs", () => {
      setupFs();
      handler.updateCodeSupport(send, ["mylib"]);
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "mylib",
      );
      expect(item?.installed).toBe(true);
    });

    it("marks a library as installed:false when it is only in the codesupport folder", () => {
      setupFs({ codeSupportDirs: ["mylib"] });
      handler.updateCodeSupport(send, []); // not installed
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "mylib",
      );
      expect(item?.installed).toBe(false);
      expect(item?.codesupport).toBe(true);
    });
  });

  // ── _getCodeSupportItems: codesupport folder ──────────────────────────────────

  describe("_getCodeSupportItems() — codesupport directories", () => {
    it("marks a library as codesupport:true when its folder exists", () => {
      setupFs({ codeSupportDirs: ["sensor"] });
      handler.updateCodeSupport(send, ["sensor"]);
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "sensor",
      );
      expect(item?.codesupport).toBe(true);
    });

    it("excludes the boards/ subfolder from the codesupport list", () => {
      setupFs({ codeSupportDirs: [BOARD_CODE_SUPPORT_SUBFOLDER, "sensor"] });
      handler.updateCodeSupport(send, []);
      const names = send.mock.calls[0][0].value.map((i: any) => i.displayName);
      expect(names).not.toContain(BOARD_CODE_SUPPORT_SUBFOLDER);
      expect(names).toContain("sensor");
    });
  });

  // ── _getCodeSupportItems: active paths from settings.json ─────────────────────

  describe("_getCodeSupportItems() — active extraPaths from settings.json", () => {
    it("marks a library as active:true when its path appears in python.analysis.extraPaths", () => {
      setupFs({
        codeSupportDirs: ["sensor"],
        settingsJson: JSON.stringify({
          "python.analysis.extraPaths": [`./${CODE_SUPPORT_FOLDER}/sensor`],
        }),
      });
      handler.updateCodeSupport(send, ["sensor"]);
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "sensor",
      );
      expect(item?.active).toBe(true);
    });

    it("marks a library as active:false when it is NOT in extraPaths", () => {
      setupFs({ codeSupportDirs: ["sensor"] });
      handler.updateCodeSupport(send, ["sensor"]);
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "sensor",
      );
      expect(item?.active).toBe(false);
    });

    it("strips // comments from settings.json before JSON.parse", () => {
      const jsonWithComments = [
        "{",
        `  // this is a comment`,
        `  "python.analysis.extraPaths": ["./${CODE_SUPPORT_FOLDER}/sensor"]`,
        "}",
      ].join("\n");

      setupFs({
        codeSupportDirs: ["sensor"],
        settingsJson: jsonWithComments,
      });
      handler.updateCodeSupport(send, ["sensor"]);
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "sensor",
      );
      expect(item?.active).toBe(true);
    });

    it("treats malformed settings.json as no active paths (no crash)", () => {
      setupFs({
        codeSupportDirs: ["sensor"],
        settingsJson: "{ this is not valid json }",
      });
      expect(() => handler.updateCodeSupport(send, ["sensor"])).not.toThrow();
      const item = send.mock.calls[0][0].value.find(
        (i: any) => i.displayName === "sensor",
      );
      expect(item?.active).toBe(false);
    });

    it("does not create an active item for paths pointing into the boards/ subfolder", () => {
      setupFs({
        settingsJson: JSON.stringify({
          "python.analysis.extraPaths": [
            `./${CODE_SUPPORT_FOLDER}/${BOARD_CODE_SUPPORT_SUBFOLDER}/nano`,
          ],
        }),
      });
      handler.updateCodeSupport(send, []);
      const names = send.mock.calls[0][0].value.map((i: any) => i.displayName);
      expect(names).not.toContain("nano");
    });
  });
});
