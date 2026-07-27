import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const spawnMock = vi.fn();

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: (...args: unknown[]) => spawnMock(...args) };
});

const { Adb } = await import("../adb.js");

/** Minimal stand-in for the `adb shell` child process. */
function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    exitCode: number | null;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn() };
  proc.exitCode = null;
  return proc;
}

describe("persistent shell response framing", () => {
  let proc: ReturnType<typeof makeFakeProc>;
  let adb: InstanceType<typeof Adb>;

  beforeEach(() => {
    proc = makeFakeProc();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(proc);
    adb = new Adb();
  });

  it("resolves every command when one chunk carries multiple markers", async () => {
    const pending = Promise.all([
      adb.shellExec("getprop a"),
      adb.shellExec("getprop b"),
      adb.shellExec("getprop c"),
    ]);

    // Fast commands (e.g. the six getprops in getDeviceInfo) coalesce into a
    // single stdout read. Consuming one marker per "data" event stranded the
    // rest, hanging those promises until the 10s timeout and leaving the
    // leftover bytes to be served as stale output to later commands.
    proc.stdout.emit(
      "data",
      Buffer.from("a\n__MCP_DONE__\nb\n__MCP_DONE__\nc\n__MCP_DONE__\n"),
    );

    await expect(pending).resolves.toEqual(["a", "b", "c"]);
  });

  it("keeps responses matched to their commands under concurrency", async () => {
    const labels = Array.from({ length: 12 }, (_, i) => `TOKEN_${i}`);
    const pending = Promise.all(labels.map((l) => adb.shellExec(`echo ${l}`)));

    proc.stdout.emit(
      "data",
      Buffer.from(labels.map((l) => `${l}\n__MCP_DONE__\n`).join("")),
    );

    await expect(pending).resolves.toEqual(labels);
  });

  it("still handles a marker split across two chunks", async () => {
    const pending = adb.shellExec("getprop a");

    proc.stdout.emit("data", Buffer.from("value\n__MCP_D"));
    proc.stdout.emit("data", Buffer.from("ONE__\n"));

    await expect(pending).resolves.toBe("value");
  });
});
