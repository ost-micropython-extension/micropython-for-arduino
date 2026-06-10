import { ActivateMountOperation } from "../../../../device/operation/ActivateMountOperation";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDevice(renameResult: "ok" | "noMain" | "alreadyExists" | "other") {
  let renameImpl: () => Promise<void>;

  switch (renameResult) {
    case "ok":
      renameImpl = () => Promise.resolve();
      break;
    case "noMain":
      renameImpl = () => Promise.reject(new Error('"main.py" does not exist.'));
      break;
    case "alreadyExists":
      renameImpl = () =>
        Promise.reject(
          new Error('"mainWhileMount.py" already exists in this folder.'),
        );
      break;
    case "other":
      renameImpl = () => Promise.reject(new Error("serial timeout"));
      break;
  }

  return {
    stateManager: { set: jest.fn() },
    repl: { isOpen: false as boolean, close: jest.fn() },
    mountManager: { activate: jest.fn() },
    renameFile: jest.fn().mockImplementation(renameImpl),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ActivateMountOperation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sets mountActive and calls mountManager.activate on success", async () => {
    const device = makeDevice("ok");

    await ActivateMountOperation.execute(device as any, "COM3", "/ws");

    expect(device.stateManager.set).toHaveBeenCalledWith({ mountActive: true });
    expect(device.mountManager.activate).toHaveBeenCalledWith("COM3", "/ws");
  });

  it("ignores the 'main.py does not exist' error and still activates mount", async () => {
    const device = makeDevice("noMain");

    await ActivateMountOperation.execute(device as any, "COM3", "/ws");

    expect(device.stateManager.set).toHaveBeenCalledWith({ mountActive: true });
    expect(device.mountManager.activate).toHaveBeenCalled();
  });

  it("throws a user-friendly error when mainWhileMount.py already exists", async () => {
    const device = makeDevice("alreadyExists");

    await expect(
      ActivateMountOperation.execute(device as any, "COM3", "/ws"),
    ).rejects.toThrow(
      "Can not rename main.py from board, since mainWhileMount.py already exists.",
    );
    expect(device.mountManager.activate).not.toHaveBeenCalled();
  });

  it("re-throws any other rename error unchanged", async () => {
    const device = makeDevice("other");

    await expect(
      ActivateMountOperation.execute(device as any, "COM3", "/ws"),
    ).rejects.toThrow("serial timeout");
    expect(device.mountManager.activate).not.toHaveBeenCalled();
  });

  it("closes the REPL and waits before proceeding when it is open", async () => {
    jest.useFakeTimers();
    const device = makeDevice("ok");
    device.repl.isOpen = true;

    const p = ActivateMountOperation.execute(device as any, "COM3", "/ws");
    await jest.runAllTimersAsync();
    await p;

    expect(device.repl.close).toHaveBeenCalled();
    expect(device.mountManager.activate).toHaveBeenCalled();
    jest.useRealTimers();
  });
});
