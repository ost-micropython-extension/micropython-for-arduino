import * as vscode from "vscode";
import { ExtensionMessage, WebviewMessage } from "../types/messages";

export type Sender = (msg: ExtensionMessage) => void;

export type MessageHandler<T extends WebviewMessage = WebviewMessage> = (
  msg: T,
  send: Sender,
) => Promise<void> | void;

/**
 * Gateway between extension host and webview
 */
export class WebviewGateway {
  private readonly _handlers = new Map<string, MessageHandler<any>>();

  constructor(private readonly _view: vscode.WebviewView) {}

  /**
   * Registers handler for message from webview
   */
  register<T extends WebviewMessage["type"]>(
    type: T,
    handler: MessageHandler<Extract<WebviewMessage, { type: T }>>,
  ): void {
    this._handlers.set(type, handler);
  }

  /**
   * Calls registered handler for received message
   */
  dispatch(msg: WebviewMessage): void {
    const handler = this._handlers.get(msg.type);
    if (handler) {
      Promise.resolve(handler(msg, this.send.bind(this))).catch(console.error);
    }
  }

  /**
   * Sends message to webview
   */
  send(msg: ExtensionMessage): void {
    this._view.webview.postMessage(msg);
  }
}
