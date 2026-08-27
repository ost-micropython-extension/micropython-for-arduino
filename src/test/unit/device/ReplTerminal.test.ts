import MicroPython = require("micropython.js");
import * as vscode from "vscode";
import { ReplTerminal } from "../../../device/ReplTerminal";

const MockMicroPython = MicroPython as unknown as jest.Mock;

let mockSerial: {
  isOpen: boolean;
  resume: jest.Mock;
  write: jest.Mock;
};
let mockBoard: {
  open: jest.Mock;
  close: jest.Mock;
  setDataCallback: jest.Mock;
  serial: typeof mockSerial;
};
let mockTerminal: { show: jest.Mock; dispose: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  mockSerial = {
    isOpen: false,
    resume: jest.fn(),
    write: jest.fn(),
  };

  mockBoard = {
    open: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    setDataCallback: jest.fn(),
    serial: mockSerial,
  };

  MockMicroPython.mockImplementation(() => mockBoard);

  mockTerminal = { show: jest.fn(), dispose: jest.fn() };
  (vscode.window.createTerminal as jest.Mock).mockReturnValue(mockTerminal);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ReplTerminal", () => {
  describe("isOpen", () => {
    it("is false initially", () => {
      const repl = new ReplTerminal();
      expect(repl.isOpen).toBe(false);
    });

    it("is true after open()", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      expect(repl.isOpen).toBe(true);
    });

    it("is false after close()", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      repl.close();
      expect(repl.isOpen).toBe(false);
    });
  });

  describe("open()", () => {
    it("opens the board on the given port", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      expect(mockBoard.open).toHaveBeenCalledWith("COM3");
    });

    it("calls serial.resume() to enable data events", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      expect(mockSerial.resume).toHaveBeenCalled();
    });

    it("registers a data callback on the board", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      expect(mockBoard.setDataCallback).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("creates a terminal with the port name in the title", async () => {
      const repl = new ReplTerminal();
      await repl.open("/dev/ttyUSB0");
      expect(vscode.window.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ name: "REPL (/dev/ttyUSB0)" }),
      );
    });

    it("shows the terminal after creating it", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      expect(mockTerminal.show).toHaveBeenCalledWith(true);
    });

    it("shows the existing terminal instead of reopening when already open", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      const openCallsBefore = mockBoard.open.mock.calls.length;

      await repl.open("COM3"); // second call

      expect(mockBoard.open).toHaveBeenCalledTimes(openCallsBefore); // no new board.open
      expect(mockTerminal.show).toHaveBeenCalledTimes(2); // shown again
    });

    it("only creates one terminal on repeated open() calls", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      await repl.open("COM3");
      expect(vscode.window.createTerminal).toHaveBeenCalledTimes(1);
    });
  });

  describe("softReset()", () => {
    it("sends Ctrl-C immediately when serial is open", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      mockSerial.isOpen = true;

      repl.softReset();

      expect(mockSerial.write).toHaveBeenCalledWith(Buffer.from("\x03"));
    });

    it("sends Ctrl-D after 100 ms when serial is open", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      mockSerial.isOpen = true;

      repl.softReset();
      jest.advanceTimersByTime(100);

      expect(mockSerial.write).toHaveBeenCalledWith(Buffer.from("\x04"));
    });

    it("does not send Ctrl-D before 100 ms have elapsed", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      mockSerial.isOpen = true;

      repl.softReset();
      jest.advanceTimersByTime(99);

      const ctrlDCalls = mockSerial.write.mock.calls.filter((args) =>
        Buffer.from("\x04").equals(args[0]),
      );
      expect(ctrlDCalls).toHaveLength(0);
    });

    it("does nothing when serial isOpen is false", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      mockSerial.isOpen = false;

      repl.softReset();
      jest.advanceTimersByTime(200);

      expect(mockSerial.write).not.toHaveBeenCalled();
    });

    it("does nothing when the REPL has not been opened", () => {
      const repl = new ReplTerminal();
      repl.softReset();
      jest.advanceTimersByTime(200);
      expect(mockSerial.write).not.toHaveBeenCalled();
    });
  });

  describe("close()", () => {
    it("disposes the terminal", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      repl.close();
      expect(mockTerminal.dispose).toHaveBeenCalled();
    });

    it("calls board.close() to release the serial port", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      repl.close();
      expect(mockBoard.close).toHaveBeenCalled();
    });

    it("clears the data callback on the board", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      repl.close();
      expect(mockBoard.setDataCallback).toHaveBeenLastCalledWith(null);
    });

    it("is safe to call when not open", () => {
      const repl = new ReplTerminal();
      expect(() => repl.close()).not.toThrow();
    });
  });

  describe("dispose()", () => {
    it("cleans up even when the REPL was never opened", () => {
      const repl = new ReplTerminal();
      expect(() => repl.dispose()).not.toThrow();
    });

    it("closes board and terminal when open", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      repl.dispose();
      expect(repl.isOpen).toBe(false);
      expect(mockBoard.close).toHaveBeenCalled();
    });
  });

  describe("PTY callbacks", () => {
    async function openAndGetPty() {
      const repl = new ReplTerminal();
      await repl.open("COM3");
      const pty = (vscode.window.createTerminal as jest.Mock).mock.calls[0][0]
        .pty as {
        open: () => void;
        close: () => void;
        handleInput: (data: string) => void;
      };
      return { repl, pty };
    }

    it("writes Ctrl-C + Ctrl-B to serial when the PTY is opened", async () => {
      const { pty } = await openAndGetPty();
      mockSerial.isOpen = true;
      pty.open();
      expect(mockSerial.write).toHaveBeenCalledWith(
        Buffer.from("\x03\x03\x02"),
      );
    });

    it("closes the REPL when the PTY close callback fires", async () => {
      const { repl, pty } = await openAndGetPty();
      pty.close();
      expect(repl.isOpen).toBe(false);
    });

    it("forwards user input to serial when port is open", async () => {
      const { pty } = await openAndGetPty();
      mockSerial.isOpen = true;
      pty.handleInput("print('hi')");
      expect(mockSerial.write).toHaveBeenCalledWith(Buffer.from("print('hi')"));
    });

    it("does not forward user input when serial is closed", async () => {
      const { pty } = await openAndGetPty();
      mockSerial.isOpen = false;
      pty.handleInput("x");
      expect(mockSerial.write).not.toHaveBeenCalled();
    });
  });

  describe("onDidCloseTerminal handler", () => {
    it("cleans up state when the user closes the terminal panel", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");

      const handler = (vscode.window.onDidCloseTerminal as jest.Mock).mock
        .calls[0][0] as (t: unknown) => void;
      handler(mockTerminal); // simulate VSCode firing the event for our terminal

      expect(repl.isOpen).toBe(false);
      expect(mockBoard.close).toHaveBeenCalled();
    });

    it("does nothing when a different terminal is closed", async () => {
      const repl = new ReplTerminal();
      await repl.open("COM3");

      const handler = (vscode.window.onDidCloseTerminal as jest.Mock).mock
        .calls[0][0] as (t: unknown) => void;
      handler({ show: jest.fn(), dispose: jest.fn() }); // different terminal object

      expect(repl.isOpen).toBe(true);
    });
  });
});
