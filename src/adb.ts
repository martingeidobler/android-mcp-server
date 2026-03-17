import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
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

function discoverPath(toolRelativePath: string, fallbackName: string): string {
  const androidHome = process.env.ANDROID_HOME;
  if (androidHome) {
    const p = join(androidHome, toolRelativePath);
    if (existsSync(p)) return p;
  }
  const defaultSdkPath = join(homedir(), "Library", "Android", "sdk", toolRelativePath);
  if (existsSync(defaultSdkPath)) return defaultSdkPath;
  return fallbackName;
}

function parseBounds(boundsStr: string): { x: number; y: number; width: number; height: number } | null {
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = parseInt(match[1], 10);
  const top = parseInt(match[2], 10);
  const right = parseInt(match[3], 10);
  const bottom = parseInt(match[4], 10);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function escapeShellText(text: string): string {
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

  constructor() {
    this.adbPath = discoverPath(join("platform-tools", "adb"), "adb");
    this.emulatorPath = discoverPath(join("emulator", "emulator"), "emulator");
  }

  async exec(args: string[], deviceId?: string): Promise<string> {
    const fullArgs = deviceId ? ["-s", deviceId, ...args] : args;
    const { stdout, stderr } = await execFileAsync(this.adbPath, fullArgs, {
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

  private parseUiXml(xml: string): UiElement[] {
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
}
