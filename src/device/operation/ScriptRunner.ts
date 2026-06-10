import * as vscode from "vscode";
import MicroPython = require("micropython.js");
import { RAW_REPL_EOT, RAW_REPL_OK } from "../../types/constants";

interface ScriptTerminal {
  terminal: vscode.Terminal;
  writeEmitter: vscode.EventEmitter<string>;
  isOpen: boolean;
  queue: string[];
  inputHandler: ((data: string) => void) | null;
}

const scriptTerminals = new Map<string, ScriptTerminal>();

vscode.window.onDidCloseTerminal((terminal) => {
  for (const [port, entry] of scriptTerminals) {
    if (entry.terminal === terminal) {
      entry.writeEmitter.dispose();
      scriptTerminals.delete(port);
      break;
    }
  }
});

/**
 * Returns run output terminal
 */
function getOrCreateTerminal(port: string): ScriptTerminal {
  const existing = scriptTerminals.get(port);
  if (existing) {
    return existing;
  }

  const writeEmitter = new vscode.EventEmitter<string>();
  const entry: ScriptTerminal = {
    terminal: null!,
    writeEmitter,
    isOpen: false,
    queue: [],
    inputHandler: null,
  };

  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    open: () => {
      entry.isOpen = true;
      for (const data of entry.queue) {
        writeEmitter.fire(data);
      }
      entry.queue = [];
    },
    close: () => {
      scriptTerminals.delete(port);
    },
    handleInput: (data: string) => {
      entry.inputHandler?.(data);
    },
  };

  entry.terminal = vscode.window.createTerminal({
    name: `MicroPython (${port})`,
    pty,
    iconPath: new vscode.ThemeIcon("run"),
    color: new vscode.ThemeColor("terminal.ansiBrightBlue"),
  });

  scriptTerminals.set(port, entry);
  return entry;
}

/**
 * Writes the text to the terminal
 */
function termWrite(entry: ScriptTerminal, text: string): void {
  const normalized = text.replace(/\r?\n/g, "\r\n");
  if (entry.isOpen) {
    entry.writeEmitter.fire(normalized);
  } else {
    entry.queue.push(normalized);
  }
}

/**
 * Runs code on the board and prints output to terminal
 */
export async function runCode(
  board: InstanceType<typeof MicroPython>,
  code: string,
  port: string,
  name?: string,
): Promise<void> {
  const entry = getOrCreateTerminal(port);
  entry.terminal.show(true);

  termWrite(entry, `--- Start: ${name || "Selection"} ---\r\n`);

  let seenOK = false;
  let stdoutDone = false;
  let pending = "";

  const dataConsumer = (chunk: string) => {
    pending += chunk;
    if (!seenOK) {
      const idx = pending.indexOf(RAW_REPL_OK);
      if (idx === -1) {
        return;
      }
      pending = pending.slice(idx + 2);
      seenOK = true;
    }
    if (stdoutDone) {
      return;
    }
    const eot = pending.indexOf(RAW_REPL_EOT);
    if (eot === -1) {
      termWrite(entry, pending);
      pending = "";
    } else {
      const text = pending.slice(0, eot);
      if (text) {
        termWrite(entry, text);
      }
      pending = pending.slice(eot + 1);
      stdoutDone = true;
    }
  };

  try {
    entry.inputHandler = (data: string) => board.serial?.write(data);
    const raw = await board.run(code, dataConsumer);
    entry.inputHandler = null;

    const stderr = extractStderr(raw);
    if (stderr) {
      termWrite(entry, "--- Error ---\r\n");
      termWrite(entry, stderr);
    } else if (!seenOK) {
      termWrite(entry, extractOutput(raw));
    }
    termWrite(entry, "--- Done ---\r\n\r\n");
  } catch (err: any) {
    entry.inputHandler = null;
    if (err.message?.includes("pre stop")) {
      termWrite(entry, "--- Stopped ---\r\n\r\n");
      return;
    }
    throw err;
  }
}

