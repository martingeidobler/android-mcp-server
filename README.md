# Android MCP Server

MCP server for controlling Android emulators and devices via ADB. Designed for use with Claude Code to enable automated manual testing — navigating apps, taking screenshots, and visually verifying UI flows.

## Prerequisites

- Node.js 18+
- Android SDK with platform-tools (ADB) and emulator
- A running Android emulator or connected device

## Install

```bash
npm install
npm run build
```

## Configure in Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "android": {
      "command": "node",
      "args": ["/absolute/path/to/android-mcp-server/dist/index.js"],
      "env": {
        "ANDROID_HOME": "/Users/yourname/Library/Android/sdk"
      }
    }
  }
}
```

Or in `~/.claude/settings.json` for global access.

## Available Tools

### Device Management
| Tool | Description |
|------|-------------|
| `list_devices` | List connected Android devices and emulators |
| `list_avds` | List available Android Virtual Devices |
| `start_emulator` | Start an AVD by name (waits up to 60s) |

### Screenshot & UI Analysis
| Tool | Description |
|------|-------------|
| `screenshot` | Take screenshot, returns image for visual analysis |
| `get_ui_tree` | Get UI element hierarchy with bounds, text, IDs |

### Interaction
| Tool | Description |
|------|-------------|
| `tap` | Tap at screen coordinates |
| `tap_element` | Tap element by resource-id, text, or content-desc |
| `type_text` | Type text into focused input |
| `press_key` | Press key (back, home, enter, etc.) |
| `swipe` | Swipe gesture between coordinates |
| `scroll_to_element` | Scroll until element is visible |
| `wait_for_element` | Wait for element to appear (with timeout) |

### App Management
| Tool | Description |
|------|-------------|
| `launch_app` | Launch app by package name |
| `install_apk` | Install APK file |
| `get_current_activity` | Get foreground app and activity |
| `adb_shell` | Run arbitrary ADB shell command |

## Usage with Claude Code

Once configured, ask Claude to test your app:

> "Open the app on the emulator, navigate through the login flow, and check if it matches the Jira ticket PROJ-123"

Claude will use `screenshot` + `get_ui_tree` to see and understand the screen, `tap_element`/`type_text` to interact, and its vision capabilities to compare against mockups.
