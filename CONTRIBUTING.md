# Contributing

Thanks for your interest in contributing to Android MCP Server!

## Prerequisites

- Node.js 18+
- Android SDK with platform-tools (ADB) and emulator
- An Android emulator or device for testing

## Getting started

```bash
git clone https://github.com/anthropics/android-mcp-server.git
cd android-mcp-server
npm install
npm run build
```

## Development

```bash
# Watch mode — recompiles on file changes
npm run dev

# Lint
npm run lint

# Build
npm run build
```

## Testing your changes

Register the local build as an MCP server:

```bash
claude mcp add --scope user android -- node /path/to/android-mcp-server/dist/index.js
```

Then test with Claude Code against a running emulator or device.

## Submitting changes

1. Fork the repository
2. Create a branch (`git checkout -b my-change`)
3. Make your changes
4. Run `npm run lint && npm run build` to verify
5. Commit and push
6. Open a pull request

Please keep PRs focused — one feature or fix per PR.

## Reporting issues

Use [GitHub Issues](https://github.com/anthropics/android-mcp-server/issues) to report bugs or request features. Include:

- What you expected to happen
- What actually happened
- Device/emulator details (Android version, API level)
- Steps to reproduce
