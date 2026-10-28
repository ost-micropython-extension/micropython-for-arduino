/**
 * Error if an something tries to access board, but board is in use of something else by the extension.
 */
export class BoardOperationCancelledError extends Error {
  constructor() {
    super("Board operation cancelled.");
    this.name = "BoardOperationCancelledError";
  }
}

/**
 * Error if a board operation did not finish within its time limit.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
