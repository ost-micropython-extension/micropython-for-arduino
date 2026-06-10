import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  CODE_SUPPORT_FOLDER,
  BOARD_CODE_SUPPORT_SUBFOLDER,
} from "../types/constants";

/**
 * Adds path to package to .vscode/settings.json for code support in editor
 */
export function addStubsExtraPath(root: string, packageName: string): void {
  const settingsPath = _settingsPath(root);
  const settings = _readSettings(settingsPath);
  const extraPaths = (settings["python.analysis.extraPaths"] ?? []) as string[];
  if (!extraPaths.includes(`${CODE_SUPPORT_FOLDER}/${packageName}`)) {
    extraPaths.push(`${CODE_SUPPORT_FOLDER}/${packageName}`);
    settings["python.analysis.extraPaths"] = extraPaths;
    _writeSettings(settingsPath, settings);
  }
}

/**
 * Removes path to package from .vscode/settings.json for code support in editor
 */
export function removeStubsExtraPath(root: string, packageName: string): void {
  const settingsPath = _settingsPath(root);
  const settings = _readSettings(settingsPath);
  let extraPaths = (settings["python.analysis.extraPaths"] ?? []) as string[];
  if (extraPaths.includes(`${CODE_SUPPORT_FOLDER}/${packageName}`)) {
    extraPaths = extraPaths.filter(
      (path) => path !== `${CODE_SUPPORT_FOLDER}/${packageName}`,
    );
    settings["python.analysis.extraPaths"] = extraPaths;
    _writeSettings(settingsPath, settings);
  }
}

/**
 * Configures .vscode/settings.json for better code support in editor
 */
export function configureWorkspaceStubs(
  root: string,
  boardStubsRelPath: string,
): void {
  const settingsPath = _settingsPath(root);
  const settings = _readSettings(settingsPath);

  // Replace any previously configured board stubs path with the current one.
  settings["python.analysis.stubPath"] = boardStubsRelPath;

  if (!settings["python.analysis.typeCheckingMode"]) {
    settings["python.analysis.typeCheckingMode"] = "basic";
  }
  // Suppress MicroPython-specific false positives while keeping full stub resolution.
  const overrides = (settings["python.analysis.diagnosticSeverityOverrides"] ??
    {}) as Record<string, string>;
  overrides["reportMissingModuleSource"] = "none"; // stubs-only modules (machine, micropython, …)
  settings["python.analysis.diagnosticSeverityOverrides"] = overrides;
  _writeSettings(settingsPath, settings);
  createAIInstructions(root);
}

function _settingsPath(root: string): string {
  return path.join(root, ".vscode", "settings.json");
}

function _readSettings(settingsPath: string): Record<string, unknown> {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      /* keep empty */
    }
  }
  return {};
}

function _writeSettings(
  settingsPath: string,
  settings: Record<string, unknown>,
): void {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 4));
}

const _SECTION_START = "<!-- micropython-for-arduino:start -->";
const _SECTION_END = "<!-- micropython-for-arduino:end -->";

/**
 * Creates or updates AI instruction files (Copilot / Claude).
 * Depending on User Settings
 */
export function createAIInstructions(root: string) {
  const config = vscode.workspace.getConfiguration("micropython-for-arduino");
  if (config.get<boolean>("generateCopilotInstructions", true)) {
    _updateCopilotInstructionsMd(root);
  }
  if (config.get<boolean>("generateClaudeMd", false)) {
    _updateClaudeMd(root);
  }
}

function _wrapSection(content: string): string {
  return `${_SECTION_START}\n${content}\n${_SECTION_END}`;
}

function _appendSectionIfAbsent(filePath: string, newContent: string): void {
  const existing = fs.readFileSync(filePath, "utf8");
  if (existing.includes(_SECTION_START)) {
    return;
  }
  fs.writeFileSync(
    filePath,
    existing.trimEnd() + "\n\n" + _wrapSection(newContent),
    "utf8",
  );
}

function _updateCopilotInstructionsMd(root: string): void {
  const githubDir = path.join(root, ".github");
  if (!fs.existsSync(githubDir)) {
    fs.mkdirSync(githubDir, { recursive: true });
  }
  const filePath = path.join(githubDir, "copilot-instructions.md");
  const content = _getAIInstuctionContent();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, _wrapSection(content), "utf8");
    return;
  }
  _appendSectionIfAbsent(filePath, content);
}

function _updateClaudeMd(root: string): void {
  const filePath = path.join(root, "CLAUDE.md");
  const content = _getAIInstuctionContent();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, _wrapSection(content), "utf8");
    return;
  }
  _appendSectionIfAbsent(filePath, content);
}

function _getAIInstuctionContent(): string {
  return `# MicroPython Context

## Code Support
\`.vscode/settings.json\` contains the current Board and Libraries.
- **Board**: \`python.analysis.stubPath\` (e.g., nano-esp32)
- **Installed Libraries**: \`python.analysis.extraPaths\`. If there is a folder inside \`from foldername import ...\`, if a file inside just \`import ...\`

## Rules
1. **Use Available Code Support**: Always prioritize functions and classes from the installed libraries in \`extraPaths\`. Do not invent or assume libraries not listed.
2. **Pin Handling**: For external connections, always ask the user for pin details. Use \`Pin(number)\` for numeric pins (e.g. GPIO 0, 3) or \`Pin("A1")\` for named pins (e.g., A4, A5). If user said has an error with the pins try to swap the I2C Pins before anything else.
3. **Fallback**: If no Code Support was found, ask the user to install/reinstall the library or regenerate the library code support. Only suggest alternatives or custom implementations if nothing suitable exists in the code support, and always mark it with a comment like \`# Nothing found in code support: this function might not exist\`.`;
}
