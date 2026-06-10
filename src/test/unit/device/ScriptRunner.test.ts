import {
  extractOutput,
  extractStderr,
} from "../../../device/operation/ScriptRunner";

const EOT = "\x04";

// ── extractOutput ────────────────────────────────────────────────────────────

describe("extractOutput", () => {
  it("returns the raw string unchanged when no OK marker is present", () => {
    expect(extractOutput("no ok here")).toBe("no ok here");
  });

  it("returns empty string when stdout and stderr are both empty", () => {
    expect(extractOutput(`OK${EOT}${EOT}>`)).toBe("");
  });

  it("returns stdout when there is no stderr", () => {
    expect(extractOutput(`OKhello${EOT}${EOT}>`)).toBe("hello");
  });

  it("appends a stderr section when stderr is non-empty", () => {
    expect(extractOutput(`OKhello${EOT}error text${EOT}>`)).toBe(
      `hello\r\n--- Error ---\r\nerror text`,
    );
  });

  it("includes stderr section when stdout is empty", () => {
    expect(extractOutput(`OK${EOT}error text${EOT}>`)).toBe(
      `\r\n--- Error ---\r\nerror text`,
    );
  });

  it("returns only stdout when there is no second EOT (stderr section absent)", () => {
    expect(extractOutput(`OKhello${EOT}`)).toBe("hello");
  });

  it("strips content after the second EOT (trailing prompt)", () => {
    expect(extractOutput(`OKstdout${EOT}stderr${EOT}>prompt`)).toBe(
      `stdout\r\n--- Error ---\r\nstderr`,
    );
  });

  it("handles multiline stdout", () => {
    expect(extractOutput(`OKline1\nline2${EOT}${EOT}>`)).toBe("line1\nline2");
  });
});

// ── extractStderr ────────────────────────────────────────────────────────────

describe("extractStderr", () => {
  it("returns empty string for empty input", () => {
    expect(extractStderr("")).toBe("");
  });

  it("returns empty string when no OK marker is present", () => {
    expect(extractStderr("no ok")).toBe("");
  });

  it("returns empty string when there is no EOT after OK", () => {
    expect(extractStderr("OKhello")).toBe("");
  });

  it("returns empty string when stderr is empty (two consecutive EOTs)", () => {
    expect(extractStderr(`OKhello${EOT}${EOT}>`)).toBe("");
  });

  it("extracts stderr from between the two EOT markers", () => {
    expect(extractStderr(`OKhello${EOT}error text${EOT}>`)).toBe("error text");
  });

  it("returns everything after the first EOT as stderr when the closing EOT is absent", () => {
    expect(extractStderr(`OKhello${EOT}error text`)).toBe("error text");
  });

  it("handles multiline stderr", () => {
    expect(extractStderr(`OKhello${EOT}line1\nline2${EOT}>`)).toBe(
      "line1\nline2",
    );
  });

  it("returns empty string when only the first EOT is present and nothing follows", () => {
    expect(extractStderr(`OKhello${EOT}`)).toBe("");
  });
});
