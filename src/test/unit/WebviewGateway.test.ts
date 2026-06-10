import * as vscode from "vscode";
import { WebviewGateway } from "../../webview/WebviewGateway";
import { ExtensionMessage } from "../../types/messages";

function makeWebviewView() {
  return {
    webview: {
      postMessage: jest.fn().mockResolvedValue(true),
    },
  } as unknown as vscode.WebviewView;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("WebviewGateway", () => {
  describe("register() + dispatch()", () => {
    it("calls the registered handler when a matching message is dispatched", async () => {
      const view = makeWebviewView();
      const gateway = new WebviewGateway(view);
      const handler = jest.fn().mockResolvedValue(undefined);

      gateway.register("getPorts", handler);
      gateway.dispatch({ type: "getPorts" });

      // handler is called asynchronously via Promise.resolve()
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith(
        { type: "getPorts" },
        expect.any(Function),
      );
    });

    it("does nothing when no handler is registered for the message type", () => {
      const view = makeWebviewView();
      const gateway = new WebviewGateway(view);

      expect(() =>
        gateway.dispatch({ type: "connect", port: "COM3" }),
      ).not.toThrow();
    });

    it("passes a sender function that calls postMessage", async () => {
      const view = makeWebviewView();
      const gateway = new WebviewGateway(view);

      let capturedSend: ((msg: ExtensionMessage) => void) | undefined;
      gateway.register("getPorts", (_msg, send) => {
        capturedSend = send;
      });
      gateway.dispatch({ type: "getPorts" });
      await Promise.resolve();

      capturedSend!({ type: "ports", value: [] });

      expect(view.webview.postMessage).toHaveBeenCalledWith({
        type: "ports",
        value: [],
      });
    });

    it("replaces an earlier handler when the same type is registered twice", async () => {
      const view = makeWebviewView();
      const gateway = new WebviewGateway(view);
      const first = jest.fn();
      const second = jest.fn();

      gateway.register("connect", first);
      gateway.register("connect", second);
      gateway.dispatch({ type: "connect", port: "COM3" });
      await Promise.resolve();

      expect(second).toHaveBeenCalled();
      expect(first).not.toHaveBeenCalled();
    });

    it("does not propagate handler errors to the caller", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});

      const view = makeWebviewView();
      const gateway = new WebviewGateway(view);

      gateway.register("connect", async () => {
        throw new Error("boom");
      });

      expect(() =>
        gateway.dispatch({ type: "connect", port: "COM3" }),
      ).not.toThrow();
      // let the rejected promise settle
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe("send()", () => {
    it("calls webview.postMessage with the provided message", () => {
      const view = makeWebviewView();
      const gateway = new WebviewGateway(view);
      const msg: ExtensionMessage = { type: "ports", value: [] };

      gateway.send(msg);

      expect(view.webview.postMessage).toHaveBeenCalledWith(msg);
    });
  });
});
