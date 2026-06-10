/**
 * VSCode API Mock für Jest Unit- und Integration-Tests (Option A).
 *
 * Da `vscode` kein echtes npm-Paket ist (nur zur Laufzeit innerhalb von VSCode
 * verfügbar), ersetzt dieser Mock das Modul in Jest via moduleNameMapper.
 *
 * Abgedeckte APIs (alle in der Extension genutzten):
 *   - vscode.window   (Messages, QuickPick, InputBox, Terminal, StatusBar, OutputChannel)
 *   - vscode.commands (registerCommand, executeCommand)
 *   - vscode.workspace (findFiles, workspaceFolders)
 *   - vscode.EventEmitter, Uri, Disposable, Enums
 */

// ── EventEmitter ──────────────────────────────────────────────────────────────

export class EventEmitter<T> {
  private _listeners: ((e: T) => void)[] = [];

  readonly event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return {
      dispose: () => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(data: T): void {
    this._listeners.forEach((l) => l(data));
  }

  dispose(): void {
    this._listeners = [];
  }
}

// ── Disposable ────────────────────────────────────────────────────────────────

export class Disposable {
  constructor(private readonly _callOnDispose: () => void) {}

  dispose(): void {
    this._callOnDispose();
  }

  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }
}

// ── Uri ───────────────────────────────────────────────────────────────────────

export const Uri = {
  joinPath: jest.fn((_base: { fsPath: string }, ...parts: string[]) => ({
    fsPath: [_base.fsPath, ...parts].join("/"),
    toString: () => [_base.fsPath, ...parts].join("/"),
  })),
  parse: jest.fn((str: string) => ({ fsPath: str, toString: () => str })),
  file: jest.fn((p: string) => ({ fsPath: p, toString: () => p })),
};

// ── window ────────────────────────────────────────────────────────────────────

export const window = {
  showErrorMessage: jest.fn().mockResolvedValue(undefined),
  showWarningMessage: jest.fn().mockResolvedValue(undefined),
  showInformationMessage: jest.fn().mockResolvedValue(undefined),
  showQuickPick: jest.fn().mockResolvedValue(undefined),
  showInputBox: jest.fn().mockResolvedValue(undefined),

  createStatusBarItem: jest.fn().mockReturnValue({
    text: "",
    tooltip: "",
    command: "",
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  }),

  createOutputChannel: jest.fn().mockReturnValue({
    append: jest.fn(),
    appendLine: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    clear: jest.fn(),
    dispose: jest.fn(),
  }),

  createTerminal: jest.fn().mockReturnValue({
    show: jest.fn(),
    dispose: jest.fn(),
  }),

  onDidCloseTerminal: jest.fn().mockReturnValue({ dispose: jest.fn() }),

  withProgress: jest
    .fn()
    .mockImplementation((_options: unknown, task: () => Promise<unknown>) =>
      task(),
    ),

  registerWebviewViewProvider: jest
    .fn()
    .mockReturnValue({ dispose: jest.fn() }),

  activeTextEditor: undefined as unknown,
};

// ── commands ──────────────────────────────────────────────────────────────────

export const commands = {
  registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  executeCommand: jest.fn().mockResolvedValue(undefined),
};

// ── workspace ─────────────────────────────────────────────────────────────────

export const workspace = {
  findFiles: jest.fn().mockResolvedValue([]),
  workspaceFolders: undefined as unknown,
};

// ── extensions ────────────────────────────────────────────────────────────────

export const extensions = {
  getExtension: jest.fn().mockReturnValue(undefined),
};

// ── Theme ─────────────────────────────────────────────────────────────────────

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

// ── Enums ─────────────────────────────────────────────────────────────────────

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const;
export const QuickPickItemKind = { Default: 0, Separator: -1 } as const;
