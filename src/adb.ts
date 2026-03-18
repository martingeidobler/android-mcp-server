import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

export interface UiElement {
  index: number;
  resourceId: string;
  text: string;
  contentDesc: string;
  className: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  checked: boolean;
  scrollable: boolean;
}

export function discoverPath(toolRelativePath: string, fallbackName: string): string {
  const androidHome = process.env.ANDROID_HOME;
  if (androidHome) {
    const p = join(androidHome, toolRelativePath);
    if (existsSync(p)) return p;
  }
  const defaultSdkPath = join(homedir(), "Library", "Android", "sdk", toolRelativePath);
  if (existsSync(defaultSdkPath)) return defaultSdkPath;
  return fallbackName;
}

export function parseBounds(boundsStr: string): { x: number; y: number; width: number; height: number } | null {
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = parseInt(match[1], 10);
  const top = parseInt(match[2], 10);
  const right = parseInt(match[3], 10);
  const bottom = parseInt(match[4], 10);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function escapeShellText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "%s")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/&/g, "\\&")
    .replace(/\|/g, "\\|")
    .replace(/;/g, "\\;")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>");
}

export class Adb {
  private adbPath: string;
  private emulatorPath: string;
  private deviceInfoCache = new Map<string, {
    model: string;
    manufacturer: string;
    androidVersion: string;
    apiLevel: string;
    screenSize: string;
    density: string;
  }>();
  private persistentShells = new Map<string, {
    process: ReturnType<typeof spawn>;
    pending: Array<{ resolve: (value: string) => void; reject: (reason: Error) => void; output: string }>;
  }>();

  constructor() {
    this.adbPath = discoverPath(join("platform-tools", "adb"), "adb");
    this.emulatorPath = discoverPath(join("emulator", "emulator"), "emulator");
  }

  private getShellKey(deviceId?: string): string {
    return deviceId ?? "__default__";
  }

  private getPersistentShell(deviceId?: string): {
    process: ReturnType<typeof spawn>;
    pending: Array<{ resolve: (value: string) => void; reject: (reason: Error) => void; output: string }>;
  } {
    const key = this.getShellKey(deviceId);
    const existing = this.persistentShells.get(key);
    if (existing && existing.process.exitCode === null) return existing;

    const args = deviceId ? ["-s", deviceId, "shell"] : ["shell"];
    const proc = spawn(this.adbPath, args, { stdio: ["pipe", "pipe", "pipe"] });

    const entry = {
      process: proc,
      pending: [] as Array<{ resolve: (value: string) => void; reject: (reason: Error) => void; output: string }>,
    };

    let buffer = "";
    proc.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const markerIdx = buffer.indexOf("__MCP_DONE__");
      if (markerIdx !== -1) {
        const output = buffer.substring(0, markerIdx).trimEnd();
        buffer = buffer.substring(markerIdx + "__MCP_DONE__\n".length);
        const req = entry.pending.shift();
        if (req) req.resolve(output);
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      const req = entry.pending[0];
      if (req) req.output += chunk.toString();
    });

    proc.on("close", () => {
      this.persistentShells.delete(key);
      for (const req of entry.pending) {
        req.reject(new Error("Persistent shell closed unexpectedly"));
      }
      entry.pending.length = 0;
    });

