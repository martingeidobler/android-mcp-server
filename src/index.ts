#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import { Adb } from "./adb.js";

const adb = new Adb();

const KEYCODE_MAP: Record<string, number> = {
  back: 4,
  home: 3,
  enter: 66,
  tab: 61,
  delete: 67,
  menu: 82,
  recent_apps: 187,
  volume_up: 24,
  volume_down: 25,
  power: 26,
  search: 84,
  dpad_up: 19,
  dpad_down: 20,
  dpad_left: 21,
  dpad_right: 22,
  dpad_center: 23,
};

async function compressScreenshot(pngBuffer: Buffer, maxWidth = 1280): Promise<Buffer> {
  const image = sharp(pngBuffer);
  const metadata = await image.metadata();
  if (metadata.width && metadata.width > maxWidth) {
    return image.resize({ width: maxWidth }).png({ quality: 80 }).toBuffer();
  }
  return image.png({ quality: 80 }).toBuffer();
}

const server = new McpServer({
  name: "android",
  version: "1.0.0",
});

// --- Device Management ---

server.tool("list_devices", "List connected Android devices and emulators", {}, async () => {
  const devices = await adb.getDevices();
  if (devices.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "No devices connected. Use list_avds to see available emulators, then start_emulator to launch one.",
        },
      ],
    };
  }
  return {
    content: [
      {
        type: "text",
        text: devices
          .map((d) => `${d.id} [${d.state}]${d.model ? ` model:${d.model}` : ""}`)
          .join("\n"),
      },
    ],
  };
});

server.tool("list_avds", "List available Android Virtual Devices", {}, async () => {
  const avds = await adb.getAvds();
  if (avds.length === 0) {
    return {
      content: [{ type: "text", text: "No AVDs found. Create one in Android Studio AVD Manager." }],
    };
  }
  return { content: [{ type: "text", text: avds.join("\n") }] };
});

server.tool(
  "start_emulator",
  "Start an Android emulator. Waits up to 60s for it to come online.",
  { avd_name: z.string().describe("Name of the AVD to start (from list_avds)") },
  async ({ avd_name }) => {
    const deviceId = await adb.startEmulator(avd_name);
    return {
      content: [{ type: "text", text: `Emulator started: ${deviceId}` }],
    };
  },
);

// --- Screenshot & UI Analysis ---

server.tool(
  "screenshot",
  "Take a screenshot of the Android device. Returns the image for visual analysis.",
  { device_id: z.string().optional().describe("Device ID (optional if only one device)") },
  async ({ device_id }) => {
    const raw = await adb.screenshot(device_id);
    const compressed = await compressScreenshot(raw);
    const base64 = compressed.toString("base64");
    const metadata = await sharp(compressed).metadata();

    return {
      content: [
        { type: "image", data: base64, mimeType: "image/png" },
        {
          type: "text",
          text: `Screenshot: ${metadata.width}x${metadata.height} (${Math.round(compressed.length / 1024)}KB)`,
        },
      ],
    };
  },
);

