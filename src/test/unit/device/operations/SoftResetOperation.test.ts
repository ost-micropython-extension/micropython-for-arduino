import { SoftResetOperation } from "../../../../device/operation/SoftResetOperation";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeDevice() {
  return {
    stateManager: { set: jest.fn() },
    mountManager: { isActive: false as boolean, sendSoftReset: jest.fn() },
    repl: {
      isOpen: false as boolean,
      softReset: jest.fn(),
      open: jest.fn().mockResolvedValue(undefined),
    },
    connectedPort: {} as any,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("SoftResetOperation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── mount mode ───────────────────────────────────────────────────────────────
  describe("mount mode", () => {
    it("calls sendSoftReset", async () => {
      const device = makeDevice();
      device.mountManager.isActive = true;
      await SoftResetOperation.execute(device as any);
      expect(device.mountManager.sendSoftReset).toHaveBeenCalled();
    });

    it("does not touch the REPL", async () => {
      const device = makeDevice();
      device.mountManager.isActive = true;
      await SoftResetOperation.execute(device as any);
      expect(device.repl.open).not.toHaveBeenCalled();
      expect(device.repl.softReset).not.toHaveBeenCalled();
    });
  });

  // ── REPL mode: already open ───────────────────────────────────────────────────
  describe("REPL mode — already open", () => {
    it("calls repl.softReset immediately", async () => {
      const device = makeDevice();
      device.repl.isOpen = true;
      await SoftResetOperation.execute(device as any);
      expect(device.repl.softReset).toHaveBeenCalled();
    });

    it("does not call repl.open", async () => {
      const device = makeDevice();
      device.repl.isOpen = true;
      await SoftResetOperation.execute(device as any);
      expect(device.repl.open).not.toHaveBeenCalled();
    });
  });

  // ── REPL mode: not open ───────────────────────────────────────────────────────
  describe("REPL mode — not open", () => {
    it("sets replOpen:true and opens the REPL with connectedPort", async () => {
      const device = makeDevice();
      await SoftResetOperation.execute(device as any);
      expect(device.stateManager.set).toHaveBeenCalledWith({ replOpen: true });
      expect(device.repl.open).toHaveBeenCalledWith(device.connectedPort);
    });

    it("calls softReset after the 300ms timeout", async () => {
      const device = makeDevice();
      await SoftResetOperation.execute(device as any);
      expect(device.repl.softReset).not.toHaveBeenCalled();
      jest.advanceTimersByTime(300);
      expect(device.repl.softReset).toHaveBeenCalled();
    });

    it("does not call sendSoftReset", async () => {
      const device = makeDevice();
      await SoftResetOperation.execute(device as any);
      expect(device.mountManager.sendSoftReset).not.toHaveBeenCalled();
    });
  });
});