    this.persistentShells.set(key, entry);
    return entry;
  }

  async shellExec(command: string, deviceId?: string): Promise<string> {
    const shell = this.getPersistentShell(deviceId);
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = shell.pending.indexOf(entry);
        if (idx !== -1) shell.pending.splice(idx, 1);
        reject(new Error(`Shell command timed out: ${command}`));
      }, 10_000);

      const entry = {
        resolve: (value: string) => { clearTimeout(timer); resolve(value); },
        reject: (reason: Error) => { clearTimeout(timer); reject(reason); },
        output: "",
      };
      shell.pending.push(entry);
      shell.process.stdin!.write(`${command}; echo __MCP_DONE__\n`);
    });
  }

  async exec(args: string[], deviceId?: string): Promise<string> {
    // Use persistent shell for shell commands
    if (args[0] === "shell" && args.length >= 2) {
      return this.shellExec(args.slice(1).join(" "), deviceId);
    }
    const fullArgs = deviceId ? ["-s", deviceId, ...args] : args;
    const { stdout } = await execFileAsync(this.adbPath, fullArgs, {
      timeout: 10_000,
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  }

  async execBuffer(args: string[], deviceId?: string): Promise<Buffer> {
    const fullArgs = deviceId ? ["-s", deviceId, ...args] : args;
    return new Promise<Buffer>((resolve, reject) => {
      execFile(
        this.adbPath,
        fullArgs,
        { timeout: 10_000, maxBuffer: 50 * 1024 * 1024, encoding: "buffer" },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`adb ${fullArgs.join(" ")} failed: ${stderr?.toString() ?? error.message}`));
            return;
          }
          resolve(stdout as unknown as Buffer);
        },
      );
    });
  }

  async getDevices(): Promise<Array<{ id: string; state: string; model?: string }>> {
    const output = await this.exec(["devices", "-l"]);
    const lines = output.split("\n").filter((l) => l.trim() && !l.startsWith("List of"));
    return lines.map((line) => {
      const parts = line.trim().split(/\s+/);
      const id = parts[0];
      const state = parts[1];
      const modelMatch = line.match(/model:(\S+)/);
      return { id, state, model: modelMatch?.[1] };
    }).filter((d) => d.id && d.state);
  }

  async getAvds(): Promise<string[]> {
    const { stdout } = await execFileAsync(this.emulatorPath, ["-list-avds"], {
      timeout: 10_000,
    });
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async startEmulator(avdName: string): Promise<string> {
    const beforeDevices = await this.getDevices();
    const beforeIds = new Set(beforeDevices.map((d) => d.id));

    const child = spawn(this.emulatorPath, ["-avd", avdName], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const maxWaitMs = 60_000;
    const pollIntervalMs = 2_000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const currentDevices = await this.getDevices();
      const newDevice = currentDevices.find(
        (d) => !beforeIds.has(d.id) && d.state === "device",
      );
      if (newDevice) return newDevice.id;
    }

    throw new Error(`Emulator "${avdName}" did not come online within ${maxWaitMs / 1000}s`);
  }

  async screenshot(deviceId?: string): Promise<Buffer> {
    return this.execBuffer(["exec-out", "screencap", "-p"], deviceId);
  }

  async getUiTree(deviceId?: string): Promise<UiElement[]> {
    let xml: string;
    try {
      const raw = await this.exec(["shell", "uiautomator", "dump", "/dev/tty"], deviceId);
      const xmlStart = raw.indexOf("<?xml");
      const hierarchyStart = raw.indexOf("<hierarchy");
      const start = xmlStart !== -1 ? xmlStart : hierarchyStart;
      if (start === -1) throw new Error("No XML found in /dev/tty output");
      xml = raw.substring(start);
    } catch {
      await this.exec(["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"], deviceId);
      xml = await this.exec(["shell", "cat", "/sdcard/window_dump.xml"], deviceId);
    }

    return this.parseUiXml(xml);
  }

  parseUiXml(xml: string): UiElement[] {
    const elements: UiElement[] = [];
    const nodeRegex = /<node\s[^>]*?\/?>/g;
    let match: RegExpExecArray | null;

    while ((match = nodeRegex.exec(xml)) !== null) {
      const tag = match[0];

      const attr = (name: string): string => {
        const m = tag.match(new RegExp(`${name}="([^"]*)"`));
        return m ? m[1] : "";
      };

      const resourceId = attr("resource-id");
      const text = attr("text");
      const contentDesc = attr("content-desc");
      const clickable = attr("clickable") === "true";

      if (!resourceId && !text && !contentDesc && !clickable) continue;

      const boundsStr = attr("bounds");
      const bounds = parseBounds(boundsStr);
      if (!bounds) continue;

      elements.push({
        index: parseInt(attr("index"), 10) || 0,
        resourceId,
        text,
        contentDesc,
        className: attr("class"),
        bounds,
        center: {
          x: Math.round(bounds.x + bounds.width / 2),
          y: Math.round(bounds.y + bounds.height / 2),
        },
        clickable,
        enabled: attr("enabled") === "true",
        focused: attr("focused") === "true",
        checked: attr("checked") === "true",
        scrollable: attr("scrollable") === "true",
      });
    }

    return elements;
  }

  async tap(x: number, y: number, deviceId?: string): Promise<void> {
    await this.exec(["shell", "input", "tap", String(x), String(y)], deviceId);
  }

  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs?: number,
    deviceId?: string,
  ): Promise<void> {
    const args = ["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2)];
    if (durationMs !== undefined) args.push(String(durationMs));
    await this.exec(args, deviceId);
  }

  async typeText(text: string, deviceId?: string): Promise<void> {
    const escaped = escapeShellText(text);
    await this.exec(["shell", "input", "text", escaped], deviceId);
  }

  async pressKey(keycode: number, deviceId?: string): Promise<void> {
    await this.exec(["shell", "input", "keyevent", String(keycode)], deviceId);
  }

  async longPress(x: number, y: number, durationMs = 1000, deviceId?: string): Promise<void> {
    await this.swipe(x, y, x, y, durationMs, deviceId);
  }

  async doubleTap(x: number, y: number, intervalMs = 100, deviceId?: string): Promise<void> {
    await this.tap(x, y, deviceId);
    await new Promise((r) => setTimeout(r, intervalMs));
    await this.tap(x, y, deviceId);
  }

  async pinch(
    centerX: number,
    centerY: number,
    startSpread: number,
    endSpread: number,
    durationMs = 500,
    deviceId?: string,
  ): Promise<void> {
    // Two-finger pinch using ADB multi-touch sendevent
    // Fingers start at center ± startSpread/2, move to center ± endSpread/2
    const f1StartX = centerX - Math.round(startSpread / 2);
    const f2StartX = centerX + Math.round(startSpread / 2);
    const f1EndX = centerX - Math.round(endSpread / 2);
    const f2EndX = centerX + Math.round(endSpread / 2);
    const cmd = [
      `input swipe ${f1StartX} ${centerY} ${f1EndX} ${centerY} ${durationMs}`,
      `input swipe ${f2StartX} ${centerY} ${f2EndX} ${centerY} ${durationMs}`,
    ].join(" & ");
    await this.exec(["shell", cmd], deviceId);
  }

  async multiTap(x: number, y: number, count: number, intervalMs = 100, deviceId?: string): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.tap(x, y, deviceId);
      if (i < count - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
  }

  async tapSequence(
    steps: Array<
      | { action: "tap"; x: number; y: number }
      | { action: "tap_and_wait"; x: number; y: number; wait_ms?: number }
      | { action: "pause"; ms: number }
    >,
    deviceId?: string,
  ): Promise<void> {
    for (const step of steps) {
      if (step.action === "tap") {
        await this.tap(step.x, step.y, deviceId);
      } else if (step.action === "tap_and_wait") {
        await this.tap(step.x, step.y, deviceId);
        await new Promise((r) => setTimeout(r, step.wait_ms ?? 1000));
      } else {
        await new Promise((r) => setTimeout(r, step.ms));
      }
    }
  }

  async launchApp(packageName: string, activity?: string, deviceId?: string): Promise<string> {
    if (activity) {
      return this.exec(
        ["shell", "am", "start", "-n", `${packageName}/${activity}`],
        deviceId,
      );
    }
    return this.exec(
      ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"],
      deviceId,
    );
  }

  async installApk(apkPath: string, deviceId?: string): Promise<string> {
    const fullArgs = deviceId ? ["-s", deviceId, "install", "-r", apkPath] : ["install", "-r", apkPath];
    const { stdout } = await execFileAsync(this.adbPath, fullArgs, {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }

  async getCurrentActivity(deviceId?: string): Promise<{ packageName: string; activity: string }> {
    const output = await this.exec(["shell", "dumpsys", "activity", "activities"], deviceId);
    const patterns = [/topResumedActivity=.*?\{[^ ]* [^ ]* ([^\s/}]+)\/([^\s}]+)/, /mResumedActivity=.*?\{[^ ]* [^ ]* ([^\s/}]+)\/([^\s}]+)/];
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return { packageName: match[1], activity: match[2] };
      }
    }
    throw new Error("Could not determine current activity from dumpsys output");
  }

  async shell(command: string, deviceId?: string): Promise<string> {
    return this.exec(["shell", command], deviceId);
  }

  async getLogcat(
    options: {
      packageName?: string;
      level?: string;
      lines?: number;
      since?: string;
      deviceId?: string;
    } = {},
  ): Promise<string> {
    const { packageName, level, lines = 200, since, deviceId } = options;
    const args: string[] = ["logcat", "-d"];

    if (since) {
      args.push("-T", since);
    } else {
      args.push("-t", String(lines));
    }

    if (level) {
      args.push("*:" + level.toUpperCase());
    }

    let output = await this.exec(args, deviceId);

    if (packageName) {
      const pidOutput = await this.exec(["shell", "pidof", packageName], deviceId).catch(() => "");
      const pids = pidOutput.trim().split(/\s+/).filter(Boolean);
      if (pids.length > 0) {
        const pidSet = new Set(pids);
        output = output
          .split("\n")
          .filter((line) => {
            const pidMatch = line.match(/^\S+\s+\S+\s+(\d+)\s/);
            return pidMatch && pidSet.has(pidMatch[1]);
          })
          .join("\n");
      }
    }

    return output;
  }

  async clearLogcat(deviceId?: string): Promise<void> {
    await this.exec(["logcat", "-c"], deviceId);
  }

  async pullFile(remotePath: string, localPath: string, deviceId?: string): Promise<string> {
    const dir = dirname(localPath);
    await mkdir(dir, { recursive: true });
    const fullArgs = deviceId
      ? ["-s", deviceId, "pull", remotePath, localPath]
      : ["pull", remotePath, localPath];
    const { stdout } = await execFileAsync(this.adbPath, fullArgs, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }

  async saveScreenshot(buffer: Buffer, savePath: string): Promise<void> {
    const dir = dirname(savePath);
    await mkdir(dir, { recursive: true });
    await writeFile(savePath, buffer);
  }

  async getDeviceInfo(
    deviceId?: string,
  ): Promise<{
    model: string;
    manufacturer: string;
    androidVersion: string;
    apiLevel: string;
    screenSize: string;
    density: string;
  }> {
    const cacheKey = this.getShellKey(deviceId);
    const cached = this.deviceInfoCache.get(cacheKey);
    if (cached) return cached;

    const [model, manufacturer, androidVersion, apiLevel, sizeOutput, densityOutput] =
      await Promise.all([
        this.exec(["shell", "getprop", "ro.product.model"], deviceId),
        this.exec(["shell", "getprop", "ro.product.manufacturer"], deviceId),
        this.exec(["shell", "getprop", "ro.build.version.release"], deviceId),
        this.exec(["shell", "getprop", "ro.build.version.sdk"], deviceId),
        this.exec(["shell", "wm", "size"], deviceId),
        this.exec(["shell", "wm", "density"], deviceId),
      ]);

    const sizeMatch = sizeOutput.match(/(\d+x\d+)/);
    const densityMatch = densityOutput.match(/(\d+)/);

    const info = {
      model: model.trim(),
      manufacturer: manufacturer.trim(),
      androidVersion: androidVersion.trim(),
      apiLevel: apiLevel.trim(),
      screenSize: sizeMatch?.[1] ?? "unknown",
      density: densityMatch?.[1] ?? "unknown",
    };

    this.deviceInfoCache.set(cacheKey, info);
    return info;
  }
}
