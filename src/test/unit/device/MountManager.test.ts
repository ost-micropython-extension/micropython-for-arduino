import * as vscode from "vscode";
import { MountManager } from "../../../device/MountManager";

describe("MountManager", () => {
  let terminal: any;

  beforeEach(() => {
    jest.clearAllMocks();

    terminal = {
      show: jest.fn(),
      sendText: jest.fn(),
      dispose: jest.fn(),
    };

    (vscode.window.createTerminal as jest.Mock).mockReturnValue(terminal);

    (vscode.window.onDidCloseTerminal as jest.Mock).mockReturnValue({
      dispose: jest.fn(),
    });

    (vscode.window as any).onDidEndTerminalShellExecution = jest
      .fn()
      .mockReturnValue({
        dispose: jest.fn(),
      });

    jest.spyOn(global, "setTimeout").mockImplementation((cb: any) => {
      cb();
      return 1 as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("starts inactive and clean", () => {
    const manager = new MountManager();

    expect(manager.isActive).toBe(false);
    expect(manager.isClean).toBe(true);
  });

  it("activates mount", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    expect(vscode.window.createTerminal).toHaveBeenCalled();

    expect(terminal.show).toHaveBeenCalled();

    expect(terminal.sendText).toHaveBeenCalledWith(
      'mpremote connect COM3 mount "/workspace" + repl',
      true,
    );

    expect(manager.isActive).toBe(true);
    expect(manager.isClean).toBe(false);
  });

  it("shows existing terminal when already active", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    jest.clearAllMocks();

    await manager.activate("COM4", "/other");

    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.show).toHaveBeenCalled();
  });

  it("sends command when active", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendCommand("print('hi')");

    expect(terminal.sendText).toHaveBeenCalledWith("print('hi')", true);
  });

  it("does not send command when inactive", () => {
    const manager = new MountManager();

    manager.sendCommand("print('hi')");

    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it("sends interrupt", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendInterrupt();

    expect(terminal.sendText).toHaveBeenCalled();
  });

  it("sends soft reset", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendSoftReset();

    expect(terminal.sendText).toHaveBeenCalled();
  });

  it("deactivates mount", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    await manager.deactivate();

    expect(manager.isActive).toBe(false);
    expect(manager.isClean).toBe(true);
    expect(terminal.dispose).toHaveBeenCalled();
  });

  it("dispose cleans up resources", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    await manager.dispose();

    expect(manager.isActive).toBe(false);
    expect(terminal.dispose).toHaveBeenCalled();
  });

  it("sendFile executes file inside workspace", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendFile("/workspace/src/test.py", "print('hello')");

    expect(terminal.sendText).toHaveBeenCalled();
  });

  it("sendFile falls back to code block for external files", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    const spy = jest.spyOn(manager, "sendCodeBlock");

    manager.sendFile("/other/test.py", "print('hello')");

    expect(spy).toHaveBeenCalledWith("print('hello')");
  });

  it("sendCodeBlock escapes non-ASCII characters as Python escapes", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendCodeBlock('print("ä €")');

    expect(terminal.sendText).toHaveBeenCalledWith(
      'print("\\xe4 \\u20ac")',
      false,
    );
  });

  it("sendCodeBlock escapes emojis as a single code point", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendCodeBlock('print("📦 Package is here!")');

    expect(terminal.sendText).toHaveBeenCalledWith(
      'print("\\U0001f4e6 Package is here!")',
      false,
    );
  });

  it("sendCodeBlock leaves pure ASCII code unchanged", async () => {
    const manager = new MountManager();

    await manager.activate("COM3", "/workspace");

    terminal.sendText.mockClear();

    manager.sendCodeBlock("print('hello')");

    expect(terminal.sendText).toHaveBeenCalledWith("print('hello')", false);
  });
});
