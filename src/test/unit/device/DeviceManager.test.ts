import MicroPython = require("micropython.js");
import {
  DeviceManager,
  BoardOperationCancelledError,
} from "../../../device/DeviceManager";

const MockMicroPython = MicroPython as unknown as jest.Mock;

let mockBoard: {
  open: jest.Mock;
  close: jest.Mock;
  stop: jest.Mock;
  serial: { isOpen: boolean };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  mockBoard = {
    open: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    serial: { isOpen: false },
  };

  MockMicroPython.mockImplementation(() => mockBoard);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("DeviceManager", () => {
  describe("constructor", () => {
    it("sets connectedPort to the provided port", () => {
      const dm = new DeviceManager("COM3", jest.fn());
      expect(dm.connectedPort).toBe("COM3");
    });

    it("calls the state listener immediately with connected: true", () => {
      const listener = jest.fn();
      new DeviceManager("COM3", listener);
      expect(listener).toHaveBeenCalledWith(
        "COM3",
        expect.objectContaining({ connected: true }),
      );
    });
  });

  describe("withBoard()", () => {
    it("throws BoardOperationCancelledError when a board operation is already active", async () => {
      const dm = new DeviceManager("COM3", jest.fn());
      (dm as any)._activeBoard = mockBoard;
      await expect(dm.withBoard(jest.fn())).rejects.toThrow(
        BoardOperationCancelledError,
      );
    });

    it("opens the board on the connected port", async () => {
      const dm = new DeviceManager("COM3", jest.fn());

      const p = dm.withBoard(async () => undefined);
      await jest.runAllTimersAsync();
      await p;

      expect(mockBoard.open).toHaveBeenCalledWith("COM3");
    });

    it("calls board.stop() before invoking the callback", async () => {
      const dm = new DeviceManager("COM3", jest.fn());

      const p = dm.withBoard(async () => undefined);
      await jest.runAllTimersAsync();
      await p;

      expect(mockBoard.stop).toHaveBeenCalled();
    });

    it("passes the board instance to the callback", async () => {
      const dm = new DeviceManager("COM3", jest.fn());
      const callback = jest.fn().mockResolvedValue("ok");

      const p = dm.withBoard(callback);
      await jest.runAllTimersAsync();
      await p;

      expect(callback).toHaveBeenCalledWith(mockBoard);
    });

    it("returns the value from the callback", async () => {
      const dm = new DeviceManager("COM3", jest.fn());

      const p = dm.withBoard(async () => 42);
      await jest.runAllTimersAsync();
      const result = await p;

      expect(result).toBe(42);
    });

    it("closes the board after the callback completes", async () => {
      const dm = new DeviceManager("COM3", jest.fn());

      const p = dm.withBoard(async () => undefined);
      await jest.runAllTimersAsync();
      await p;

      expect(mockBoard.close).toHaveBeenCalled();
    });

    it("closes the board even when the callback throws", async () => {
      const dm = new DeviceManager("COM3", jest.fn());

      const p = dm.withBoard(async () => {
        throw new Error("callback error");
      });
      const settled = p.catch((e: Error) => e);

      await jest.runAllTimersAsync();

      const err = await settled;
      expect((err as Error).message).toBe("callback error");
      expect(mockBoard.close).toHaveBeenCalled();
    });

    it("closes the REPL terminal first when it is open", async () => {
      const dm = new DeviceManager("COM3", jest.fn());
      jest.spyOn(dm.repl, "close");
      Object.defineProperty(dm.repl, "isOpen", { get: () => true });

      const p = dm.withBoard(async () => undefined);
      await jest.runAllTimersAsync();
      await p;

      expect(dm.repl.close).toHaveBeenCalled();
    });

    describe("when the board does not behave", () => {
      it("fails with a clear error instead of hanging when open() never settles", async () => {
        // micropython.js's open() never settles when its handshake fails
        mockBoard.open.mockReturnValue(new Promise(() => {}));
        const dm = new DeviceManager("COM3", jest.fn());
        const callback = jest.fn();

        const result = expect(dm.withBoard(callback)).rejects.toThrow(
          "COM3 did not respond",
        );
        await jest.runAllTimersAsync();
        await result;

        expect(callback).not.toHaveBeenCalled();
      });

      it("releases the board after a hung open() so the next operation can run", async () => {
        mockBoard.open.mockReturnValueOnce(new Promise(() => {}));
        const dm = new DeviceManager("COM3", jest.fn());

        const first = dm.withBoard(async () => "first").catch((e: Error) => e);
        await jest.runAllTimersAsync();
        await first;

        const second = dm.withBoard(async () => "second");
        await jest.runAllTimersAsync();

        await expect(second).resolves.toBe("second");
      });

      it("closes the port after a hung open()", async () => {
        mockBoard.open.mockReturnValue(new Promise(() => {}));
        const dm = new DeviceManager("COM3", jest.fn());

        const result = dm.withBoard(jest.fn()).catch((e: Error) => e);
        await jest.runAllTimersAsync();
        await result;

        expect(mockBoard.close).toHaveBeenCalled();
      });

      it("does not wait longer than 10 seconds for open()", async () => {
        mockBoard.open.mockReturnValue(new Promise(() => {}));
        const dm = new DeviceManager("COM3", jest.fn());
        const onSettled = jest.fn();
        dm.withBoard(jest.fn()).catch(onSettled);

        await jest.advanceTimersByTimeAsync(9_900);
        expect(onSettled).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(200);
        expect(onSettled).toHaveBeenCalled();
      });

      it("passes through an error from open() unchanged", async () => {
        mockBoard.open.mockRejectedValue(new Error("Access denied"));
        const dm = new DeviceManager("COM3", jest.fn());

        const result = expect(dm.withBoard(jest.fn())).rejects.toThrow(
          "Access denied",
        );
        await jest.runAllTimersAsync();
        await result;
      });

      it("still returns the result when close() fails", async () => {
        mockBoard.close.mockRejectedValue(new Error("Port is not open"));
        const dm = new DeviceManager("COM3", jest.fn());

        const result = dm.withBoard(async () => 42);
        await jest.runAllTimersAsync();

        await expect(result).resolves.toBe(42);
      });

      it("keeps the callback's own error when close() fails too", async () => {
        mockBoard.close.mockRejectedValue(new Error("Port is not open"));
        const dm = new DeviceManager("COM3", jest.fn());

        const result = expect(
          dm.withBoard(async () => {
            throw new Error("listing failed");
          }),
        ).rejects.toThrow("listing failed");
        await jest.runAllTimersAsync();
        await result;
      });

      it("does not wait forever for close()", async () => {
        mockBoard.close.mockReturnValue(new Promise(() => {}));
        const dm = new DeviceManager("COM3", jest.fn());

        const result = dm.withBoard(async () => "done");
        await jest.runAllTimersAsync();

        await expect(result).resolves.toBe("done");
      });
    });
  });

  describe("setCancelOnDispose()", () => {
    it("invokes the registered callback once on dispose", async () => {
      const dm = new DeviceManager("COM3", jest.fn());
      const cancel = jest.fn();
      dm.setCancelOnDispose(cancel);

      await dm.dispose();

      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it("does not throw on dispose when no callback is registered", async () => {
      const dm = new DeviceManager("COM3", jest.fn());
      await expect(dm.dispose()).resolves.toBeUndefined();
    });

    it("clearing the callback with undefined stops it from firing on dispose", async () => {
      const dm = new DeviceManager("COM3", jest.fn());
      const cancel = jest.fn();
      dm.setCancelOnDispose(cancel);
      dm.setCancelOnDispose(undefined);

      await dm.dispose();

      expect(cancel).not.toHaveBeenCalled();
    });
  });
});
