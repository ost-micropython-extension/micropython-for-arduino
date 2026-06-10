import * as fs from "fs";
import * as path from "path";
import { LibraryManifest } from "../types/messages";
import { addStubsExtraPath } from "./PylanceConfig";
import { fetchUrl } from "../webview/utils";
import {
  CODE_SUPPORT_FOLDER,
  CODE_SUPPORT_GENERATION_LOG_FILE,
} from "../types/constants";

export class StubGenerator {
  /**
   * For all installed libraries that have a GitHub URL in the manifest,
   * fetches .py sources (and README.md) from the repo and saves them as-is
   * into <root>/<CODE_SUPPORT_FOLDER>/<packageName>/. A debug log is written to
   * log file inside codesupport folder.
   * Returns a human-readable summary string.
   */
  async generateFromGithub(
    manifest: LibraryManifest,
    root: string,
    regenerate: boolean,
  ): Promise<{ message: string; readmeFound?: boolean }> {
    const codeSupportDir = path.join(root, CODE_SUPPORT_FOLDER);
    fs.mkdirSync(codeSupportDir, { recursive: true });

    const debugLines: string[] = [];
    const pkgEntries = Object.entries(manifest.packages);

    debugLines.push(
      `\n-----------------------------------------------------------`,
    );
    debugLines.push(`Generation at ${new Date().toISOString()}`);
    debugLines.push(
      `Triggered ${regenerate ? "manually" : "by library installation"}`,
    );

    if (pkgEntries.length === 0) {
      debugLines.push("⚠ Manifest is empty - no packages found.");
    }

    let successCount = 0;
    let readmeFound = false;

    for (const [pkgId, entry] of pkgEntries) {
      debugLines.push(`\n── ${pkgId} ──`);

      if (!entry.url) {
        debugLines.push(`  ✗ Skipped: no URL in manifest`);
        continue;
      }
      debugLines.push(`  URL: ${entry.url}`);

      const parsed = this._parseGithubUrl(entry.url);
      if (!parsed) {
        debugLines.push(`  ✗ Skipped: URL could not be parsed as a GitHub URL`);
        continue;
      }
      debugLines.push(
        `  GitHub: ${parsed.owner}/${parsed.repo}${parsed.branch ? `@${parsed.branch}` : ""}`,
      );

      let files: { filePath: string; localPath: string; content: string }[] =
        [];
      try {
        ({ files, readmeFound } = await this._fetchRepoFiles(
          entry.url,
          entry.files ?? [],
        ));
      } catch (err) {
        debugLines.push(`  ✗ Fetch failed: ${(err as Error).message}`);
        continue;
      }

      if (files.length === 0) {
        const { owner, repo } = parsed;
        const branch =
          parsed.branch ?? (await this._resolveDefaultBranch(owner, repo));
        debugLines.push(`  Branch: ${branch}`);

        const searchDirs = parsed.path ? [parsed.path] : ["", "lib", "src"];
        for (const dir of searchDirs) {
          try {
            const found = await this._listPyFilesInDir(
              owner,
              repo,
              branch,
              dir,
            );
            if (found.length > 0) {
              debugLines.push(
                `  Dir "${dir || "/"}": ${found.length} .py file(s) found → ${found.map((f) => f.filePath).join(", ")}`,
              );
            } else {
              debugLines.push(`  Dir "${dir || "/"}": no .py files found`);
            }
          } catch (e) {
            debugLines.push(
              `  Dir "${dir || "/"}": API error – ${(e as Error).message}`,
            );
          }
        }
        debugLines.push(`  ✗ Skipped: no .py files could be downloaded`);
        debugLines.push(
          `    Possible causes: only .mpy binaries, private repo, GitHub rate limit, network error`,
        );
        continue;
      }

      // Save raw .py files and README into <CODE_SUPPORT_FOLDER>/<displayName>/
      const pkgDir = path.join(
        codeSupportDir,
        entry.displayName || parsed.repo,
      );
      fs.mkdirSync(pkgDir, { recursive: true });

      const savedFiles: string[] = [];
      for (const { localPath, content } of files) {
        const dest = path.join(pkgDir, localPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, "utf8");
        savedFiles.push(localPath);
      }

      debugLines.push(
        `  .py files (${savedFiles.length}): ${savedFiles.join(", ")}`,
      );
      debugLines.push(
        `  ✓ Files saved → ${CODE_SUPPORT_FOLDER}/${entry.displayName || parsed.repo}/ (${savedFiles.length} file(s))`,
      );

      addStubsExtraPath(root, entry.displayName || parsed.repo);
      successCount++;
    }

    const logPath = path.join(codeSupportDir, CODE_SUPPORT_GENERATION_LOG_FILE);
    fs.appendFileSync(logPath, `${debugLines.join("\n")}\n`, "utf8");

    const skipCount = pkgEntries.length - successCount;
    if (pkgEntries.length === 1) {
      const packageName = pkgEntries[0]?.[0];
      return successCount === 1
        ? {
            message: `✓ Code Support for ${packageName} added successfully.`,
            readmeFound: readmeFound,
          }
        : {
            message: `⚠ Code Support for ${packageName} was skipped.`,
            readmeFound: false,
          };
    }
    return successCount === pkgEntries.length
      ? { message: `✓ Code Support for all ${successCount} libraries added.` }
      : {
          message: `⚠ Code Support for ${successCount} of ${pkgEntries.length} libraries added, ${skipCount} skipped.`,
        };
  }

