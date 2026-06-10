import { RunCodeOperation } from "../../../../device/operation/RunCodeOperation";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBoard() {
  return {
    run: jest.fn().mockResolvedValue("OK\x04\x04>"),
  };
}

function makeDevice(board: ReturnType<typeof makeBoard>) {
  return {
    stateManager: { set: jest.fn() },
    connectedPort: "COM3",
    mountManager: { isActive: false as boolean, sendCodeBlock: jest.fn() },
    withBoard: jest
      .fn()
      .mockImplementation(async (cb: (b: typeof board) => unknown) =>
        cb(board),
      ),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("RunCodeOperation", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── mount mode ───────────────────────────────────────────────────────────────

  describe("mount mode", () => {
    it("calls sendCodeBlock with the provided code", async () => {
      const board = makeBoard();
      const device = makeDevice(board);
      device.mountManager.isActive = true;

      await RunCodeOperation.execute(device as any, "print('hi')");

      expect(device.mountManager.sendCodeBlock).toHaveBeenCalledWith(
        "print('hi')",
      );
    });

    it("does not call withBoard", async () => {
      const board = makeBoard();
      const device = makeDevice(board);
      device.mountManager.isActive = true;

      await RunCodeOperation.execute(device as any, "x = 1");

      expect(device.withBoard).not.toHaveBeenCalled();
    });

    it("does not touch running state", async () => {
      const board = makeBoard();
      const device = makeDevice(board);
      device.mountManager.isActive = true;

      await RunCodeOperation.execute(device as any, "x = 1");

      expect(device.stateManager.set).not.toHaveBeenCalled();
    });
  });

  // ── normal execution ─────────────────────────────────────────────────────────

  describe("normal execution", () => {
    it("calls withBoard", async () => {
      const board = makeBoard();
      const device = makeDevice(board);

      await RunCodeOperation.execute(device as any, "x = 1");

      expect(device.withBoard).toHaveBeenCalled();
    });

    it("sets running:true then running:false around code execution", async () => {
      const board = makeBoard();
      const device = makeDevice(board);

      await RunCodeOperation.execute(device as any, "x = 1", "test.py");

      const calls = (device.stateManager.set as jest.Mock).mock.calls;
      expect(calls[0]).toEqual([{ running: true }]);
      expect(calls[1]).toEqual([{ running: false }]);
    });
  });
});
