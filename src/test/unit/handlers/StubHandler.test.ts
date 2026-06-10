import { StubHandler } from "../../../webview/handlers/StubHandler";
import * as childProcess from "child_process";
import * as fs from "fs";
import { configureWorkspaceStubs } from "../../../stubs/PylanceConfig";
import { findPython } from "../../../webview/utils";
import * as vscode from "vscode";
import {
  BOARD_CODE_SUPPORT_SUBFOLDER,
  CODE_SUPPORT_FOLDER,
} from "../../../types/constants";

jest.mock("child_process");
jest.mock("fs");
jest.mock("../../../webview/utils");
jest.mock("../../../stubs/PylanceConfig");
jest.mock("../../../stubs/StubGenerator", () => ({
  StubGenerator: jest.fn().mockImplementation(() => ({
    generateFromGithub: jest
      .fn()
      .mockResolvedValue({ message: "Generated 3 stubs.", readmeFound: true }),
  })),
}));
jest.mock("../../../device/manifest", () => ({
  readManifest: jest.fn().mockResolvedValue({ packages: {} }),
}));

jest.mock("util");

const mockExec = childProcess.exec as unknown as jest.Mock;
const mockFsExistsSync = fs.existsSync as jest.MockedFunction<
  typeof fs.existsSync
>;
const mockFindPython = findPython as jest.MockedFunction<typeof findPython>;
const mockConfigureWorkspaceStubs =
  configureWorkspaceStubs as jest.MockedFunction<
    typeof configureWorkspaceStubs
  >;

function makeConnectionManager(port = "/dev/ttyUSB0") {
  return {
    getDevice: jest.fn().mockReturnValue({
      readManifest: jest.fn().mockResolvedValue({ packages: {} }),
    }),
    _port: port,
  } as any;
}

function makeCodeSupportHandler() {
  return {
    updateCodeSupport: jest.fn(),
  } as any;
}