server.tool(
  "get_ui_tree",
  "Get the UI element hierarchy of the current screen. Returns interactive elements with their bounds, text, resource IDs, and state. Use this to find elements before tapping.",
  { device_id: z.string().optional().describe("Device ID (optional if only one device)") },
  async ({ device_id }) => {
    const elements = await adb.getUiTree(device_id);
    const summary = elements.map((el, i) => {
      const parts: string[] = [`[${i}]`];
      if (el.resourceId) parts.push(`id:${el.resourceId}`);
      if (el.text) parts.push(`text:"${el.text}"`);
      if (el.contentDesc) parts.push(`desc:"${el.contentDesc}"`);
      parts.push(`class:${el.className.split(".").pop()}`);
      parts.push(`center:(${el.center.x},${el.center.y})`);
      const flags: string[] = [];
      if (el.clickable) flags.push("clickable");
      if (el.scrollable) flags.push("scrollable");
      if (el.checked) flags.push("checked");
      if (el.focused) flags.push("focused");
      if (!el.enabled) flags.push("disabled");
      if (flags.length) parts.push(`[${flags.join(",")}]`);
      return parts.join(" ");
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${elements.length} elements:\n\n${summary.join("\n")}`,
        },
      ],
    };
  },
);

// --- Interaction ---

server.tool(
  "tap",
  "Tap at specific screen coordinates",
  {
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ x, y, device_id }) => {
    await adb.tap(x, y, device_id);
    return { content: [{ type: "text", text: `Tapped at (${x}, ${y})` }] };
  },
);

server.tool(
  "tap_element",
  "Tap a UI element by its resource-id, text, or content-desc. Finds the element in the UI tree and taps its center.",
  {
    by: z
      .enum(["resource-id", "text", "content-desc"])
      .describe("How to find the element"),
    value: z.string().describe("Value to match"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ by, value, device_id }) => {
    const elements = await adb.getUiTree(device_id);
    const finder: Record<string, (el: (typeof elements)[0]) => boolean> = {
      "resource-id": (el) => el.resourceId === value || el.resourceId.endsWith(`:id/${value}`),
      text: (el) => el.text === value || el.text.toLowerCase().includes(value.toLowerCase()),
      "content-desc": (el) =>
        el.contentDesc === value ||
        el.contentDesc.toLowerCase().includes(value.toLowerCase()),
    };

    const el = elements.find(finder[by]);
    if (!el) {
      return {
        content: [
          {
            type: "text",
            text: `Element not found: ${by}="${value}". Available elements:\n${elements
              .filter((e) => e.clickable)
              .map((e) => `  id:${e.resourceId} text:"${e.text}" desc:"${e.contentDesc}"`)
              .join("\n")}`,
          },
        ],
        isError: true,
      };
    }

    await adb.tap(el.center.x, el.center.y, device_id);
    return {
      content: [
        {
          type: "text",
          text: `Tapped "${by}=${value}" at (${el.center.x}, ${el.center.y}) [${el.className.split(".").pop()}]`,
        },
      ],
    };
  },
);

server.tool(
  "type_text",
  "Type text into the currently focused input field",
  {
    text: z.string().describe("Text to type"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ text, device_id }) => {
    await adb.typeText(text, device_id);
    return { content: [{ type: "text", text: `Typed: "${text}"` }] };
  },
);

server.tool(
  "press_key",
  "Press a hardware/software key",
  {
    key: z
      .enum([
        "back",
        "home",
        "enter",
        "tab",
        "delete",
        "menu",
        "recent_apps",
        "volume_up",
        "volume_down",
        "power",
        "search",
        "dpad_up",
        "dpad_down",
        "dpad_left",
        "dpad_right",
        "dpad_center",
      ])
      .describe("Key to press"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ key, device_id }) => {
    await adb.pressKey(KEYCODE_MAP[key], device_id);
    return { content: [{ type: "text", text: `Pressed: ${key}` }] };
  },
);

server.tool(
  "swipe",
  "Perform a swipe gesture on the screen",
  {
    start_x: z.number().describe("Start X coordinate"),
    start_y: z.number().describe("Start Y coordinate"),
    end_x: z.number().describe("End X coordinate"),
    end_y: z.number().describe("End Y coordinate"),
    duration_ms: z.number().optional().default(300).describe("Swipe duration in ms (default 300)"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ start_x, start_y, end_x, end_y, duration_ms, device_id }) => {
    await adb.swipe(start_x, start_y, end_x, end_y, duration_ms, device_id);
    return {
      content: [
        {
          type: "text",
          text: `Swiped from (${start_x},${start_y}) to (${end_x},${end_y}) over ${duration_ms}ms`,
        },
      ],
    };
  },
);

server.tool(
  "scroll_to_element",
  "Scroll down repeatedly until an element matching the given criteria is visible",
  {
    by: z.enum(["resource-id", "text", "content-desc"]).describe("How to find the element"),
    value: z.string().describe("Value to match"),
    max_scrolls: z.number().optional().default(10).describe("Maximum scroll attempts (default 10)"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ by, value, max_scrolls, device_id }) => {
    const finder: Record<string, (el: { resourceId: string; text: string; contentDesc: string }) => boolean> = {
      "resource-id": (el) => el.resourceId === value || el.resourceId.endsWith(`:id/${value}`),
      text: (el) => el.text.toLowerCase().includes(value.toLowerCase()),
      "content-desc": (el) => el.contentDesc.toLowerCase().includes(value.toLowerCase()),
    };

    for (let i = 0; i < max_scrolls; i++) {
      const elements = await adb.getUiTree(device_id);
      const found = elements.find(finder[by]);
      if (found) {
        return {
          content: [
            {
              type: "text",
              text: `Found "${value}" after ${i} scrolls at (${found.center.x},${found.center.y})`,
            },
          ],
        };
      }
      // Scroll down: swipe from center-bottom to center-top
      await adb.swipe(540, 1600, 540, 600, 500, device_id);
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      content: [
        { type: "text", text: `Element "${by}=${value}" not found after ${max_scrolls} scrolls` },
      ],
      isError: true,
    };
  },
);

server.tool(
  "wait_for_element",
  "Wait for a UI element to appear on screen. Polls every 500ms.",
  {
    by: z.enum(["resource-id", "text", "content-desc"]).describe("How to find the element"),
    value: z.string().describe("Value to match"),
    timeout_ms: z.number().optional().default(10000).describe("Timeout in ms (default 10000)"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ by, value, timeout_ms, device_id }) => {
    const finder: Record<string, (el: { resourceId: string; text: string; contentDesc: string }) => boolean> = {
      "resource-id": (el) => el.resourceId === value || el.resourceId.endsWith(`:id/${value}`),
      text: (el) => el.text.toLowerCase().includes(value.toLowerCase()),
      "content-desc": (el) => el.contentDesc.toLowerCase().includes(value.toLowerCase()),
    };

    const start = Date.now();
    while (Date.now() - start < timeout_ms) {
      try {
        const elements = await adb.getUiTree(device_id);
        const found = elements.find(finder[by]);
        if (found) {
          return {
            content: [
              {
                type: "text",
                text: `Element "${by}=${value}" appeared after ${Date.now() - start}ms at (${found.center.x},${found.center.y})`,
              },
            ],
          };
        }
      } catch {
        // UI tree dump can fail during transitions
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    return {
      content: [
        {
          type: "text",
          text: `Timeout: element "${by}=${value}" did not appear within ${timeout_ms}ms`,
        },
      ],
      isError: true,
    };
  },
);

// --- App Management ---

server.tool(
  "launch_app",
  "Launch an Android app by package name",
  {
    package_name: z.string().describe("App package name (e.g., com.android.settings)"),
    activity: z.string().optional().describe("Activity to launch (optional - launches default if omitted)"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ package_name, activity, device_id }) => {
    const result = await adb.launchApp(package_name, activity, device_id);
    return { content: [{ type: "text", text: `Launched ${package_name}\n${result.trim()}` }] };
  },
);

server.tool(
  "install_apk",
  "Install an APK file on the device",
  {
    apk_path: z.string().describe("Local path to the APK file"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ apk_path, device_id }) => {
    const result = await adb.installApk(apk_path, device_id);
    return { content: [{ type: "text", text: result.trim() }] };
  },
);

server.tool(
  "get_current_activity",
  "Get the currently displayed app and activity",
  { device_id: z.string().optional().describe("Device ID (optional if only one device)") },
  async ({ device_id }) => {
    const info = await adb.getCurrentActivity(device_id);
    return {
      content: [
        { type: "text", text: `Package: ${info.packageName}\nActivity: ${info.activity}` },
      ],
    };
  },
);

server.tool(
  "adb_shell",
  "Run an arbitrary ADB shell command",
  {
    command: z.string().describe("Shell command to execute on the device"),
    device_id: z.string().optional().describe("Device ID (optional if only one device)"),
  },
  async ({ command, device_id }) => {
    const output = await adb.shell(command, device_id);
    return { content: [{ type: "text", text: output || "(no output)" }] };
  },
);

// --- Server startup ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
