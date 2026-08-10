import { LibraryHandler } from "../../../webview/handlers/LibraryHandler";
import * as vscode from "vscode";
import * as fs from "fs";
import { Sender } from "../../../webview/WebviewGateway";
import { removeStubsExtraPath } from "../../../stubs/PylanceConfig";
import { getPackageList } from "../../../device/operation/packageRegistry";

jest.mock("fs");
jest.mock("../../../stubs/PylanceConfig", () => ({
  removeStubsExtraPath: jest.fn(),
}));
jest.mock("../../../device/operation/packageRegistry", () => ({
  getPackageList: jest.fn(),
}));

function makeSend(): jest.MockedFunction<Sender> {
  return jest.fn() as unknown as jest.MockedFunction<Sender>;
}

function makeCodeSupportHandler() {
  return {
    updateCodeSupport: jest.fn(),
  } as any;
}

const PORT = "COM3";
const LIBRARY_ID = "mylib-id";
const DISPLAY_NAME = "My Library";
const LIBRARY_URL = "https://github.com/owner/repo";

function makeConnectionManager(deviceOverrides: Record<string, unknown> = {}) {
  const device = {
    fetchLibraries: jest.fn().mockResolvedValue([]),
    installLibrary: jest.fn().mockResolvedValue(null),
    uninstallLibrary: jest.fn().mockResolvedValue(null),
    ...deviceOverrides,
  };
  return {
    _device: device,
    getDevice: jest.fn().mockReturnValue(device),
  } as any;
}

