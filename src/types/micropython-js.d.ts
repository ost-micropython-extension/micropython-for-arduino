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

    /** Read a binary file from the board */
    fs_cat_binary(filePath: string): Promise<Uint8Array>;

    /** Upload a local file to the board */
    fs_put(
      src: string,
      dest: string,
      data_consumer?: DataConsumer,
    ): Promise<string>;

    /** Save a string as a file on the board */
    fs_save(
      content: string,
      dest: string,
      data_consumer?: DataConsumer,
    ): Promise<string>;

    /** Delete a file from the board */
    fs_rm(filePath: string): Promise<string>;

    /** Create a directory on the board */
    fs_mkdir(filePath: string): Promise<string>;

    /** Remove an (empty) directory from the board */
    fs_rmdir(filePath: string): Promise<string>;

    /** Rename a file on the board */
    fs_rename(oldPath: string, newPath: string): Promise<string>;
  }

  export = Board;
}
