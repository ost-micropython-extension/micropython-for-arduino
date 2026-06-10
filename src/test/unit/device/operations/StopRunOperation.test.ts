import { StopRunOperation } from "../../../../device/operation/StopRunOperation";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDevice() {
  return {
    stateManager: { set: jest.fn() },
    mountManager: { isActive: false as boolean, sendInterrupt: jest.fn() },
    repl: { isOpen: false as boolean, interrupt: jest.fn() },
    // withBoard is fire-and-forget in the normal branch
    withBoard: jest
      .fn()
      .mockImplementation(async (cb: (b: { stop: jest.Mock }) => unknown) =>
        cb({ stop: jest.fn() }),
      ),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("StopRunOperation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("always sets running:false regardless of branch", async () => {
    const device = makeDevice();

    await StopRunOperation.execute(device as any, null);

    expect(device.stateManager.set).toHaveBeenCalledWith({ running: false });
  });

  // ── mount mode ───────────────────────────────────────────────────────────────

  describe("mount mode", () => {
    it("calls sendInterrupt", async () => {
      const device = makeDevice();
      device.mountManager.isActive = true;

      await StopRunOperation.execute(device as any, null);

      expect(device.mountManager.sendInterrupt).toHaveBeenCalled();
    });

    it("does not call repl.interrupt or withBoard", async () => {
      const device = makeDevice();
      device.mountManager.isActive = true;

      await StopRunOperation.execute(device as any, null);

      expect(device.repl.interrupt).not.toHaveBeenCalled();
      expect(device.withBoard).not.toHaveBeenCalled();
    });
  });

  // ── REPL mode ─────────────────────────────────────────────────────────────────

  describe("REPL mode", () => {
    it("calls repl.interrupt", async () => {
      const device = makeDevice();
      device.repl.isOpen = true;

      await StopRunOperation.execute(device as any, null);

      expect(device.repl.interrupt).toHaveBeenCalled();
    });

    it("does not call withBoard", async () => {
      const device = makeDevice();
      device.repl.isOpen = true;

      await StopRunOperation.execute(device as any, null);

      expect(device.withBoard).not.toHaveBeenCalled();
    });
  });

  // ── normal mode: activeBoard is null → stop via withBoard ─────────────────────

  describe("normal mode — activeBoard is null", () => {
    it("calls board.stop() via withBoard", async () => {
      const board = { stop: jest.fn() };
      const device = makeDevice();
      (device.withBoard as jest.Mock).mockImplementation(
        async (cb: (b: typeof board) => unknown) => cb(board),
      );

      await StopRunOperation.execute(device as any, null);

      expect(device.withBoard).toHaveBeenCalled();
      expect(board.stop).toHaveBeenCalled();
    });
  });

  // ── normal mode: activeBoard provided → stop directly ─────────────────────────

  describe("normal mode — activeBoard is provided", () => {
    it("calls activeBoard.stop() directly without withBoard", async () => {
      const device = makeDevice();
      const activeBoard = { stop: jest.fn() };

      await StopRunOperation.execute(device as any, activeBoard as any);

      expect(activeBoard.stop).toHaveBeenCalled();
      expect(device.withBoard).not.toHaveBeenCalled();
    });
  });
});