describe("LibraryHandler", () => {
  let send: jest.MockedFunction<Sender>;

  beforeEach(() => {
    jest.clearAllMocks();
    send = makeSend();

    // Default workspace folder
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: "/workspace" } },
    ];

    // Default: user confirms uninstall, declines code support removal
    (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
      "Uninstall",
    );
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(
      "Keep",
    );
  });

  // ─── handleGetInstalledLibraries ──────────────────────────────────────────

  describe("handleGetInstalledLibraries", () => {
    it("sends the installed libraries list", async () => {
      const cm = makeConnectionManager({
        fetchLibraries: jest
          .fn()
          .mockResolvedValue([{ name: "mylib", version: "1.0" }]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleGetInstalledLibraries(PORT, send);

      expect(send).toHaveBeenCalledWith({
        type: "installedLibraries",
        value: [{ name: "mylib", version: "1.0" }],
        port: PORT,
      });
    });
  });

  // ─── handleInstallLibrary ─────────────────────────────────────────────────

  describe("handleInstallLibrary", () => {
    it("sends installedLibraries and installResult success, calls onLibraryInstalled with filtered manifest", async () => {
      // The real code filters packages by url match, so both packages need a url field
      const manifest = {
        packages: {
          mylib: { version: "1.0", url: LIBRARY_URL },
          otherlib: { version: "2.0", url: "https://github.com/owner/other" },
        },
      };
      const items = [{ name: "mylib", version: "1.0" }];
      const onLibraryInstalled = jest.fn().mockResolvedValue(false);
      const cm = makeConnectionManager({
        installLibrary: jest.fn().mockResolvedValue({ items, manifest }),
      });
      const handler = new LibraryHandler(
        cm,
        makeCodeSupportHandler(),
        onLibraryInstalled,
      );

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      // installedLibraries sent before installResult
      expect(send).toHaveBeenCalledWith({
        type: "installedLibraries",
        value: items,
        port: PORT,
      });
      expect(send).toHaveBeenCalledWith({
        type: "installResult",
        success: true,
      });

      // manifest is filtered to only the package whose url matches
      expect(onLibraryInstalled).toHaveBeenCalledWith(PORT, {
        ...manifest,
        packages: {
          mylib: { version: "1.0", url: LIBRARY_URL },
        },
      });
    });

    it("uses displayName from manifest package when available", async () => {
      const onLibraryInstalled = jest.fn().mockResolvedValue(true);
      const manifest = {
        packages: {
          mylib: {
            version: "1.0",
            url: LIBRARY_URL,
            displayName: DISPLAY_NAME,
          },
        },
      };
      const cm = makeConnectionManager({
        installLibrary: jest.fn().mockResolvedValue({ items: [], manifest }),
      });
      const handler = new LibraryHandler(
        cm,
        makeCodeSupportHandler(),
        onLibraryInstalled,
      );

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      // README path should use the displayName, not the original name arg
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "markdown.showPreview",
        expect.objectContaining({
          fsPath: expect.stringContaining(DISPLAY_NAME),
        }),
      );
    });

    it("opens README preview when onLibraryInstalled returns true", async () => {
      const onLibraryInstalled = jest.fn().mockResolvedValue(true);
      const manifest = {
        packages: {
          mylib: { version: "1.0", url: LIBRARY_URL },
        },
      };
      const cm = makeConnectionManager({
        installLibrary: jest.fn().mockResolvedValue({ items: [], manifest }),
      });
      const handler = new LibraryHandler(
        cm,
        makeCodeSupportHandler(),
        onLibraryInstalled,
      );

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "markdown.showPreview",
        expect.objectContaining({
          fsPath: expect.stringContaining("mylib"),
        }),
      );
    });

    it("does not open README preview when onLibraryInstalled returns false", async () => {
      const onLibraryInstalled = jest.fn().mockResolvedValue(false);
      const manifest = {
        packages: {
          mylib: { version: "1.0", url: LIBRARY_URL },
        },
      };
      const cm = makeConnectionManager({
        installLibrary: jest.fn().mockResolvedValue({ items: [], manifest }),
      });
      const handler = new LibraryHandler(
        cm,
        makeCodeSupportHandler(),
        onLibraryInstalled,
      );

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
        "markdown.showPreview",
        expect.anything(),
      );
    });

    it("does not send installedLibraries when installLibrary returns null", async () => {
      const cm = makeConnectionManager({
        installLibrary: jest.fn().mockResolvedValue(null),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "installedLibraries" }),
      );
    });

    it("sends installResult false and does not call onLibraryInstalled on error", async () => {
      const onLibraryInstalled = jest.fn();
      const cm = makeConnectionManager({
        installLibrary: jest
          .fn()
          .mockRejectedValue(new Error("package not found")),
      });
      const handler = new LibraryHandler(
        cm,
        makeCodeSupportHandler(),
        onLibraryInstalled,
      );

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      expect(send).toHaveBeenCalledWith({
        type: "installResult",
        success: false,
      });
      expect(onLibraryInstalled).not.toHaveBeenCalled();
    });

    it("shows error message when installation fails", async () => {
      const cm = makeConnectionManager({
        installLibrary: jest
          .fn()
          .mockRejectedValue(new Error("network timeout")),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleInstallLibrary("mylib", LIBRARY_URL, PORT, send);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("network timeout"),
      );
    });
  });

  // ─── handleUninstallLibrary ───────────────────────────────────────────────

  describe("handleUninstallLibrary", () => {
    it("sends uninstallResult false and skips uninstall when user cancels confirmation", async () => {
      (vscode.window.showWarningMessage as jest.Mock).mockResolvedValue(
        undefined,
      );
      const cm = makeConnectionManager();
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(cm.getDevice).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith({
        type: "uninstallResult",
        success: false,
      });
    });

    it("shows displayName in the confirmation dialog", async () => {
      const cm = makeConnectionManager();
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining(DISPLAY_NAME),
        expect.anything(),
        "Uninstall",
      );
    });

    it("sends installedLibraries update and uninstallResult success after uninstall", async () => {
      const updatedItems = [{ name: "otherlib", version: "1.0" }];
      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue(updatedItems),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(send).toHaveBeenCalledWith({
        type: "installedLibraries",
        value: updatedItems,
        port: PORT,
      });
      expect(send).toHaveBeenCalledWith({
        type: "uninstallResult",
        success: true,
      });
    });

    it("calls uninstallLibrary with the library id", async () => {
      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue([]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(cm._device.uninstallLibrary).toHaveBeenCalledWith(LIBRARY_ID);
    });

    it("shows success message with displayName after uninstall", async () => {
      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue([]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining(DISPLAY_NAME),
      );
    });

    it("removes Code Support files and stubs path when user chooses Remove", async () => {
      (vscode.window.showInformationMessage as jest.Mock)
        .mockResolvedValueOnce(undefined) // ✓ uninstalled toast (no buttons)
        .mockResolvedValueOnce("Remove"); // Code Support dialog
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue([]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining(DISPLAY_NAME),
        { recursive: true, force: true },
      );
      expect(removeStubsExtraPath).toHaveBeenCalledWith(
        "/workspace",
        DISPLAY_NAME,
      );
    });

    it("does not remove Code Support files when user chooses Keep", async () => {
      (vscode.window.showInformationMessage as jest.Mock)
        .mockResolvedValueOnce(undefined) // ✓ uninstalled toast
        .mockResolvedValueOnce("Keep"); // Code Support dialog

      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue([]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(fs.rmSync).not.toHaveBeenCalled();
      expect(removeStubsExtraPath).not.toHaveBeenCalled();
    });

    it("Code Support dialog shows displayName", async () => {
      (vscode.window.showInformationMessage as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce("Keep");
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue([]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      const infoMock = vscode.window.showInformationMessage as jest.Mock;
      const codeSupportCall = infoMock.mock.calls.find((args) =>
        args[0]?.includes("Code Support"),
      );
      expect(codeSupportCall?.[0]).toContain(DISPLAY_NAME);
    });

    it("sends uninstallResult false and shows error when uninstall throws", async () => {
      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockRejectedValue(new Error("device busy")),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      expect(send).toHaveBeenCalledWith({
        type: "uninstallResult",
        success: false,
      });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("device busy"),
      );
    });

    it("skips Code Support prompt when no workspace folder is open", async () => {
      (vscode.workspace as any).workspaceFolders = undefined;
      const cm = makeConnectionManager({
        uninstallLibrary: jest.fn().mockResolvedValue([]),
      });
      const handler = new LibraryHandler(cm, makeCodeSupportHandler());

      await handler.handleUninstallLibrary(
        LIBRARY_ID,
        DISPLAY_NAME,
        PORT,
        send,
      );

      // showInformationMessage only called once (the ✓ uninstalled toast, not the Code Support dialog)
      const infoMock = vscode.window.showInformationMessage as jest.Mock;
      const codeSupportCall = infoMock.mock.calls.find((args) =>
        args[0]?.includes("Code Support"),
      );
      expect(codeSupportCall).toBeUndefined();
    });
  });

  describe("handleGetLibraries()", () => {
    it("sends the loaded package list", async () => {
      const libraries = [{ name: "modulino" }];
      (getPackageList as jest.Mock).mockResolvedValue(libraries);
      const handler = new LibraryHandler(
        makeConnectionManager(),
        makeCodeSupportHandler(),
      );
      const send = makeSend();

      await handler.handleGetLibraries(send);

      expect(send).toHaveBeenCalledWith({
        type: "libraries",
        value: libraries,
      });
    });

    it("sends an error message so the webview can offer a reload", async () => {
      (getPackageList as jest.Mock).mockRejectedValue(new Error("offline"));
      const handler = new LibraryHandler(
        makeConnectionManager(),
        makeCodeSupportHandler(),
      );
      const send = makeSend();

      await handler.handleGetLibraries(send);

      expect(send).toHaveBeenCalledWith({
        type: "libraries",
        value: [],
        error: "offline",
      });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("offline"),
      );
    });
  });
});
