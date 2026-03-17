# Test Suite

This directory contains unit tests for the android-mcp-server project using Vitest.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with verbose output
npm test -- --reporter=verbose
```

## Test Coverage

### adb.test.ts

Tests for the ADB wrapper utility functions:

- **parseBounds** - Tests parsing of Android UI element bounds from `[left,top][right,bottom]` format
  - Valid bounds strings
  - Zero-size bounds
  - Invalid/malformed bounds
  - Large coordinates

- **escapeShellText** - Tests shell text escaping for ADB input commands
  - Spaces (converted to `%s`)
  - Quotes (single and double)
  - Special shell characters (backticks, dollar signs, pipes, etc.)
  - Complex mixed character strings

- **discoverPath** - Tests ADB/emulator binary path discovery
  - ANDROID_HOME environment variable resolution
  - Default SDK path fallback
  - Fallback to binary name

- **parseUiXml** - Tests UI hierarchy XML parsing
  - Single and multiple element parsing
  - Element filtering (skips non-interactive elements)
  - Boolean attribute handling
  - Center coordinate calculation
  - Self-closing tags
  - Invalid bounds handling

### server.test.ts

Tests for the MCP server integration:

- **Tool Registration** - Verifies all 20 tools are properly defined
  - Tool names and uniqueness
  - Tool categorization (device management, UI, interaction, app management, diagnostics)
  - Naming conventions

- **KEYCODE_MAP** - Validates Android keycode mappings
  - Key name conventions
  - Numeric keycode values
  - Critical key mappings (back, home, enter)

- **UiElement Interface** - Validates the UiElement type structure
  - Required properties
  - Bounds object structure
  - Center object structure

## Test Philosophy

Tests focus on **pure logic** that can be tested without a physical Android device:

- String parsing and transformation
- Data structure validation
- Configuration verification

Tests do NOT cover:
- ADB command execution (requires real device)
- Screenshot capture
- UI interaction
- Device communication

This allows the test suite to run quickly in CI/CD environments without Android SDK dependencies.
