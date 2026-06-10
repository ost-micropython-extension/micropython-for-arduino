import * as vscode from "vscode";
import MicroPython = require("micropython.js");
import { DeviceManager } from "./DeviceManager";
import { PortInfo } from "../types/messages";
import { BoardState } from "../types/boardState";

export interface DeviceInfo {
  port: string;
  description: string;
  hasMicroPython: boolean;
  boardName: string;
  stubPackage?: string;
}

/**
 * Known VID:PID combinations for boards running MicroPython
 * Name and stub package for each VIP:PID
 * Extracted from https://github.com/micropython/micropython/tree/master/ports
 * Stub packages from https://micropython-stubs.readthedocs.io/en/main/packages.html
 */
const KNOWN_BOARDS: Record<string, { name: string; stubPackage?: string }> = {
  "15ba:0046": {
    name: "OLIMEX RT1010",
    stubPackage: "micropython-mimxrt-mimxrt1010_evk-stubs",
  },
  "2341:025e": {
    name: "Arduino Nano RP2040 Connect",
    stubPackage: "micropython-rp2-arduino_nano_rp2040_connect-stubs",
  },
  "2341:055b": {
    name: "Arduino Portenta H7",
    stubPackage: "micropython-stm32-stubs",
  },
  "2341:055f": {
    name: "Arduino Nicla Vision",
    stubPackage: "micropython-stm32-stubs",
  },
  "2341:0564": { name: "Arduino Opta", stubPackage: "micropython-stm32-stubs" },
  "2341:0566": {
    name: "Arduino Giga R1",
    stubPackage: "micropython-stm32-stubs",
  },
  "2341:056b": {
    name: "Arduino Nano ESP32",
    stubPackage: "micropython-esp32-stubs",
  },
  "303a:1001": {
    name: "Espressif ESP32-S3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:80d1": {
    name: "Unexpected Maker TinyS3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:80d4": {
    name: "Unexpected Maker ProS3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:80d7": {
    name: "Unexpected Maker FeatherS3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:817a": {
    name: "Unexpected Maker NanoS3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:81b1": {
    name: "Unexpected Maker TinyWatchS3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:81fc": {
    name: "Unexpected Maker FeatherS3NEO",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:81ff": {
    name: "Unexpected Maker RGBTouch Mini",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "303a:8225": {
    name: "Unexpected Maker OmgS3",
    stubPackage: "micropython-esp32-esp32_generic_s3-stubs",
  },
  "37c5:1206": { name: "OpenMV N6", stubPackage: "micropython-stm32-stubs" },
  "37c5:16e3": { name: "OpenMV AE3" },
  "f055:9802": {
    name: "MakerDiary RT1011 Nano Kit",
    stubPackage: "micropython-mimxrt-stubs",
  },
};

/**
 * Known VID:PID combinations for boards running MicroPython
 */
const MICROPYTHON_VIDPIDS = new Set(Object.keys(KNOWN_BOARDS));

/**
 * Create VID:PID combination by vendorId and productId
 */
function normVidPid(
  vendorId: string | undefined,
  productId: string | undefined,
): string | undefined {
  if (!vendorId || !productId) {
    return undefined;
  }
  const vid = vendorId.toLowerCase().padStart(4, "0");
  const pid = productId.toLowerCase().padStart(4, "0");
  return `${vid}:${pid}`;
}

/**
 * Returns if VID:PID is a known MicroPython device
 */
function detectMicroPython(
  vendorId: string | undefined,
  productId: string | undefined,
): boolean {
  const key = normVidPid(vendorId, productId);
  return key !== undefined && MICROPYTHON_VIDPIDS.has(key);
}

/**
 * Returns name of VID:PID if known
 */
function getBoardName(
  vendorId: string | undefined,
  productId: string | undefined,
): string {
  const key = normVidPid(vendorId, productId);
  if (!key) {
    return "";
  }
  return KNOWN_BOARDS[key]?.name ?? key;
}

const POLL_INTERVAL_MS = 300;

/**
 * Manages connected devices.
 * Contains map for port and device.
 */
export class ConnectionManager implements vscode.Disposable {
  private _devices: Map<string, DeviceManager> = new Map();
  private _currentPort: string | undefined;
  mpremotePath: string = "mpremote";
  private _cachedDevices: DeviceInfo[] = [];
  private _watchTimer: ReturnType<typeof setInterval> | undefined;
  private _watchCallback: ((devices: PortInfo[]) => void) | undefined;
  private readonly _onDidChangePort = new vscode.EventEmitter<
    string | undefined
  >();
  readonly onDidChangePort: vscode.Event<string | undefined> =
    this._onDidChangePort.event;
  private _onStateChanged: (port: string, state: BoardState) => void = () => {};

  /**
   * Returns device if exists in devices map
   * Throws error if no device for that port is available.
   */
  getDevice(port: string): DeviceManager {
    const device = this._devices.get(port);
    if (!device) {
      throw new Error(`No connected Device to ${port}`);
    }
    return device;
  }

  /**
   * Creates a list of devices that can be accessed through serial communication
   */
  async listDevices(): Promise<DeviceInfo[]> {
    const board = new MicroPython();
    const ports = await board.list_ports();
    this._cachedDevices = ports.map((p) => {
      const key = normVidPid(p.vendorId, p.productId);
      return {
        port: p.path,
        description: p.manufacturer ?? p.friendlyName ?? p.pnpId ?? "",
        hasMicroPython: detectMicroPython(p.vendorId, p.productId),
        boardName: getBoardName(p.vendorId, p.productId),
        stubPackage: key ? KNOWN_BOARDS[key]?.stubPackage : undefined,
      };
    });
    return this._cachedDevices;
  }

  /**
   * Returns DeviceInfo for device connected to port
   */
  getDeviceForPort(port: string): DeviceInfo | undefined {
    return this._cachedDevices.find((d) => d.port === port);
  }

  /**
   * sendState function is called with port and state if connected board changes state.
   */
  setOnStateChanged(sendState: (port: string, state: BoardState) => void) {
    this._onStateChanged = sendState;
  }

  /**
   * Creates a DeviceManager for board on port, that manages the communication.
   * use getDevice(port) to access board
   */
  open(port: string): void {
    const device = new DeviceManager(
      port,
      this._onStateChanged,
      this.mpremotePath,
    );
    this._devices.set(port, device);
  }

  /**
   * Disposes and removes DeviceManager
   */
  async close(port: string): Promise<void> {
    try {
      const device = this._devices.get(port);
      if (device) {
        await device.dispose();
      }
    } finally {
      this._devices.delete(port);
    }
  }

  /**
   * Sets currently opened port
   */
  setCurrent(port: string | undefined): void {
    this._currentPort = port;
    this._onDidChangePort.fire(port);
  }

  /**
   * Returns currently opened port
   */
  getCurrentPort(): string | undefined {
    return this._currentPort;
  }

  /**
   * Returns ports that have an open tab.
   */
  async getPorts(): Promise<PortInfo[]> {
    return this.mapToPortInfo(await this.listDevices());
  }

  private mapToPortInfo(list: DeviceInfo[]): PortInfo[] {
    return list.map((d) => ({
      path: d.port,
      description: d.description,
      hasMicroPython: d.hasMicroPython,
      boardName: d.boardName,
    }));
  }

  /**
   * Starts polling for port changes every POLL_INTERVAL_MS milliseconds.
   * `onChanged` is called whenever the port list changes, or when the
   * currently selected port disappears (in which case it is auto-cleared).
   */
  startWatching(onChanged: (devices: PortInfo[]) => void): void {
    this._watchCallback = onChanged;
    this._watchTimer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  /**
   * Stops polling to detect port changes
   */
  stopWatching(): void {
    if (this._watchTimer !== undefined) {
      clearInterval(this._watchTimer);
      this._watchTimer = undefined;
    }
    this._watchCallback = undefined;
  }

  private async _poll(): Promise<void> {
    if (!this._watchCallback) {
      return;
    }
    try {
      const previous: PortInfo[] = this.mapToPortInfo(this._cachedDevices);
      const next: PortInfo[] = await this.getPorts();

      if (!this.devicesEqual(previous, next)) {
        this._watchCallback(next);
      }
    } catch {
      // Silently ignore transient errors during polling
    }
  }

  /**
   * Compares two lists or PortInfos on equality
   */
  devicesEqual(a: PortInfo[], b: PortInfo[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    const key = (d: PortInfo) => `${d.path}|${d.hasMicroPython}|${d.boardName}`;
    const aKeys = new Set(a.map(key));
    return b.every((d) => {
      return aKeys.has(key(d));
    });
  }

  clearCachedDevices(): void {
    this._cachedDevices = [];
  }

  dispose(): void {
    this.stopWatching();
    this._onDidChangePort.dispose();
  }
}
