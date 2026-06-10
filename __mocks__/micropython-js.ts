/**
 * Mock für micropython.js (Board-Kommunikation).
 *
 * Ersetzt das native Addon (serialport) damit Tests ohne
 * echtes Board und ohne native Builds laufen.
 *
 * Eingebunden via jest.config.ts → moduleNameMapper:
 *   { '^micropython\\.js$': '<rootDir>/__mocks__/micropython-js.ts' }
 */

const mockBoard = {
  open: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  reset: jest.fn().mockResolvedValue(undefined),
  run: jest.fn().mockResolvedValue(""),
  execfile: jest.fn().mockResolvedValue("OK\x04\x04>"),
  list_ports: jest.fn().mockResolvedValue([]),
  fs_ils: jest.fn().mockResolvedValue([]),
  fs_put: jest.fn().mockResolvedValue(undefined),
  fs_cat_binary: jest.fn().mockResolvedValue(new Uint8Array()),
  fs_rm: jest.fn().mockResolvedValue(undefined),
  serial: {
    isOpen: false,
    resume: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    write: jest.fn(),
    drain: jest.fn((_cb: (err: null) => void) => _cb(null)),
  },
};

const MicroPython = jest.fn().mockImplementation(() => mockBoard);

export = MicroPython;