  /** Resolves a GitHub repo URL to its components. */
  private _parseGithubUrl(
    url: string,
  ): { owner: string; repo: string; branch?: string; path?: string } | null {
    const m = url.match(
      /github\.com\/([^/]+)\/([^/]+?)(?:\.git|\/tree\/([^/]+)(\/[^?#]*)?)?\/?$/,
    );
    if (!m) {
      return null;
    }
    return {
      owner: m[1],
      repo: m[2],
      branch: m[3],
      path: m[4]?.replace(/^\//, ""),
    };
  }

  /** Resolves the default branch of a GitHub repo via the API. */
  private async _resolveDefaultBranch(
    owner: string,
    repo: string,
  ): Promise<string> {
    try {
      const json = await fetchUrl(
        `https://api.github.com/repos/${owner}/${repo}`,
      );
      const data = JSON.parse(json) as { default_branch?: string };
      return data.default_branch ?? "main";
    } catch {
      return "main";
    }
  }

  /**
   * Lists all .py file paths inside a directory of a GitHub repo, recursing
   * into all non-ignored subdirectories at any depth.
   */
  private async _listPyFilesInDir(
    owner: string,
    repo: string,
    branch: string,
    dir: string,
  ): Promise<{ filePath: string; moduleDir: string | null }[]> {
    const IGNORE_DIRS = new Set([
      "examples",
      "example",
      "test",
      "tests",
      "docs",
      "doc",
      "assets",
      "demo",
      "demos",
      "sample",
      "samples",
      ".github",
    ]);

    const recurse = async (
      currentDir: string,
    ): Promise<{ filePath: string; moduleDir: string | null }[]> => {
      try {
        const apiUrl = currentDir
          ? `https://api.github.com/repos/${owner}/${repo}/contents/${currentDir}?ref=${branch}`
          : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;

        const json = await fetchUrl(apiUrl);
        const items = JSON.parse(json) as {
          name: string;
          path: string;
          type: string;
        }[];
        if (!Array.isArray(items)) {
          return [];
        }

        const result: { filePath: string; moduleDir: string | null }[] = [];
        for (const item of items) {
          if (item.type === "file" && item.name.endsWith(".py")) {
            result.push({ filePath: item.path, moduleDir: null });
          }
          if (
            item.type === "dir" &&
            !IGNORE_DIRS.has(item.name.toLowerCase())
          ) {
            const sub = await recurse(item.path);
            result.push(
              ...sub.map((f) => ({
                filePath: f.filePath,
                moduleDir: f.moduleDir ?? item.name,
              })),
            );
          }
        }
        return result;
      } catch {
        return [];
      }
    };

    return recurse(dir);
  }

  /** Lists all .py file paths at the TOP LEVEL of a directory only (no recursion). */
  private async _listPyFilesTopLevel(
    owner: string,
    repo: string,
    branch: string,
    dir: string,
  ): Promise<string[]> {
    try {
      const apiUrl = dir
        ? `https://api.github.com/repos/${owner}/${repo}/contents/${dir}?ref=${branch}`
        : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${branch}`;

      const json = await fetchUrl(apiUrl);
      const items = JSON.parse(json) as {
        name: string;
        path: string;
        type: string;
      }[];
      if (!Array.isArray(items)) {
        return [];
      }

      return items
        .filter((item) => item.type === "file" && item.name.endsWith(".py"))
        .map((item) => item.path);
    } catch {
      return [];
    }
  }

  /**
   * Fetches github repo to find given board files and folders.
   * Returns matching files with content and a boolean whether files contains a README.md
   */
  private async _fetchRepoFiles(
    repoUrl: string,
    boardFiles: string[],
  ): Promise<{
    files: { filePath: string; localPath: string; content: string }[];
    readmeFound: boolean;
  }> {
    const parsed = this._parseGithubUrl(repoUrl);
    if (!parsed) {
      return { files: [], readmeFound: false };
    }

    const { owner, repo } = parsed;
    const branch =
      parsed.branch ?? (await this._resolveDefaultBranch(owner, repo));

    const searchDirs = parsed.path ? [parsed.path] : ["", "lib", "src"];

    const tryFetch = async (
      filePath: string,
      localPath?: string,
    ): Promise<{
      filePath: string;
      localPath: string;
      content: string;
    } | null> => {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
        const content = await fetchUrl(rawUrl);
        if (content && !content.startsWith("404")) {
          return {
            filePath,
            localPath: localPath ?? path.basename(filePath),
            content,
          };
        }
      } catch {
        /* skip */
      }
      return null;
    };

    const probeFile = async (
      fileName: string,
    ): Promise<{
      filePath: string;
      localPath: string;
      content: string;
    } | null> => {
      for (const dir of searchDirs) {
        const filePath = dir ? `${dir}/${fileName}` : fileName;
        const result = await tryFetch(filePath);
        if (result) {
          return result;
        }
      }
      return null;
    };

    const folderNames: string[] = [];
    const fileNames: string[] = [];

    for (const entry of boardFiles) {
      if (entry.endsWith(".py") || entry.endsWith(".mpy")) {
        const baseName = entry.replace(/\.[^.]+$/, "");
        fileNames.push(`${baseName}.py`);
      } else {
        folderNames.push(entry);
      }
    }

    const results: { filePath: string; localPath: string; content: string }[] =
      [];
    const seen = new Set<string>();

    const addResult = (r: {
      filePath: string;
      localPath: string;
      content: string;
    }) => {
      if (!seen.has(r.filePath)) {
        seen.add(r.filePath);
        results.push(r);
      }
    };

    for (const folder of folderNames) {
      for (const dir of searchDirs) {
        const searchPath = dir ? `${dir}/${folder}` : folder;
        const filePaths = await this._listPyFilesTopLevel(
          owner,
          repo,
          branch,
          searchPath,
        );
        for (const filePath of filePaths) {
          const localPath = `${folder}/${path.basename(filePath)}`;
          const r = await tryFetch(filePath, localPath);
          if (r) {
            addResult(r);
          }
        }
        if (filePaths.length > 0) {
          break;
        }
      }
    }

    for (const fileName of fileNames) {
      const r = await probeFile(fileName);
      if (r) {
        addResult(r);
      }
    }

    // 3. README — best-effort, case-insensitive; always saved locally as README.md
    const readmeCandidates = [
      "README.md",
      "readme.md",
      "Readme.md",
      "README.MD",
    ];
    let readmeFound = false;
    for (const candidate of readmeCandidates) {
      const readme = await probeFile(candidate);
      if (readme) {
        addResult({ ...readme, localPath: "README.md" });
        readmeFound = true;
        break;
      }
    }

    return { files: results, readmeFound };
  }
}
