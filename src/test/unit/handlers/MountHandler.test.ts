import * as vscode from "vscode";
import { MountHandler } from "../../../webview/handlers/MountHandler";
import { selectFolder } from "../../../webview/utils";

jest.mock("../../../webview/utils", () => ({
  selectFolder: jest.fn(),
}));

jest.mock("vscode", () => ({
  window: {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn(),
  },
}));

describe("MountHandler", () => {
  let handler: MountHandler;
  let mockConnectionManager: any;
  let mockDevice: any;
  let mockContext: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDevice = {
      mountActive: false,
      activateMount: jest.fn(),
      deactivateMount: jest.fn(),
    };

    mockConnectionManager = {
      getDevice: jest.fn().mockReturnValue(mockDevice),
    };

    mockContext = {
      globalState: {
        get: jest.fn().mockReturnValue(false),
        update: jest.fn(),
        setKeysForSync: jest.fn(),
      },
    };

    handler = new MountHandler(mockConnectionManager, mockContext);
  });

  describe("handleToggle", () => {
    it("should activate mount when mount is inactive", async () => {
      const spy = jest
        .spyOn(handler, "handleActivate")
        .mockResolvedValue(undefined);

      mockDevice.mountActive = false;

      await handler.handleToggle("COM3");

      expect(spy).toHaveBeenCalledWith("COM3");
    });

    it("should deactivate mount when mount is active", async () => {
      const spy = jest
        .spyOn(handler, "handleDeactivate")
        .mockResolvedValue(undefined);

      mockDevice.mountActive = true;

      await handler.handleToggle("COM3");

      expect(spy).toHaveBeenCalledWith("COM3");
    });

    it("should show error message when an exception occurs", async () => {
      mockConnectionManager.getDevice.mockImplementation(() => {
        throw new Error("Test error");
      });

      await handler.handleToggle("COM3");

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Failed to mount: Test error",
      );
    });
  });

  describe("handleActivate", () => {
    it("should return when no folder is selected", async () => {
      (selectFolder as jest.Mock).mockResolvedValue(undefined);

      await handler.handleActivate("COM3");

      expect(mockDevice.activateMount).not.toHaveBeenCalled();
    });

    it("should activate mount when folder is selected", async () => {
      (selectFolder as jest.Mock).mockResolvedValue("/test/folder");

      await handler.handleActivate("COM3");

      expect(mockDevice.activateMount).toHaveBeenCalledWith("/test/folder");
    });

    it("should not show dialog when doNotShowAgain is true", async () => {
      (selectFolder as jest.Mock).mockResolvedValue("/test/folder");

      mockContext.globalState.get.mockReturnValue(true);

      await handler.handleActivate("COM3");

      expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it("should show information dialog", async () => {
      (selectFolder as jest.Mock).mockResolvedValue("/test/folder");

      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(
        "Ok",
      );

      await handler.handleActivate("COM3");

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        "The board now has access to your local directory. Make sure to unmount before closing VS Code.",
        "Ok",
        "Don't show again",
      );
    });

    it("should store preference when user selects 'Don't show again'", async () => {
      (selectFolder as jest.Mock).mockResolvedValue("/test/folder");

      (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(
        "Don't show again",
      );

      await handler.handleActivate("COM3");

      expect(mockContext.globalState.setKeysForSync).toHaveBeenCalledWith([
        "activateMountDialog.doNotShowAgain",
      ]);

      expect(mockContext.globalState.update).toHaveBeenCalledWith(
        "activateMountDialog.doNotShowAgain",
        true,
      );
    });

    it("should show error message when activation fails", async () => {
      (selectFolder as jest.Mock).mockResolvedValue("/test/folder");

      mockDevice.activateMount.mockRejectedValue(new Error("Mount failed"));

      await handler.handleActivate("COM3");

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        "Mount failed",
      );
    });
  });

  describe("handleDeactivate", () => {
    it("should deactivate mount", async () => {
      await handler.handleDeactivate("COM3");

      expect(mockDevice.deactivateMount).toHaveBeenCalled();
    });
  });
});
