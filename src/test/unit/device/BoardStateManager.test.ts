import { BoardStateManager } from "../../../device/BoardStateManager";
import { BoardState } from "../../../types/boardState";

const INITIAL: BoardState = {
  connected: true,
  mountActive: false,
  replOpen: false,
  fileOpsActive: false,
  running: false,
};

function makeInitial(): BoardState {
  return { ...INITIAL };
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("BoardStateManager", () => {
  describe("constructor", () => {
    it("stores the initial state, readable via get()", () => {
      const mgr = new BoardStateManager(makeInitial(), "COM3", jest.fn());
      expect(mgr.get()).toEqual(INITIAL);
    });

    it("fires the listener immediately with the port and initial state", () => {
      const listener = jest.fn();
      new BoardStateManager(makeInitial(), "COM3", listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("COM3", INITIAL);
    });

    it("passes the correct port string to the listener", () => {
      const listener = jest.fn();
      new BoardStateManager(makeInitial(), "/dev/ttyUSB0", listener);
      expect(listener).toHaveBeenCalledWith("/dev/ttyUSB0", expect.any(Object));
    });
  });

  // ── set() ───────────────────────────────────────────────────────────────────

  describe("set()", () => {
    it("patches a single field and leaves all other fields unchanged", () => {
      const mgr = new BoardStateManager(makeInitial(), "COM3", jest.fn());

      mgr.set({ running: true });

      const state = mgr.get();
      expect(state.running).toBe(true);
      expect(state.connected).toBe(true);
      expect(state.mountActive).toBe(false);
      expect(state.replOpen).toBe(false);
      expect(state.fileOpsActive).toBe(false);
    });

    it("patches multiple fields at once", () => {
      const mgr = new BoardStateManager(makeInitial(), "COM3", jest.fn());

      mgr.set({ running: true, fileOpsActive: true });

      expect(mgr.get().running).toBe(true);
      expect(mgr.get().fileOpsActive).toBe(true);
    });

    it("fires the listener once per set() call with the updated state", () => {
      const listener = jest.fn();
      const mgr = new BoardStateManager(makeInitial(), "COM3", listener);
      listener.mockClear();

      mgr.set({ running: true });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        "COM3",
        expect.objectContaining({ running: true }),
      );
    });

    it("passes the port string to the listener on each set()", () => {
      const listener = jest.fn();
      const mgr = new BoardStateManager(
        makeInitial(),
        "/dev/ttyUSB0",
        listener,
      );
      listener.mockClear();

      mgr.set({ running: true });

      expect(listener).toHaveBeenCalledWith("/dev/ttyUSB0", expect.any(Object));
    });

    it("accumulates state across multiple set() calls", () => {
      const mgr = new BoardStateManager(makeInitial(), "COM3", jest.fn());

      mgr.set({ running: true });
      mgr.set({ fileOpsActive: true });

      expect(mgr.get().running).toBe(true);
      expect(mgr.get().fileOpsActive).toBe(true);
    });

    it("can set a field back to false after it was set to true", () => {
      const mgr = new BoardStateManager(makeInitial(), "COM3", jest.fn());

      mgr.set({ running: true });
      mgr.set({ running: false });

      expect(mgr.get().running).toBe(false);
    });

    it("ignores undefined values in the patch (does not overwrite the field)", () => {
      const mgr = new BoardStateManager(makeInitial(), "COM3", jest.fn());

      mgr.set({ running: undefined as unknown as boolean });

      expect(mgr.get().running).toBe(false);
    });

    it("fires the listener the correct number of times over multiple set() calls", () => {
      const listener = jest.fn();
      const mgr = new BoardStateManager(makeInitial(), "COM3", listener);
      listener.mockClear();

      mgr.set({ running: true });
      mgr.set({ fileOpsActive: true });
      mgr.set({ running: false });

      expect(listener).toHaveBeenCalledTimes(3);
    });
  });
});
