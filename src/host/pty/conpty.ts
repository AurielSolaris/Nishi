/**
 * ConPTY — a real pseudoconsole on Windows, through `bun:ffi`.
 *
 * Windows grew a proper pseudoconsole API in Windows 10 1809
 * (`CreatePseudoConsole`), and it is what every modern Windows terminal is
 * built on. This binds it directly rather than depending on `node-pty`.
 *
 * ## Why FFI and not node-pty
 *
 * `node-pty` is a native addon: node-gyp, Visual Studio Build Tools, and a
 * prebuilt binary per platform and per ABI, shipped inside an Electrobun bundle
 * that has its own opinions about what goes in `Resources/`. D10 already
 * rejected a native dependency for the Lua runtime on exactly these grounds. The
 * ConPTY surface we need is five kernel32 functions; binding them costs less
 * than owning a build step.
 *
 * ## The awkward part: reading without blocking
 *
 * `ReadFile` on a pipe blocks until bytes arrive, and there is no async variant
 * reachable through FFI without overlapped I/O and an event loop of its own. The
 * three ways out are a worker thread doing blocking reads, overlapped I/O, or
 * polling `PeekNamedPipe` — which reports how many bytes are waiting and never
 * blocks.
 *
 * This uses the poll. A worker would mean a second bundler entry point inside
 * the Electrobun build, and overlapped I/O means hand-rolling completion
 * handling in FFI. The poll is a timer and two calls, its worst-case added
 * latency is the interval, and at 8ms that is well under a frame — nobody can
 * feel it, and terminal output arrives in bursts anyway.
 */

import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

const kernel32 = dlopen("kernel32.dll", {
  CreatePseudoConsole: {
    args: [FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  ResizePseudoConsole: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  ClosePseudoConsole: { args: [FFIType.ptr], returns: FFIType.void },

  CreatePipe: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  ReadFile: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  WriteFile: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  PeekNamedPipe: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },

  InitializeProcThreadAttributeList: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
    returns: FFIType.i32,
  },
  UpdateProcThreadAttribute: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
    returns: FFIType.i32,
  },
  DeleteProcThreadAttributeList: { args: [FFIType.ptr], returns: FFIType.void },

  CreateProcessW: {
    args: [
      FFIType.ptr, // lpApplicationName
      FFIType.ptr, // lpCommandLine (mutable)
      FFIType.ptr, // lpProcessAttributes
      FFIType.ptr, // lpThreadAttributes
      FFIType.i32, // bInheritHandles
      FFIType.u32, // dwCreationFlags
      FFIType.ptr, // lpEnvironment
      FFIType.ptr, // lpCurrentDirectory
      FFIType.ptr, // lpStartupInfo (STARTUPINFOEXW)
      FFIType.ptr, // lpProcessInformation
    ],
    returns: FFIType.i32,
  },
  GetExitCodeProcess: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  TerminateProcess: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  GetLastError: { args: [], returns: FFIType.u32 },
});

const K = kernel32.symbols;

const EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
const STILL_ACTIVE = 259;

/** Handles are pointer-sized; a 64-bit slot holds one on either architecture. */
const HANDLE_SIZE = 8;

