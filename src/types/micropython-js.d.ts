// Type declarations for arduino/micropython.js (CommonJS module)
// https://github.com/arduino/micropython.js

declare module "micropython.js" {
  /** Serialport port-info object returned by list_ports() */
  interface PortInfo {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    pnpId?: string;
    locationId?: string;
    vendorId?: string;
    productId?: string;
    friendlyName?: string;
  }

  /**
   * Entry returned by fs_ils().
   * Format: [name, type, inode, size]
   * type 0x4000 (16384) = directory, 0x8000 (32768) = file
   */
  type FileEntry = [string, number, number, number];

  /** Called with raw output chunks as they arrive from the board */
  type DataConsumer = (data: string) => void;

  class Board {
    port: string | null;

    serial: any; // SerialPort instance

    /** List available serial ports */
    list_ports(): Promise<PortInfo[]>;

    /** Open serial connection to the board */
    open(path: string): Promise<void>;

    /** Close the serial connection */
    close(): Promise<void>;

    /** Enter raw REPL mode (Ctrl-A) */
    enter_raw_repl(): Promise<string>;

    /** Exit raw REPL mode (Ctrl-B) */
    exit_raw_repl(): Promise<string>;

    /** Execute a raw command string in raw REPL mode */
    exec_raw(cmd: string, data_consumer?: DataConsumer): Promise<string>;

    /** Enter raw REPL, execute a local .py file, exit raw REPL */
    execfile(filePath: string, data_consumer?: DataConsumer): Promise<string>;

    /** Enter raw REPL, execute a code string, exit raw REPL */
    run(code: string, data_consumer?: DataConsumer): Promise<string>;

    /** Write raw bytes to the serial port */
    eval(k: string): Promise<void>;

    /** Send Ctrl-C to interrupt running code */
    stop(): Promise<void>;

    /** Send Ctrl-C + Ctrl-D (soft reset) */
    reset(): Promise<void>;

    /** Send Ctrl-C/Ctrl-B and wait for interactive >>> prompt */
    get_prompt(): Promise<string>;

    /** List files on the board with type/size info */
    fs_ils(folderPath?: string): Promise<FileEntry[]>;

    /** Read a text file from the board */
    fs_cat(filePath: string): Promise<string>;

    /**
     * Read a binary file from the board.
     * `data_consumer` is called with '0%' and '100%', plus percentages in
     * between while the file streams in (e.g. '1%'..'99%').
     */
    fs_cat_binary(
      filePath: string,
      data_consumer?: DataConsumer,
    ): Promise<Buffer>;

    /**
     * Upload a local file to the board. Checks available flash storage
     * first and throws (INSUFFICIENT_SPACE) if it won't fit; cleans up the
     * partial destination file if the transfer is aborted mid-way (e.g. by
     * `data_consumer` throwing to cancel).
     * `data_consumer` is called with a cumulative percentage per chunk —
     * note: as of v2.1.2 this is a bare number, not a "NN%" string (unlike
     * fs_save/fs_cat_binary); parseInt() tolerates either.
     */
    fs_put(
      src: string,
      dest: string,
      data_consumer?: (percent: number | string) => void,
    ): Promise<void>;

    /**
     * Save a string as a file on the board. Same space-check/cleanup and
     * progress behavior as fs_put, but `data_consumer` receives "NN%" strings.
     */
    fs_save(
      content: string,
      dest: string,
      data_consumer?: DataConsumer,
    ): Promise<void>;

    /** Delete a file from the board. Throws (BOARD_ERROR) on failure. */
    fs_rm(filePath: string): Promise<void>;

    /** Create a directory on the board. Throws (BOARD_ERROR) on failure. */
    fs_mkdir(filePath: string): Promise<void>;

    /**
     * Remove an (empty) directory from the board.
     * Throws (BOARD_ERROR) on failure, e.g. if not empty.
     */
    fs_rmdir(filePath: string): Promise<void>;

    /** Rename a file on the board. Throws (BOARD_ERROR) on failure. */
    fs_rename(oldPath: string, newPath: string): Promise<void>;
  }

  export = Board;
}
