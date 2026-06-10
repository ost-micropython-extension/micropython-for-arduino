import MicroPython = require("micropython.js");
import { ConnectionManager } from "../../../device/ConnectionManager";
import { PortInfo } from "../../../types/messages";

const mockDispose = jest.fn().mockResolvedValue(undefined);
jest.mock("../../../device/DeviceManager", () => ({
  DeviceManager: jest.fn().mockImplementation(() => ({
    dispose: mockDispose,
  })),
}));

const MockMicroPython = MicroPython as unknown as jest.Mock;

let mockBoard: { list_ports: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  mockBoard = { list_ports: jest.fn().mockResolvedValue([]) };
  MockMicroPython.mockImplementation(() => mockBoard);
});

describe("ConnectionManager", () => {
  describe("listDevices()", () => {
    it("returns an empty array when no ports are found", async () => {
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices).toEqual([]);
    });

    it("maps port path and manufacturer correctly", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "/dev/ttyUSB0",
          manufacturer: "Arduino",
          vendorId: "2341",
          productId: "056b",
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].port).toBe("/dev/ttyUSB0");
      expect(devices[0].description).toBe("Arduino");
    });

    it("detects MicroPython for Arduino Nano ESP32 (VID:PID 2341:056b)", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM3",
          manufacturer: "Arduino",
          vendorId: "2341",
          productId: "056b",
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].hasMicroPython).toBe(true);
    });

    it("detects MicroPython for Espressif ESP32-S3 (VID:PID 303a:1001)", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM4",
          manufacturer: "Espressif",
          vendorId: "303a",
          productId: "1001",
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].hasMicroPython).toBe(true);
    });

    it("returns hasMicroPython false for an unknown VID:PID", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM5",
          manufacturer: "Unknown",
          vendorId: "1234",
          productId: "5678",
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].hasMicroPython).toBe(false);
    });

    it("returns hasMicroPython false when vendorId is missing", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM6",
          manufacturer: "Unknown",
          vendorId: undefined,
          productId: "056b",
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].hasMicroPython).toBe(false);
    });

    it("uses friendlyName as fallback when manufacturer is missing", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM7",
          friendlyName: "My Device",
          vendorId: undefined,
          productId: undefined,
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].description).toBe("My Device");
    });

    it("uses pnpId as last fallback for description", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM8",
          pnpId: "USB\\VID_2341",
          vendorId: undefined,
          productId: undefined,
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].description).toBe("USB\\VID_2341");
    });

    it("uses empty string when no description fields are present", async () => {
      mockBoard.list_ports.mockResolvedValue([
        { path: "COM9", vendorId: undefined, productId: undefined },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].description).toBe("");
    });

    it("is case-insensitive for VID:PID matching", async () => {
      mockBoard.list_ports.mockResolvedValue([
        {
          path: "COM3",
          manufacturer: "Arduino",
          vendorId: "2341",
          productId: "056B",
        },
      ]);
      const cm = new ConnectionManager();
      const devices = await cm.listDevices();
      expect(devices[0].hasMicroPython).toBe(true);
    });
  });

  describe("setCurrent() / getCurrentPort()", () => {
    it("getCurrentPort() returns undefined initially", () => {
      const cm = new ConnectionManager();
      expect(cm.getCurrentPort()).toBeUndefined();
    });

    it("setCurrent() updates the current port", () => {
      const cm = new ConnectionManager();
      cm.setCurrent("COM3");
      expect(cm.getCurrentPort()).toBe("COM3");
    });

    it("setCurrent() fires onDidChangePort with the new port", () => {
      const cm = new ConnectionManager();
      const listener = jest.fn();
      cm.onDidChangePort(listener);
      cm.setCurrent("COM3");
      expect(listener).toHaveBeenCalledWith("COM3");
    });

    it("setCurrent() allows clearing the port to undefined", () => {
      const cm = new ConnectionManager();
      cm.setCurrent("COM3");
      cm.setCurrent(undefined);
      expect(cm.getCurrentPort()).toBeUndefined();
    });

    it("setCurrent() fires onDidChangePort with undefined when cleared", () => {
      const cm = new ConnectionManager();
      const listener = jest.fn();
      cm.onDidChangePort(listener);
      cm.setCurrent(undefined);
      expect(listener).toHaveBeenCalledWith(undefined);
    });
  });

  describe("open() / close() / getDevice()", () => {
    it("getDevice() throws when no device is open for the port", () => {
      const cm = new ConnectionManager();
      expect(() => cm.getDevice("COM3")).toThrow("No connected Device to COM3");
    });

    it("open() registers a device so getDevice() no longer throws", () => {
      const cm = new ConnectionManager();
      cm.open("COM3");
      expect(() => cm.getDevice("COM3")).not.toThrow();
    });

    it("getDevice() returns the device created by open()", () => {
      const cm = new ConnectionManager();
      cm.open("COM3");
      const device = cm.getDevice("COM3");
      expect(device).toBeDefined();
    });

    it("close() removes the device so getDevice() throws afterwards", async () => {
      const cm = new ConnectionManager();
      cm.open("COM3");
      await cm.close("COM3");
      expect(() => cm.getDevice("COM3")).toThrow();
    });

    it("close() calls dispose() on the device", async () => {
      const cm = new ConnectionManager();
      cm.open("COM3");
      await cm.close("COM3");
      expect(mockDispose).toHaveBeenCalled();
    });

    it("close() does not throw when no device is registered for the port", async () => {
      const cm = new ConnectionManager();
      await expect(cm.close("COM9")).resolves.toBeUndefined();
    });

    it("multiple ports can be open simultaneously", () => {
      const cm = new ConnectionManager();
      cm.open("COM3");
      cm.open("COM4");
      expect(() => cm.getDevice("COM3")).not.toThrow();
      expect(() => cm.getDevice("COM4")).not.toThrow();
    });
  });

  describe("devicesEqual()", () => {
    const port = (
      path: string,
      hasMicroPython = false,
      boardName = "",
    ): PortInfo => ({
      path,
      description: "",
      hasMicroPython,
      boardName,
    });

    it("returns true for two empty lists", () => {
      const cm = new ConnectionManager();
      expect(cm.devicesEqual([], [])).toBe(true);
    });

    it("returns false when lists have different lengths", () => {
      const cm = new ConnectionManager();
      expect(cm.devicesEqual([port("COM3")], [])).toBe(false);
    });

    it("returns true for identical single-element lists", () => {
      const cm = new ConnectionManager();
      const a = [port("COM3", true, "Nano")];
      const b = [port("COM3", true, "Nano")];
      expect(cm.devicesEqual(a, b)).toBe(true);
    });

    it("returns false when hasMicroPython differs", () => {
      const cm = new ConnectionManager();
      expect(
        cm.devicesEqual(
          [port("COM3", true, "Nano")],
          [port("COM3", false, "Nano")],
        ),
      ).toBe(false);
    });

    it("returns false when boardName differs", () => {
      const cm = new ConnectionManager();
      expect(
        cm.devicesEqual(
          [port("COM3", true, "Nano")],
          [port("COM3", true, "Other")],
        ),
      ).toBe(false);
    });

    it("returns false when path differs", () => {
      const cm = new ConnectionManager();
      expect(cm.devicesEqual([port("COM3")], [port("COM4")])).toBe(false);
    });

    it("returns true regardless of list order", () => {
      const cm = new ConnectionManager();
      const a = [port("COM3"), port("COM4")];
      const b = [port("COM4"), port("COM3")];
      expect(cm.devicesEqual(a, b)).toBe(true);
    });
  });
});