/** Read a pointer-sized handle out of a scratch buffer. */
function handleAt(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

/**
 * A handle value we can hand back to FFI as a pointer argument.
 *
 * Bun's FFI rejects a BigInt for a pointer parameter outright
 * ("Unable to convert 620 to a pointer"), so handles read out of a struct with
 * `getBigUint64` have to come back to a Number before they are passed on.
 * Windows HANDLEs are small kernel-table indices in practice, well inside the
 * safe integer range.
 */
function asPointer(handle: bigint): Pointer {
  return Number(handle) as Pointer;
}

function lastError(context: string): Error {
  return new Error(`${context} failed (GetLastError ${K.GetLastError()})`);
}

/** UTF-16LE, NUL-terminated — what every -W entry point wants. */
function wide(text: string): Uint8Array {
  const buffer = new Uint8Array((text.length + 1) * 2);
  const view = new DataView(buffer.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  view.setUint16(text.length * 2, 0, true);
  return buffer;
}

/** COORD is two shorts packed into a DWORD: X low, Y high. */
function coord(columns: number, rows: number): number {
  return ((rows & 0xffff) << 16) | (columns & 0xffff);
}

export type ConptyOptions = {
  /** Full command line, already quoted. CreateProcessW parses it itself. */
  commandLine: string;
  cwd: string;
  env: Record<string, string>;
  columns: number;
  rows: number;
};

/**
 * A live pseudoconsole and the process attached to it.
 *
 * Handles are kept as bigints rather than being wrapped, because every one of
 * them has to go back to FFI unchanged and a wrapper would only add a place for
 * the value to be mangled.
 */
export class Conpty {
  #hpc: bigint;
  #input: bigint; // our write end -> the console's stdin
  #output: bigint; // our read end <- the console's stdout
  #process: bigint;
  #thread: bigint;
  #attributeList: Uint8Array;
  #closed = false;

  /** Scratch buffers, reused so a read per poll tick is not a fresh allocation. */
  #readBuffer = new Uint8Array(65536);
  #countScratch = new Uint8Array(4);

  private constructor(parts: {
    hpc: bigint;
    input: bigint;
    output: bigint;
    process: bigint;
    thread: bigint;
    attributeList: Uint8Array;
  }) {
    this.#hpc = parts.hpc;
    this.#input = parts.input;
    this.#output = parts.output;
    this.#process = parts.process;
    this.#thread = parts.thread;
    this.#attributeList = parts.attributeList;
  }

  static open(options: ConptyOptions): Conpty {
    // Two pipes, crossed: the console reads from one and writes to the other,
    // and we hold the opposite end of each.
    const toConsole = new Uint8Array(HANDLE_SIZE * 2);
    const fromConsole = new Uint8Array(HANDLE_SIZE * 2);
    const toView = new DataView(toConsole.buffer);
    const fromView = new DataView(fromConsole.buffer);

    if (!K.CreatePipe(ptr(toConsole), ptr(toConsole, HANDLE_SIZE), null, 0)) {
      throw lastError("CreatePipe (input)");
    }
    if (!K.CreatePipe(ptr(fromConsole), ptr(fromConsole, HANDLE_SIZE), null, 0)) {
      throw lastError("CreatePipe (output)");
    }

    const consoleReads = handleAt(toView, 0); // console's stdin
    const weWrite = handleAt(toView, HANDLE_SIZE);
    const weRead = handleAt(fromView, 0);
    const consoleWrites = handleAt(fromView, HANDLE_SIZE); // console's stdout

    const hpcOut = new Uint8Array(HANDLE_SIZE);
    const created = K.CreatePseudoConsole(
      coord(options.columns, options.rows),
      asPointer(consoleReads),
      asPointer(consoleWrites),
      0,
      ptr(hpcOut),
    );
    if (created !== 0) {
      throw new Error(
        `CreatePseudoConsole failed (HRESULT 0x${(created >>> 0).toString(16)}). ` +
          "ConPTY needs Windows 10 1809 or newer.",
      );
    }
    const hpc = handleAt(new DataView(hpcOut.buffer), 0);

    // The pseudoconsole owns its ends now; ours would otherwise keep the pipes
    // alive after the child exits and the read would never see EOF.
    K.CloseHandle(asPointer(consoleReads));
    K.CloseHandle(asPointer(consoleWrites));

    // STARTUPINFOEXW carries an attribute list whose single entry hands the
    // pseudoconsole to the child. Without it the child gets an ordinary console
    // and none of this works.
    const sizeScratch = new Uint8Array(8);
    K.InitializeProcThreadAttributeList(null, 1, 0, ptr(sizeScratch));
    const attributeSize = Number(new DataView(sizeScratch.buffer).getBigUint64(0, true));
    const attributeList = new Uint8Array(attributeSize);

    if (!K.InitializeProcThreadAttributeList(ptr(attributeList), 1, 0, ptr(sizeScratch))) {
      throw lastError("InitializeProcThreadAttributeList");
    }

    const hpcSlot = new Uint8Array(HANDLE_SIZE);
    new DataView(hpcSlot.buffer).setBigUint64(0, hpc, true);

    if (
      !K.UpdateProcThreadAttribute(
        ptr(attributeList),
        0,
        BigInt(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE),
        ptr(hpcSlot),
        BigInt(HANDLE_SIZE),
        null,
        null,
      )
    ) {
      throw lastError("UpdateProcThreadAttribute");
    }

    // STARTUPINFOEXW = STARTUPINFOW (104 bytes on x64) + a pointer.
    const STARTUPINFOW_SIZE = 104;
    const startupInfo = new Uint8Array(STARTUPINFOW_SIZE + 8);
    const startupView = new DataView(startupInfo.buffer);
    startupView.setUint32(0, STARTUPINFOW_SIZE + 8, true); // cb
    startupView.setBigUint64(STARTUPINFOW_SIZE, BigInt(ptr(attributeList)), true);

    // CreateProcessW may write to the command line buffer, so it cannot be a
    // literal — this is a real requirement of the API, not defensiveness.
    const commandLine = wide(options.commandLine);
    const cwd = wide(options.cwd);
    const environment = packEnvironment(options.env);
    const processInfo = new Uint8Array(24); // hProcess, hThread, dwPid, dwTid

    const ok = K.CreateProcessW(
      null,
      ptr(commandLine),
      null,
      null,
      0, // handles are passed through the attribute list, not inherited
      EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
      ptr(environment),
      ptr(cwd),
      ptr(startupInfo),
      ptr(processInfo),
    );

    if (!ok) {
      const error = lastError(`CreateProcessW (${options.commandLine})`);
      // Our pipe ends go first — see the note on dispose(). Closing the
      // pseudoconsole while nothing is draining its output deadlocks, and on
      // this path there is no reader at all.
      K.CloseHandle(asPointer(weRead));
      K.CloseHandle(asPointer(weWrite));
      K.ClosePseudoConsole(asPointer(hpc));
      K.DeleteProcThreadAttributeList(ptr(attributeList));
      throw error;
    }

    const processView = new DataView(processInfo.buffer);
    return new Conpty({
      hpc,
      input: weWrite,
      output: weRead,
      process: handleAt(processView, 0),
      thread: handleAt(processView, HANDLE_SIZE),
      attributeList,
    });
  }

  /** Bytes waiting on the output pipe, or -1 once the pipe is broken. */
  #available(): number {
    if (this.#closed) return -1;
    const scratch = this.#countScratch;
    const ok = K.PeekNamedPipe(
      asPointer(this.#output),
      null,
      0,
      null,
      ptr(scratch),
      null,
    );
    if (!ok) return -1; // ERROR_BROKEN_PIPE — the child is gone
    return new DataView(scratch.buffer).getUint32(0, true);
  }

  /**
   * Drain whatever the console has produced.
   *
   * Returns null when the pipe is broken, which is how the caller learns the
   * child exited without having to poll the process handle separately.
   */
  read(): Uint8Array | null {
    const waiting = this.#available();
    if (waiting < 0) return null;
    if (waiting === 0) return new Uint8Array(0);

    const want = Math.min(waiting, this.#readBuffer.length);
    const readScratch = new Uint8Array(4);
    const ok = K.ReadFile(
      asPointer(this.#output),
      ptr(this.#readBuffer),
      want,
      ptr(readScratch),
      null,
    );
    if (!ok) return null;

    const got = new DataView(readScratch.buffer).getUint32(0, true);
    if (got === 0) return new Uint8Array(0);
    // Copy out: the read buffer is reused on the next tick, and the caller may
    // hold this chunk until it has a whole UTF-8 sequence to decode.
    return this.#readBuffer.slice(0, got);
  }

  write(data: Uint8Array): void {
    if (this.#closed || data.length === 0) return;
    const written = new Uint8Array(4);
    if (!K.WriteFile(asPointer(this.#input), ptr(data), data.length, ptr(written), null)) {
      // The child has gone. Not worth throwing at a keystroke.
      this.#closed = true;
    }
  }

  resize(columns: number, rows: number): void {
    if (this.#closed) return;
    K.ResizePseudoConsole(asPointer(this.#hpc), coord(columns, rows));
  }

  /** Exit code, or null while the process is still running. */
  exitCode(): number | null {
    const scratch = new Uint8Array(4);
    if (!K.GetExitCodeProcess(asPointer(this.#process), ptr(scratch))) return 0;
    const code = new DataView(scratch.buffer).getUint32(0, true);
    return code === STILL_ACTIVE ? null : code;
  }

  kill(): void {
    if (this.#closed) return;
    K.TerminateProcess(asPointer(this.#process), 1);
  }

  /**
   * Tear the session down.
   *
   * **Close our read end first.** `ClosePseudoConsole` flushes whatever the
   * console still holds into the output pipe before returning, and if nobody
   * drains it the pipe fills and the call blocks — forever, on this thread,
   * which is also the thread the poll timer runs on, so nothing will ever drain
   * it. Dropping our read end first makes that flush fail fast instead.
   *
   * This is not theoretical: it is the deadlock that hung the first working
   * version of this file, and it hangs silently with no error to go on.
   */
  dispose(): void {
    if (this.#closed) return;
    this.#closed = true;

    K.CloseHandle(asPointer(this.#output));
    K.CloseHandle(asPointer(this.#input));
    K.ClosePseudoConsole(asPointer(this.#hpc));
    K.DeleteProcThreadAttributeList(ptr(this.#attributeList));
    K.CloseHandle(asPointer(this.#thread));
    K.CloseHandle(asPointer(this.#process));
  }
}

/**
 * The Windows environment block: `KEY=VALUE\0KEY=VALUE\0\0`, UTF-16LE.
 *
 * Sorted because the API documents the block as sorted and some programs care.
 */
function packEnvironment(env: Record<string, string>): Uint8Array {
  const entries = Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .sort((a, b) => a.localeCompare(b));

  const text = `${entries.join("\0")}\0\0`;
  const buffer = new Uint8Array(text.length * 2);
  const view = new DataView(buffer.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(i * 2, text.charCodeAt(i), true);
  return buffer;
}
