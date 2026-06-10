import * as vscode from "vscode";
import { BoardActionHandler } from "../../../webview/handlers/BoardActionHandler";
import { WebviewMessage } from "../../../types/messages";
import { Sender } from "../../../webview/WebviewGateway";

// ── Helpers ───────────────────────────────────────────────────────────────────

const PORT = "COM3";

function makeSender(): Sender {
  return jest.fn() as unknown as Sender;
}

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    openRepl: jest.fn(),
    runFile: jest.fn(),
    runFileWhileMount: jest.fn().mockResolvedValue(undefined),
    runCode: jest.fn().mockResolvedValue(undefined),
    stopExecution: jest.fn(),
    softReset: jest.fn(),
    mountActive: false,
    ...overrides,
  };
}

function makeConnectionManager(deviceOverrides: Record<string, unknown> = {}) {
  const device = makeDevice(deviceOverrides);

  return {
    _device: device,
    getPorts: jest.fn().mockResolvedValue([]),
    getDevice: jest.fn().mockReturnValue(device),
  } as any;
}

function makeEditor(fsPath: string, isDirty = false) {
  return {
    document: {
      uri: { fsPath },
      isDirty,
      isUntitled: false,
      getText: jest.fn().mockReturnValue("code"),
      save: jest.fn().mockResolvedValue(true),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.window as any).activeTextEditor = undefined;
  (vscode.workspace as any).workspaceFolders = [
    { uri: { fsPath: "/workspace" } },
  ];
});

// ── handleGetPorts ────────────────────────────────────────────────────────────

describe("BoardActionHandler.handleGetPorts()", () => {
  it("sends the mapped port list to the webview", async () => {
    const cm = makeConnectionManager();
    cm.getPorts.mockResolvedValue([
      { path: "COM3", description: "Arduino", hasMicroPython: true },
    ]);

    const send = makeSender();
    const handler = new BoardActionHandler(cm);

    await handler.handleGetPorts({ type: "getPorts" } as WebviewMessage, send);

    expect(send).toHaveBeenCalledWith({
      type: "ports",
      value: [{ path: "COM3", description: "Arduino", hasMicroPython: true }],
    });
  });

  it("sends an empty ports list when getPorts throws", async () => {
    const cm = makeConnectionManager();
    cm.getPorts.mockRejectedValue(new Error("no serial"));

    const send = makeSender();
    const handler = new BoardActionHandler(cm);

    await handler.handleGetPorts({ type: "getPorts" } as WebviewMessage, send);

    expect(send).toHaveBeenCalledWith({ type: "ports", value: [] });
  });

  it("shows an error message when getPorts throws", async () => {
    const cm = makeConnectionManager();
    cm.getPorts.mockRejectedValue(new Error("no serial"));

    const handler = new BoardActionHandler(cm);

    await handler.handleGetPorts(
      { type: "getPorts" } as WebviewMessage,
      makeSender(),
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("no serial"),
    );
  });
});

// ── handleConnectRepl ─────────────────────────────────────────────────────────

describe("BoardActionHandler.handleConnectRepl()", () => {
  it("calls openRepl() on the device", () => {
    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    handler.handleConnectRepl(PORT);

    expect(cm._device.openRepl).toHaveBeenCalled();
  });

  it("shows an error message when openRepl throws", () => {
    const cm = makeConnectionManager({
      openRepl: jest.fn(() => {
        throw new Error("No connected Device");
      }),
    });

    const handler = new BoardActionHandler(cm);

    handler.handleConnectRepl(PORT);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("No connected Device"),
    );
  });
});

// ── handleRunFile ─────────────────────────────────────────────────────────────

describe("BoardActionHandler.handleRunFile()", () => {
  it("shows error when no active editor", async () => {
    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleRunFile(PORT);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("No file open"),
    );
  });

  it("shows warning when not a python file", async () => {
    (vscode.window as any).activeTextEditor = makeEditor("/workspace/main.js");

    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleRunFile(PORT);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining(".py"),
    );
  });

  it("does not save when clean", async () => {
    const editor = makeEditor("/workspace/main.py", false);
    (vscode.window as any).activeTextEditor = editor;

    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleRunFile(PORT);

    expect(editor.document.save).not.toHaveBeenCalled();
  });

  it("uses runFileWhileMount when mountActive is true", async () => {
    const editor = makeEditor("/workspace/main.py");
    (vscode.window as any).activeTextEditor = editor;

    const cm = makeConnectionManager({
      mountActive: true,
      runFileWhileMount: jest.fn().mockResolvedValue(undefined),
    });

    const handler = new BoardActionHandler(cm);

    await handler.handleRunFile(PORT);

    expect(cm._device.runFileWhileMount).toHaveBeenCalledWith(
      "/workspace/main.py",
      "code",
    );
  });

  it("runs code when not mounted", async () => {
    const editor = makeEditor("/workspace/main.py");
    (vscode.window as any).activeTextEditor = editor;

    const cm = makeConnectionManager({
      mountActive: false,
    });

    const handler = new BoardActionHandler(cm);

    await handler.handleRunFile(PORT);

    expect(cm._device.runCode).toHaveBeenCalledWith("code", "main.py");
  });

  it("shows error when runCode throws", async () => {
    const editor = makeEditor("/workspace/main.py");
    (vscode.window as any).activeTextEditor = editor;

    const cm = makeConnectionManager({
      runCode: jest.fn().mockRejectedValue(new Error("board busy")),
    });

    const handler = new BoardActionHandler(cm);

    await handler.handleRunFile(PORT);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("board busy"),
    );
  });
});

