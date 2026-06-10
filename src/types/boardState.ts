/**
 * Boardstate is used to tell the webview the current state of the board.
 */
export interface BoardState {
  connected: boolean;

  mountActive: boolean;

  replOpen: boolean;

  fileOpsActive: boolean;

  running: boolean;
}
