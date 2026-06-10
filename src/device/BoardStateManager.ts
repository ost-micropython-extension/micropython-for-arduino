import { BoardState } from "../types/boardState";

type Listener = (port: string, state: BoardState) => void;

export class BoardStateManager {
  private _state: BoardState;
  private _port: string;
  private listeners: Listener[] = [];

  constructor(initial: BoardState, port: string, listener: Listener) {
    this._state = initial;
    this._port = port;
    this.listeners.push(listener);
    this.emit();
  }

  /**
   * Returns current state
   */
  get() {
    return this._state;
  }

  /**
   * Sets state and fires listeners
   */
  set(patch: Partial<BoardState>) {
    this._state = deepMerge(this._state, patch);
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) {
      fn(this._port, this._state);
    }
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object
    ? T[K] extends Array<any>
      ? T[K] // don’t recurse into arrays
      : DeepPartial<T[K]>
    : T[K];
};

/**
 * Merges boardstate with partial changes
 */
function deepMerge<T>(target: T, patch: DeepPartial<T>): T {
  for (const key in patch) {
    const patchValue = patch[key];
    const targetValue = target[key];

    if (
      patchValue &&
      typeof patchValue === "object" &&
      !Array.isArray(patchValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      deepMerge(targetValue, patchValue as any);
    } else if (patchValue !== undefined) {
      (target as any)[key] = patchValue;
    }
  }

  return target;
}
