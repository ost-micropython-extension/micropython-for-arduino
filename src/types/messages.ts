import { BoardState } from "./boardState";

/** Messages sent FROM the Webview TO the Extension */
export type WebviewMessage =
  // State
  | { type: "initialize" }
  | { type: "setExpanded_workspace"; value: Array<[string, boolean]> }
  | { type: "setExpanded_boardfiles"; value: Array<[string, boolean]> }
  // Connection
  | { type: "getPorts" }
  | { type: "openPort"; port: string }
  | { type: "closePort"; port: string }
  | { type: "setCurrent"; port: string | undefined }
  // Board actions
  | { type: "runFile"; port: string }
  | { type: "runSelection"; port: string }
  | { type: "connect"; port: string }
  | { type: "stopFile"; port: string }
  | { type: "softReset"; port: string }
  // Workspace file actions
  | { type: "getWorkspaceFiles" }
  | { type: "ws_openFile"; path: string }
  | { type: "ws_openFilePinned"; path: string }
  | { type: "ws_delete"; path: string }
  | { type: "ws_rename"; path: string; isFolder: boolean }
  | { type: "ws_createFile"; folderPath: string }
  | { type: "ws_createFolder"; folderPath: string }
  | { type: "ws_uploadFile"; port: string; path: string }
  | { type: "ws_move"; nodePath: string; targetPath: string }
  // Board file actions
  | { type: "getBoardFiles"; port: string }
  | { type: "bf_openFile"; path: string; port: string }
  | { type: "bf_openFilePinned"; path: string; port: string }
  | { type: "bf_delete"; path: string; isFolder: boolean; port: string }
  | { type: "bf_rename"; path: string; isFolder: boolean; port: string }
  | { type: "bf_createFile"; folderPath: string; port: string }
  | { type: "bf_createFolder"; folderPath: string; port: string }
  | { type: "bf_downloadFile"; path: string; port: string }
  | { type: "bf_runFile"; path: string; port: string }
  | { type: "bf_move"; port: string; nodePath: string; targetPath: string }
  // Mount
  | { type: "toggleMount"; port: string }
  // Code Support
  | { type: "generateLibraryStubs"; port: string }
  | { type: "activateCodeSupport"; name: string }
  | { type: "deactivateCodeSupport"; name: string }
  | { type: "updateCodeSupport"; libs: string[] }
  // Libraries
  | { type: "getInstalledLibraries"; port: string }
  | { type: "getLibraries" }
  | { type: "installLibrary"; url: string; name: string; port: string }
  | { type: "uninstallLibrary"; id: string; displayName: string; port: string };

/** Messages sent FROM the Extension TO the Webview */
export type ExtensionMessage =
  | {
      type: "init";
      value: {
        expandedWSNodes: Array<[string, boolean]>;
        expandedBFNodes: Array<[string, boolean]>;
        ports: PortInfo[];
      };
    }
  | { type: "activeFileChanged"; path: string }
  | { type: "boardState"; port: string; value: BoardState }
  // Connection
  | { type: "ports"; value: PortInfo[] }
  | { type: "disconnected"; port: string }
  // Workspace file tree
  | { type: "workspaceFiles"; nodes: FileNode[]; error?: string }
  | { type: "refreshWorkspace" }
  | {
      type: "ws_nodeCreated";
      parentId: string;
      node: FileNode;
      select?: boolean;
    }
  | { type: "ws_nodeDeleted"; nodeId: string }
  | { type: "ws_nodeRenamed"; nodeId: string; newId: string; newName: string }
  // Board file tree
  | { type: "boardFiles"; port: string; nodes: FileNode[]; error?: string }
  | { type: "refreshBoardFiles"; port: string }
  | {
      type: "bf_nodeCreated";
      port: string;
      parentId: string;
      node: FileNode;
      select?: boolean;
    }
  | { type: "bf_nodeDeleted"; port: string; nodeId: string }
  | {
      type: "bf_nodeRenamed";
      port: string;
      nodeId: string;
      newId: string;
      newName: string;
    }
  // Libraries
  | { type: "installedLibraries"; value: object[]; port: string }
  | { type: "libraries"; value: LibraryEntry[] }
  | { type: "installResult"; success: boolean }
  | { type: "uninstallResult"; success: boolean }
  | { type: "codeSupport"; value: CodeSupportItem[] };

export interface PortInfo {
  path: string;
  description: string;
  hasMicroPython: boolean;
  boardName?: string;
}

export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  root?: boolean;
  children?: FileNode[];
  meta?: {
    size?: number;
  };
}

export interface LibraryEntry {
  name: string;
  url: string;
  author: string;
  description: string;
  tags: string[];
}

export interface ManifestEntry {
  url: string;
  displayName?: string;
  version?: string;
  installedAt?: string;
  files?: string[];
}

export interface LibraryManifest {
  packages: Record<string, ManifestEntry>;
}

export interface CodeSupportItem {
  displayName: string;
  installed: boolean;
  codesupport: boolean;
  active: boolean;
}