// ── handleRunSelection ────────────────────────────────────────────────────────

describe("BoardActionHandler.handleRunSelection()", () => {
  function makeSelectionEditor(selectedText: string) {
    return {
      selection: {
        start: { line: 0, character: 0 },
      },
      document: {
        getText: jest.fn((selection?: any) => {
          if (!selection) {
            return "";
          }
          return selectedText;
        }),
        lineAt: jest.fn((line: number) => ({
          text: selectedText.split("\n")[line] ?? "",
        })),
      },
    };
  }

  it("shows error when no editor", async () => {
    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleRunSelection(PORT);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("No file open"),
    );
  });

  it("warns when empty selection", async () => {
    (vscode.window as any).activeTextEditor = makeSelectionEditor("   ");

    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleRunSelection(PORT);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("No code selected"),
    );
  });

  it("runs selected code", async () => {
    (vscode.window as any).activeTextEditor =
      makeSelectionEditor("print('hello')");

    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleRunSelection(PORT);

    expect(cm._device.runCode).toHaveBeenCalled();
  });
});

// ── handleSoftReset ───────────────────────────────────────────────────────────

describe("BoardActionHandler.handleSoftReset()", () => {
  it("calls softReset", async () => {
    const cm = makeConnectionManager();
    const handler = new BoardActionHandler(cm);

    await handler.handleSoftReset(PORT);

    expect(cm._device.softReset).toHaveBeenCalled();
  });
});

// ── fixIndentation (via handleRunSelection) ───────────────────────────────────
//
// fixIndentation is a private module-level function exercised through
// handleRunSelection. These tests verify the indentation-stripping logic.

describe("fixIndentation (via handleRunSelection)", () => {
  function makeIndentEditor(selectedText: string, firstLineOverride?: string) {
    const firstLine = firstLineOverride ?? selectedText.split("\n")[0];
    return {
      selection: { start: { line: 0, character: 0 } },
      document: {
        getText: jest.fn((sel?: unknown) => (sel ? selectedText : "")),
        lineAt: jest.fn(() => ({ text: firstLine })),
      },
    };
  }

  it("passes code to runCode unchanged when the first line has no leading indent", async () => {
    (vscode.window as any).activeTextEditor = makeIndentEditor(
      "print('hello')\nprint('world')",
    );
    const cm = makeConnectionManager();
    await new BoardActionHandler(cm).handleRunSelection(PORT);
    expect(cm._device.runCode).toHaveBeenCalledWith(
      "print('hello')\nprint('world')",
    );
  });

  it("strips the common leading indentation from all non-empty lines", async () => {
    (vscode.window as any).activeTextEditor = makeIndentEditor(
      "  if True:\n    pass\n  x = 1",
    );
    const cm = makeConnectionManager();
    await new BoardActionHandler(cm).handleRunSelection(PORT);
    expect(cm._device.runCode).toHaveBeenCalledWith("if True:\n  pass\nx = 1");
  });

  it("preserves empty lines without raising an indentation error", async () => {
    (vscode.window as any).activeTextEditor =
      makeIndentEditor("  a = 1\n\n  b = 2");
    const cm = makeConnectionManager();
    await new BoardActionHandler(cm).handleRunSelection(PORT);
    expect(cm._device.runCode).toHaveBeenCalledWith("a = 1\n\nb = 2");
  });

  it("shows an error and does NOT call runCode when indentation is inconsistent", async () => {
    // Line 1 has 2-space indent, line 2 has only 1 space — should throw
    (vscode.window as any).activeTextEditor =
      makeIndentEditor("  if True:\n x = 1");
    const cm = makeConnectionManager();
    await new BoardActionHandler(cm).handleRunSelection(PORT);
    expect(cm._device.runCode).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining("Inconsistent indentation"),
    );
  });
});