/**
 * Runs boardfile on the board and prints output to terminal
 */
export async function runBoardFile(
  board: InstanceType<typeof MicroPython>,
  filePath: string,
  port: string,
): Promise<void> {
  const entry = getOrCreateTerminal(port);
  entry.terminal.show(true);

  termWrite(entry, `--- Start: ${filePath} (board) ---\r\n`);

  let seenOK = false;
  let stdoutDone = false;
  let pending = "";

  const dataConsumer = (chunk: string) => {
    pending += chunk;

    if (!seenOK) {
      const idx = pending.indexOf(RAW_REPL_OK);
      if (idx === -1) {
        return;
      }
      pending = pending.slice(idx + 2);
      seenOK = true;
    }

    if (stdoutDone) {
      return;
    }

    const eot = pending.indexOf(RAW_REPL_EOT);

    if (eot === -1) {
      termWrite(entry, pending);
      pending = "";
    } else {
      const text = pending.slice(0, eot);
      if (text) {
        termWrite(entry, text);
      }
      pending = pending.slice(eot + 1);
      stdoutDone = true;
    }
  };

  const remotePath = filePath.replace(/\\/g, "/");

  const code = `
try:
    with open('${remotePath}', 'r') as f:
        exec(f.read(), globals())
    print("--- Done ---")
except Exception as e:
    import sys
    sys.print_exception(e)
    print("--- Failed ---")
`;

  try {
    entry.inputHandler = (data: string) => board.serial?.write(data);
    const raw = await board.run(code, dataConsumer);
    entry.inputHandler = null;

    const stderr = extractStderr(raw);

    if (stderr) {
      termWrite(entry, "--- Error ---\r\n");
      termWrite(entry, stderr);
    } else if (!seenOK) {
      termWrite(entry, extractOutput(raw));
    }
  } catch (err) {
    entry.inputHandler = null;
    if ((err as Error).message.includes("pre stop")) {
      termWrite(entry, "--- Stopped ---\r\n");
      return;
    }
    throw err;
  } finally {
    termWrite(entry, "\r\n");
  }
}

/**
 * Extracts clean stdout+stderr from micropython.js raw REPL output.
 * Raw format: "OK{stdout}\x04{stderr}\x04>"
 * Used as fallback when the data_consumer did not fire.
 */
export function extractOutput(raw: string): string {
  const okIdx = raw.indexOf(RAW_REPL_OK);
  if (okIdx === -1) {
    return raw;
  }
  const afterOk = raw.slice(okIdx + 2);
  const stdoutEnd = afterOk.indexOf(RAW_REPL_EOT);
  const stdout = stdoutEnd !== -1 ? afterOk.slice(0, stdoutEnd) : afterOk;
  const stderrStart = stdoutEnd !== -1 ? stdoutEnd + 1 : -1;
  const stderrEnd =
    stderrStart !== -1 ? afterOk.indexOf(RAW_REPL_EOT, stderrStart) : -1;
  const stderr =
    stderrStart !== -1
      ? stderrEnd !== -1
        ? afterOk.slice(stderrStart, stderrEnd)
        : afterOk.slice(stderrStart)
      : "";
  return stderr ? `${stdout}\r\n--- Error ---\r\n${stderr}` : stdout;
}

/**
 * Extracts only stderr from raw REPL output (stdout was already streamed live).
 */
export function extractStderr(raw: string): string {
  const okIdx = raw.indexOf(RAW_REPL_OK);
  if (okIdx === -1) {
    return "";
  }
  const afterOk = raw.slice(okIdx + 2);
  const eot1 = afterOk.indexOf(RAW_REPL_EOT);
  if (eot1 === -1) {
    return "";
  }
  const afterEOT1 = afterOk.slice(eot1 + 1);
  const eot2 = afterEOT1.indexOf(RAW_REPL_EOT);
  return eot2 !== -1 ? afterEOT1.slice(0, eot2) : afterEOT1;
}
