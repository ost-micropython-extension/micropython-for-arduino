import MicroPython = require("micropython.js");
import { readManifest, writeManifest } from "../../device/manifest";
import { LibraryManifest, ManifestEntry } from "../../types/messages";
import { DeviceManager } from "../../device/DeviceManager";
import { installPackage } from "./packageRegistry";
import { toGithubShorthand } from "../../webview/utils";

const FS_DIR_FLAG = 0x4000;
const REPL_CLOSE_DELAY_MS = 600;
const PORT_RELEASE_DELAY_MS = 600;

export type IlsEntry = [string, number, unknown, number];
export type InstalledLibraryItem = Partial<ManifestEntry> & {
  name: string;
  isDir: boolean;
  size: number;
};

export interface InstallLibraryInput {
  name: string;
  url: string;
}

export interface InstallLibraryResult {
  manifest: LibraryManifest;
  items: InstalledLibraryItem[];
}

export class FetchLibrariesOperation {
  /**
   * Reads installed libraries on the board
   */
  static async execute(device: DeviceManager): Promise<InstalledLibraryItem[]> {
    const { stateManager } = device;

    try {
      stateManager.set({ fileOpsActive: true });
      return await device.withBoard(async (board) => {
        const dirEntries = await board.fs_ils("lib");
        const manifest = await readManifest(board);
        return buildInstalledList(
          manifest,
          dirEntries,
          buildIlsMap(dirEntries),
        );
      });
    } catch {
      // /lib may not exist yet on a fresh board
      return [];
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }
}

export class InstallLibraryOperation {
  /**
   * Installs library on the board and handles board state
   */
  static async execute(
    device: DeviceManager,
    input: InstallLibraryInput,
  ): Promise<InstallLibraryResult | null> {
    const { repl, connectedPort, stateManager } = device;

    if (repl.isOpen) {
      repl.close();
      await delay(REPL_CLOSE_DELAY_MS);
    }

    stateManager.set({ fileOpsActive: true });

    let beforeNames = new Set<string>();
    try {
      beforeNames = await device.withBoard(async (board) => {
        const entries: IlsEntry[] = await board.fs_ils("lib");
        return new Set<string>(entries.map(([name]) => name));
      });
    } catch {
      // /lib may not exist yet on a fresh board
    }

    try {
      // Run the external installer — claims the port itself, outside withBoard
      const githubRef = toGithubShorthand(input.url);
      const installedVersion = await installPackage(
        input.name,
        githubRef || input.name,
        connectedPort,
      );

      // Give the OS time to release the port before reconnecting
      await delay(PORT_RELEASE_DELAY_MS);

      return device.withBoard(async (board) => {
        const dirEntries = await board.fs_ils("lib");
        const manifest = await readManifest(board);

        recordNewFiles(manifest, dirEntries, {
          name: input.name,
          url: input.url,
          beforeNames,
          installedVersion,
        });
        await writeManifest(board, manifest);

        return {
          manifest,
          items: buildInstalledList(
            manifest,
            dirEntries,
            buildIlsMap(dirEntries),
          ),
        };
      });
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }
}

export class UninstallLibraryOperation {
  /**
   * Uninstalls library from the board and handles board state
   */
  static async execute(
    device: DeviceManager,
    name: string,
  ): Promise<InstalledLibraryItem[] | null> {
    const { stateManager } = device;

    stateManager.set({ fileOpsActive: true });
    try {
      return await device.withBoard(async (board) => {
        const manifest = await readManifest(board);
        const entry = manifest.packages[name];
        const filesToDelete = entry?.files ?? [name];

        const dirEntries: IlsEntry[] = await board.fs_ils("lib");
        const dirSet = new Set(
          dirEntries
            .filter(([, type]) => type === FS_DIR_FLAG)
            .map(([name]) => name),
        );

        for (const file of filesToDelete) {
          await deleteLibFile(board, file, dirSet);
        }

        delete manifest.packages[name];
        await writeManifest(board, manifest);

        const updatedEntries = await board.fs_ils("lib");
        return buildInstalledList(
          manifest,
          updatedEntries,
          buildIlsMap(updatedEntries),
        );
      });
    } finally {
      stateManager.set({ fileOpsActive: false });
    }
  }
}

interface RecordFilesContext {
  name: string;
  url: string;
  beforeNames: Set<string>;
  installedVersion: string | undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordNewFiles(
  manifest: LibraryManifest,
  dirEntries: IlsEntry[],
  ctx: RecordFilesContext,
): void {
  const newFiles = dirEntries
    .filter(([name]) => !ctx.beforeNames.has(name) && name !== "manifest.json")
    .map(([name]) => name);

  const existing = manifest.packages[ctx.name];

  if (newFiles.length === 0) {
    // Reinstall: files overwritten in-place — refresh metadata, keep file list.
    if (existing) {
      manifest.packages[ctx.name] = {
        ...existing,
        url: ctx.url,
        installedAt: today(),
        ...(ctx.installedVersion ? { version: ctx.installedVersion } : {}),
      };
    }
    return;
  }

  manifest.packages[ctx.name] = {
    url: ctx.url,
    displayName: deriveDisplayName(ctx.name),
    installedAt: today(),
    files: newFiles,
    ...(ctx.installedVersion ? { version: ctx.installedVersion } : {}),
  };
}

async function deleteLibFile(
  board: InstanceType<typeof MicroPython>,
  file: string,
  dirSet: Set<string>,
): Promise<void> {
  const libPath = `/lib/${file}`;
  if (dirSet.has(file)) {
    await board.run(recursiveDeleteScript(libPath));
  } else {
    await board.fs_rm(libPath);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function deriveDisplayName(name: string): string {
  const githubShort = name.match(/^github:[^/]+\/([^@]+)/);
  if (githubShort) {
    return githubShort[1];
  }
  const githubUrl = name.match(/github\.com\/[^/]+\/([^/@]+)/);
  if (githubUrl) {
    return githubUrl[1];
  }
  return name;
}

function recursiveDeleteScript(path: string): string {
  return [
    "import os",
    "def _rm(p):",
    " try: os.remove(p)",
    " except OSError:",
    '  for f in os.listdir(p): _rm(p+"/"+f)',
    "  os.rmdir(p)",
    `_rm('${path}')`,
  ].join("\n");
}

function buildIlsMap(
  ils: IlsEntry[],
): Map<string, { isDir: boolean; size: number }> {
  return new Map(
    ils.map(([name, type, , size]) => [
      name,
      { isDir: type === FS_DIR_FLAG, size: size ?? 0 },
    ]),
  );
}

function buildInstalledList(
  manifest: LibraryManifest,
  dirEntries: IlsEntry[],
  ilsMap: Map<string, { isDir: boolean; size: number }>,
): InstalledLibraryItem[] {
  const coveredFiles = new Set<string>();
  const items: InstalledLibraryItem[] = [];

  for (const [key, entry] of Object.entries(manifest.packages)) {
    (entry.files ?? [key]).forEach((f) => coveredFiles.add(f));
    items.push({
      name: key,
      isDir: false,
      size: ilsMap.get(key)?.size ?? 0,
      ...entry,
    });
  }

  for (const [name, type, , size] of dirEntries) {
    if (name !== "manifest.json" && !coveredFiles.has(name)) {
      items.push({ name, isDir: type === FS_DIR_FLAG, size: size ?? 0 });
    }
  }

  return items;
}
