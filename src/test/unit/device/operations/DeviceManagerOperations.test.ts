import { DeviceManager } from "../../../../device/DeviceManager";

// ---- operation mocks ----
jest.mock("../../../../device/operation/FetchBoardFilesOperation", () => ({
  FetchBoardFilesOperation: {
    execute: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/BoardFileOperations", () => ({
  BoardFileOperations: {
    delete: jest.fn(),
    rename: jest.fn(),
    create: jest.fn(),
    createFolder: jest.fn(),
    getFileData: jest.fn(),
    uploadFile: jest.fn(),
    uploadContent: jest.fn(),
    move: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/RunFileOperation", () => ({
  RunFileOperation: {
    executeMountedFile: jest.fn(),
    executeBoardfile: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/RunCodeOperation", () => ({
  RunCodeOperation: {
    execute: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/StopRunOperation", () => ({
  StopRunOperation: {
    execute: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/SoftResetOperation", () => ({
  SoftResetOperation: {
    execute: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/ActivateMountOperation", () => ({
  ActivateMountOperation: {
    execute: jest.fn(),
  },
}));

jest.mock("../../../../device/operation/LibraryOperations", () => ({
  FetchLibrariesOperation: { execute: jest.fn() },
  InstallLibraryOperation: { execute: jest.fn() },
  UninstallLibraryOperation: { execute: jest.fn() },
}));

jest.mock("../../../../device/operation/ReadManifestOperation", () => ({
  ReadManifestOperation: { execute: jest.fn() },
}));

import { FetchBoardFilesOperation } from "../../../../device/operation/FetchBoardFilesOperation";
import { BoardFileOperations } from "../../../../device/operation/BoardFileOperations";
import { RunFileOperation } from "../../../../device/operation/RunFileOperation";
import { RunCodeOperation } from "../../../../device/operation/RunCodeOperation";
import { StopRunOperation } from "../../../../device/operation/StopRunOperation";
import { SoftResetOperation } from "../../../../device/operation/SoftResetOperation";
import { ActivateMountOperation } from "../../../../device/operation/ActivateMountOperation";
import {
  FetchLibrariesOperation,
  InstallLibraryOperation,
  UninstallLibraryOperation,
} from "../../../../device/operation/LibraryOperations";
import { ReadManifestOperation } from "../../../../device/operation/ReadManifestOperation";

describe("DeviceManager - operation forwarding", () => {
  const createDM = () => new DeviceManager("COM3", jest.fn());

  beforeEach(() => jest.clearAllMocks());

  it("fetchFiles forwards correctly", async () => {
    const dm = createDM();
    await dm.fetchFiles();

    expect(FetchBoardFilesOperation.execute).toHaveBeenCalledWith(dm, "COM3");
  });

  it("deleteFile forwards correctly", async () => {
    const dm = createDM();
    await dm.deleteFile(true, "/a");

    expect(BoardFileOperations.delete).toHaveBeenCalledWith(dm, true, "/a");
  });

  it("renameFile forwards correctly", async () => {
    const dm = createDM();
    await dm.renameFile("new", "/dir", "/old", "/new");

    expect(BoardFileOperations.rename).toHaveBeenCalledWith(
      dm,
      "new",
      "/dir",
      "/old",
      "/new",
    );
  });

  it("createFile forwards correctly", async () => {
    const dm = createDM();
    await dm.createFile("a.py", "/dir", "/dir/a.py");

    expect(BoardFileOperations.create).toHaveBeenCalledWith(
      dm,
      "a.py",
      "/dir",
      "/dir/a.py",
    );
  });

  it("createFolder forwards correctly", async () => {
    const dm = createDM();
    await dm.createFolder("lib", "/dir", "/dir/lib");

    expect(BoardFileOperations.createFolder).toHaveBeenCalledWith(
      dm,
      "lib",
      "/dir",
      "/dir/lib",
    );
  });

  it("getFileData forwards correctly", async () => {
    const dm = createDM();
    await dm.getFileData("/a.py");

    expect(BoardFileOperations.getFileData).toHaveBeenCalledWith(dm, "/a.py");
  });

  it("uploadFile forwards correctly", async () => {
    const dm = createDM();
    await dm.uploadFile("/local", "a.py");

    expect(BoardFileOperations.uploadFile).toHaveBeenCalledWith(
      dm,
      "/local",
      "a.py",
    );
  });

  it("uploadFileOnRemotePath forwards correctly", async () => {
    const dm = createDM();
    await dm.uploadFileOnRemotePath("code", "/remote/a.py");

    expect(BoardFileOperations.uploadContent).toHaveBeenCalledWith(
      dm,
      "code",
      "/remote/a.py",
    );
  });

  it("move forwards correctly", async () => {
    const dm = createDM();
    await dm.move("/a", "/b");

    expect(BoardFileOperations.move).toHaveBeenCalledWith(dm, "/a", "/b");
  });

  it("runFileWhileMount forwards correctly", async () => {
    const dm = createDM();
    await dm.runFileWhileMount("/a.py", "code");

    expect(RunFileOperation.executeMountedFile).toHaveBeenCalledWith(
      dm,
      "/a.py",
      "code",
    );
  });

  it("runBoardfile forwards correctly", async () => {
    const dm = createDM();
    await dm.runBoardfile("/a.py");

    expect(RunFileOperation.executeBoardfile).toHaveBeenCalledWith(dm, "/a.py");
  });

  it("runCode forwards correctly", async () => {
    const dm = createDM();
    await dm.runCode("print(1)", "name");

    expect(RunCodeOperation.execute).toHaveBeenCalledWith(
      dm,
      "print(1)",
      "name",
    );
  });

  it("stopExecution forwards correctly", () => {
    const dm = createDM();
    (dm as any)._activeBoard = {};

    dm.stopExecution();

    expect(StopRunOperation.execute).toHaveBeenCalled();
  });

  it("softReset forwards correctly", () => {
    const dm = createDM();
    dm.softReset();

    expect(SoftResetOperation.execute).toHaveBeenCalledWith(dm);
  });

  it("activateMount forwards correctly", async () => {
    const dm = createDM();
    await dm.activateMount("/ws");

    expect(ActivateMountOperation.execute).toHaveBeenCalledWith(
      dm,
      "COM3",
      "/ws",
    );
  });

  it("deactivateMount calls mountManager.deactivate", async () => {
    const dm = createDM();
    const spy = jest
      .spyOn(dm.mountManager, "deactivate")
      .mockResolvedValue(undefined);

    await dm.deactivateMount();

    expect(spy).toHaveBeenCalled();
  });

  it("fetchLibraries forwards correctly", async () => {
    const dm = createDM();
    await dm.fetchLibraries();

    expect(FetchLibrariesOperation.execute).toHaveBeenCalledWith(dm);
  });

  it("installLibrary forwards correctly", async () => {
    const dm = createDM();
    await dm.installLibrary({} as any);

    expect(InstallLibraryOperation.execute).toHaveBeenCalledWith(dm, {});
  });

  it("uninstallLibrary forwards correctly", async () => {
    const dm = createDM();
    await dm.uninstallLibrary("numpy");

    expect(UninstallLibraryOperation.execute).toHaveBeenCalledWith(dm, "numpy");
  });

  it("readManifest forwards correctly", async () => {
    const dm = createDM();
    await dm.readManifest();

    expect(ReadManifestOperation.execute).toHaveBeenCalledWith(dm);
  });
});
