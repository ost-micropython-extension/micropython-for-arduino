import * as vscode from "vscode";
import * as https from "https";
import * as fs from "fs";
import { EventEmitter } from "events";

jest.mock("https");
jest.mock("fs");

const execMock = jest.fn();

jest.mock("child_process", () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

import {
  validateName,
  toGithubShorthand,
  fetchUrl,
  findPython,
  selectFolder,
  reportTransferProgress,
} from "../../webview/utils";

describe("validateName", () => {
  it("returns undefined for valid names", () => {
    expect(validateName("main.py")).toBeUndefined();
    expect(validateName("my_folder")).toBeUndefined();
    expect(validateName("file-1")).toBeUndefined();
  });

  it("rejects empty names", () => {
    expect(validateName("")).toBe("Name cannot be empty or whitespace.");
    expect(validateName("   ")).toBe("Name cannot be empty or whitespace.");
    expect(validateName("\t")).toBe("Name cannot be empty or whitespace.");
  });

  it.each(["/", "\\", ":", "*", "?", '"', "<", ">", "|"])(
    "rejects illegal character %s",
    (char) => {
      expect(validateName(`file${char}name`)).toBe(
        'Name contains illegal characters: \\ / : * ? " < > |',
      );
    },
  );
});

describe("toGithubShorthand", () => {
  it("converts github urls", () => {
    expect(toGithubShorthand("https://github.com/owner/repo")).toBe(
      "github:owner/repo",
    );
  });

  it("removes .git suffix", () => {
    expect(toGithubShorthand("https://github.com/owner/repo.git")).toBe(
      "github:owner/repo",
    );
  });

  it("supports http urls", () => {
    expect(toGithubShorthand("http://github.com/owner/repo")).toBe(
      "github:owner/repo",
    );
  });

  it("returns non github urls unchanged", () => {
    expect(toGithubShorthand("https://gitlab.com/owner/repo")).toBe(
      "https://gitlab.com/owner/repo",
    );
  });

  it("returns package names unchanged", () => {
    expect(toGithubShorthand("umqtt.simple")).toBe("umqtt.simple");
  });
});

describe("fetchUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns response body", async () => {
    (https.get as jest.Mock).mockImplementation((_url, _opts, callback) => {
      const res = new EventEmitter() as any;

      res.statusCode = 200;

      callback(res);

      process.nextTick(() => {
        res.emit("data", "hello ");
        res.emit("data", "world");
        res.emit("end");
      });

      return {
        setTimeout: jest.fn(),
        on: jest.fn(),
      };
    });

    await expect(fetchUrl("https://example.com")).resolves.toBe("hello world");
  });

  it("rejects on http error", async () => {
    (https.get as jest.Mock).mockImplementation((_url, _opts, callback) => {
      callback({
        statusCode: 404,
        statusMessage: "Not Found",
        headers: {},
      });

      return {
        setTimeout: jest.fn(),
        on: jest.fn(),
      };
    });

    await expect(fetchUrl("https://example.com")).rejects.toThrow("HTTP 404");
  });

  it("follows redirects", async () => {
    (https.get as jest.Mock)
      .mockImplementationOnce((_url, _opts, callback) => {
        callback({
          statusCode: 302,
          headers: {
            location: "https://redirected.com",
          },
        });

        return {
          setTimeout: jest.fn(),
          on: jest.fn(),
        };
      })
      .mockImplementationOnce((_url, _opts, callback) => {
        const res = new EventEmitter() as any;

        res.statusCode = 200;

        callback(res);

        process.nextTick(() => {
          res.emit("data", "ok");
          res.emit("end");
        });

        return {
          setTimeout: jest.fn(),
          on: jest.fn(),
        };
      });

    await expect(fetchUrl("https://example.com")).resolves.toBe("ok");
  });
});

