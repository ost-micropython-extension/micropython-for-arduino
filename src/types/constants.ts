/** Foldername for temporary downloaded boardfiles */
export const FOLDER_OPENED_BOARD_FILES = ".board_cache";
/** Foldername for code support folder */
export const CODE_SUPPORT_FOLDER = ".mpy_codesupport";
/** Foldername for board specific code support subfolder */
export const BOARD_CODE_SUPPORT_SUBFOLDER = "boards";
/** Filename for code support generation log file */
export const CODE_SUPPORT_GENERATION_LOG_FILE =
  "lib-codesupport-generation.log";

/** Enter friendly REPL mode (MicroPython serial control) */
export const CTRL_B = "\x02";
/** KeyboardInterrupt — stops running code (MicroPython serial control) */
export const CTRL_C = "\x03";
/** End-of-transmission / soft reset at >>> prompt (MicroPython serial control) */
export const CTRL_D = "\x04";
/** Paste mode in active mount */
export const CTRL_E = "\x05";
/** Exits Mount */
export const CTRL_X = "\x18";

/** Raw REPL protocol marker (OK) */
export const RAW_REPL_OK = "OK";
/** Raw REPL protocol marker (EOT) */
export const RAW_REPL_EOT = "\x04";
/** Compound sequence: interrupt + friendly REPL */
export const STOP_AND_ENTER_REPL = `\r${CTRL_C}${CTRL_C}\r${CTRL_B}`;
/** Compound sequence: interrupt + friendly REPL (no leading \r) */
export const ENTER_REPL = `${CTRL_C}${CTRL_C}${CTRL_B}`;

/** Returns REPL terminal name */
export const getReplTitle = (port: string) => `REPL (${port})`;
/** Returns Mount REPL terminal name */
export const getMountReplTitle = (port: string) => `Mount REPL (${port})`;