describe("StubHandler", () => {
  let handler: StubHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    handler = new StubHandler(
      makeConnectionManager(),
      makeCodeSupportHandler(),
    );
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: "/workspace" } },
    ];
    (vscode.workspace as any).getConfiguration = jest.fn().mockReturnValue({
      get: jest.fn().mockReturnValue(true),
    });
    // Default: stubs directory does not exist yet
    mockFsExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("autoInstallBoardStubs", () => {
    it("does nothing when autoInstallBoardCodeSupport is disabled", async () => {
      (vscode.workspace as any).getConfiguration = jest.fn().mockReturnValue({
        get: jest.fn().mockReturnValue(false),
      });

      const promise = handler.autoInstallBoardStubs(
        "micropython-esp32-stubs",
        "nano-esp32",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(mockExec).not.toHaveBeenCalled();
    });

    it("shows notification with Disable button when package is newly installed", async () => {
      mockFindPython.mockResolvedValue("python");
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
        cb(null, "Successfully installed micropython-esp32-stubs-0.16.0\n", "");
        return {} as any;
      });

      const promise = handler.autoInstallBoardStubs(
        "micropython-esp32-stubs",
        "nano-esp32",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "✓ Board code support updated.",
        "Disable Auto-Install",
      );
    });

    it("configures workspace stubs and skips install when stubs directory already exists", async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFindPython.mockResolvedValue("python");

      const promise = handler.autoInstallBoardStubs(
        "micropython-esp32-stubs",
        "nano-esp32",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(mockExec).not.toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(mockConfigureWorkspaceStubs).toHaveBeenCalledWith(
        "/workspace",
        `${CODE_SUPPORT_FOLDER}/${BOARD_CODE_SUPPORT_SUBFOLDER}/nano-esp32`,
      );
    });

    it("opens settings when Disable Auto-Install is clicked", async () => {
      mockFindPython.mockResolvedValue("python");
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
        cb(null, "Successfully installed micropython-esp32-stubs-0.16.0\n", "");
        return {} as any;
      });
      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(
        "Disable Auto-Install",
      );

      const promise = handler.autoInstallBoardStubs(
        "micropython-esp32-stubs",
        "nano-esp32",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.openSettings",
        "micropython-for-arduino.autoInstallBoardCodeSupport",
      );
    });

    it("shows error message when pip fails", async () => {
      mockFindPython.mockResolvedValue("python");
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
        cb(new Error("network error"), "", "");
        return {} as any;
      });

      const promise = handler.autoInstallBoardStubs(
        "micropython-esp32-stubs",
        "nano-esp32",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Board code support setup failed"),
      );
    });

    it("configures workspace stubs after successful install", async () => {
      mockFindPython.mockResolvedValue("python");
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
        cb(null, "Successfully installed micropython-esp32-stubs-0.16.0\n", "");
        return {} as any;
      });

      const promise = handler.autoInstallBoardStubs(
        "micropython-esp32-stubs",
        "nano-esp32",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(mockConfigureWorkspaceStubs).toHaveBeenCalledWith(
        "/workspace",
        `${CODE_SUPPORT_FOLDER}/${BOARD_CODE_SUPPORT_SUBFOLDER}/nano-esp32`,
      );
    });

    it("uses board-specific target directory in pip install command", async () => {
      mockFindPython.mockResolvedValue("python");
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
        cb(null, "Successfully installed micropython-rp2-stubs-0.1.0\n", "");
        return {} as any;
      });

      const promise = handler.autoInstallBoardStubs(
        "micropython-rp2-arduino_nano_rp2040_connect-stubs",
        "rp2040-connect",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("--target"),
        expect.objectContaining({ timeout: 120000 }),
        expect.any(Function),
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining("rp2040-connect"),
        expect.anything(),
        expect.anything(),
      );
    });

    it("configures rp2040 stubs path when rp2040 board connects", async () => {
      mockFindPython.mockResolvedValue("python");
      mockExec.mockImplementation((_cmd: string, _opts: any, cb: any) => {
        cb(
          null,
          "Successfully installed micropython-rp2-arduino_nano_rp2040_connect-stubs-0.1.0\n",
          "",
        );
        return {} as any;
      });

      const promise = handler.autoInstallBoardStubs(
        "micropython-rp2-arduino_nano_rp2040_connect-stubs",
        "rp2040-connect",
      );
      await jest.runAllTimersAsync();
      await promise;

      expect(mockConfigureWorkspaceStubs).toHaveBeenCalledWith(
        "/workspace",
        `${CODE_SUPPORT_FOLDER}/${BOARD_CODE_SUPPORT_SUBFOLDER}/rp2040-connect`,
      );
    });
  });

  describe("generateLibraryCodeSupport", () => {
    it("shows the message from StubGenerator result", async () => {
      const result = await handler.generateLibraryCodeSupport("/dev/ttyUSB0");

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "Generated 3 stubs.",
      );
      expect(result).toBe(true);
    });

    it("shows error when no workspace is open", async () => {
      (vscode.workspace as any).workspaceFolders = undefined;

      const result = await handler.generateLibraryCodeSupport("/dev/ttyUSB0");

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "No workspace open.",
      );
      expect(result).toBe(false);
    });

    it("returns false when readmeFound is false", async () => {
      const { StubGenerator } = jest.requireMock(
        "../../../stubs/StubGenerator",
      );
      StubGenerator.mockImplementation(() => ({
        generateFromGithub: jest.fn().mockResolvedValue({
          message: "Generated 0 stubs.",
          readmeFound: false,
        }),
      }));
      const localHandler = new StubHandler(
        makeConnectionManager(),
        makeCodeSupportHandler(),
      );

      const result =
        await localHandler.generateLibraryCodeSupport("/dev/ttyUSB0");

      expect(result).toBe(false);
    });

    it("skips readManifest when manifest is provided", async () => {
      const connectionManager = makeConnectionManager();
      const localHandler = new StubHandler(
        connectionManager,
        makeCodeSupportHandler(),
      );
      const manifest = { packages: { someLib: "1.0.0" } };

      await localHandler.generateLibraryCodeSupport(
        "/dev/ttyUSB0",
        manifest as any,
      );

      expect(connectionManager.getDevice).not.toHaveBeenCalled();
    });

    it("calls readManifest when no manifest is provided", async () => {
      const connectionManager = makeConnectionManager();
      const localHandler = new StubHandler(
        connectionManager,
        makeCodeSupportHandler(),
      );

      await localHandler.generateLibraryCodeSupport("/dev/ttyUSB0");

      expect(connectionManager.getDevice).toHaveBeenCalledWith("/dev/ttyUSB0");
    });
  });
});