describe("findPython", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses vscode python extension", async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
      isActive: true,
      exports: {
        settings: {
          getExecutionDetails: () => ({
            execCommand: ["/usr/bin/python3"],
          }),
        },
      },
    });

    await expect(findPython()).resolves.toBe("/usr/bin/python3");
  });

  it("activates extension if needed", async () => {
    const activate = jest.fn();

    (vscode.extensions.getExtension as jest.Mock).mockReturnValue({
      isActive: false,
      activate,
      exports: {
        settings: {
          getExecutionDetails: () => ({
            execCommand: ["/usr/bin/python3"],
          }),
        },
      },
    });

    await findPython();

    expect(activate).toHaveBeenCalled();
  });

  it("falls back to path lookup", async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

    execMock.mockImplementation((_cmd, _opts, callback) => {
      callback(null, "/usr/bin/python3\n", "");
    });

    await expect(findPython()).resolves.toBe("/usr/bin/python3");
  });

  it("throws if python cannot be found", async () => {
    (vscode.extensions.getExtension as jest.Mock).mockReturnValue(undefined);

    execMock.mockImplementation((_cmd, _opts, callback) => {
      callback(new Error("not found"), "", "");
    });

    await expect(findPython()).rejects.toThrow("Python not found");
  });
});

describe("selectFolder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows error if no workspace exists", async () => {
    (vscode.workspace as any).workspaceFolders = undefined;

    await selectFolder("Select folder");

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      "No workspace open",
    );
  });

  it("returns root folder when it is the only folder", async () => {
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: {
          fsPath: "/workspace",
        },
      },
    ];

    (fs.readdirSync as jest.Mock).mockReturnValue([]);

    await expect(selectFolder("Select folder")).resolves.toBe("/workspace");
  });

  it("returns selected folder from quickpick", async () => {
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: {
          fsPath: "/workspace",
        },
      },
    ];

    (fs.readdirSync as jest.Mock)
      .mockReturnValueOnce([
        {
          name: "src",
          isDirectory: () => true,
        },
      ])
      .mockReturnValueOnce([]);

    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      fullPath: "/workspace/src",
    });

    await expect(selectFolder("Select folder")).resolves.toBe("/workspace/src");
  });

  it("returns undefined when nothing is selected", async () => {
    (vscode.workspace as any).workspaceFolders = [
      {
        uri: {
          fsPath: "/workspace",
        },
      },
    ];

    (fs.readdirSync as jest.Mock)
      .mockReturnValueOnce([
        {
          name: "src",
          isDirectory: () => true,
        },
      ])
      .mockReturnValueOnce([]);

    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

    await expect(selectFolder("Select folder")).resolves.toBeUndefined();
  });
});

describe("reportTransferProgress", () => {
  function makeProgress() {
    return { report: jest.fn() };
  }

  it("reports the full increment on the first call", () => {
    const progress = makeProgress();
    const report = reportTransferProgress(progress);

    report(30);

    expect(progress.report).toHaveBeenCalledWith({
      increment: 30,
      message: "30%",
    });
  });

  it("reports only the delta on subsequent increasing calls", () => {
    const progress = makeProgress();
    const report = reportTransferProgress(progress);

    report(30);
    report(45);

    expect(progress.report).toHaveBeenLastCalledWith({
      increment: 15,
      message: "45%",
    });
  });

  it("never reports a negative increment when percent goes backwards", () => {
    const progress = makeProgress();
    const report = reportTransferProgress(progress);

    report(80);
    report(50); // out-of-order/decreasing update

    expect(progress.report).toHaveBeenLastCalledWith({
      increment: 0,
      message: "50%",
    });
  });

  it("keeps the baseline monotonic so a later increase can't push the cumulative total past 100%", () => {
    const progress = makeProgress();
    const report = reportTransferProgress(progress);

    report(80); // cumulative so far: 80
    report(50); // decreasing update, clamped to +0 (cumulative stays 80)
    report(90); // must add only 10, not 40, to stay at cumulative 90

    expect(progress.report).toHaveBeenLastCalledWith({
      increment: 10,
      message: "90%",
    });
  });

  it("clamps a percent above 100 to 100", () => {
    const progress = makeProgress();
    const report = reportTransferProgress(progress);

    report(140);

    expect(progress.report).toHaveBeenCalledWith({
      increment: 100,
      message: "100%",
    });
  });

  it("clamps a negative percent to 0", () => {
    const progress = makeProgress();
    const report = reportTransferProgress(progress);

    report(-10);

    expect(progress.report).toHaveBeenCalledWith({
      increment: 0,
      message: "0%",
    });
  });
});
