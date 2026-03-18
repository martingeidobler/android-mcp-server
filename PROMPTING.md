# Prompting Guide

Best practices for getting fast, reliable results from the Android MCP server.

## General Tips

1. **Prefer UI tree over screenshots for navigation.** `get_ui_tree` returns structured data the AI can parse instantly. Screenshots require vision analysis and are slower. Use screenshots only for visual verification (layout, colors, design comparison).

2. **Use `tap_and_wait` instead of separate calls.** Instead of `tap_element` → wait → `get_ui_tree`, use `tap_and_wait` — it does all three in one round trip.

3. **Always start from a known state.** Begin prompts with "go to the home screen" or "launch [app]" so the AI knows where it is.

4. **Reference elements by text or resource-id, not coordinates.** Coordinates break across screen sizes. Element targeting adapts automatically.

5. **Clear logs before reproducing bugs.** This gives you clean output without noise from earlier activity.

## Prompt Templates

### Bug Documentation

```
Clear the logs, launch [com.example.app], navigate to the [screen name],
tap [button], then show me the error logs and take a screenshot.
Save the screenshot to ./bugs/[description].png
```

**What happens:** `clear_logs` → `launch_app` → `tap_and_wait` (navigation) → `tap_and_wait` (action) → `get_logs(package_name="...", level="E")` → `screenshot(save_path="...")`

### UI Smoke Test

```
Launch [com.example.app] and navigate through the main screens.
At each screen, check the UI tree for the expected elements and check
the logs for errors. Report any crashes or missing elements.
```

**What happens:** `launch_app` → for each screen: `tap_and_wait` → verify elements in tree → `get_logs(level="E")` → repeat

### Form Filling

```
Open [app], navigate to the [form screen], fill in:
- Name: John Doe
- Email: john@example.com
Then tap Submit and verify the confirmation screen appears.
```

**What happens:** `launch_app` → `tap_and_wait` (navigate) → `tap_element(by="resource-id", value="name_field")` → `type_text("John Doe")` → `tap_element(by="resource-id", value="email_field")` → `type_text("john@example.com")` → `tap_and_wait(by="text", value="Submit")`

### Scroll and Find

```
Open [app], scroll down until you find [element text], then tap it.
```

**What happens:** `launch_app` → `scroll_to_element(by="text", value="...")` → `tap_and_wait(by="text", value="...")`

### Compare to Design

```
Take a screenshot of [screen] and compare it to the mockup at [path/url].
Check that the layout, spacing, and colors match. Report any differences.
```

**What happens:** `screenshot` → AI uses vision to compare against the reference image

## Performance Tips

- **Batch your instructions.** One detailed prompt is faster than five back-and-forth messages. Tell the AI the full workflow upfront.
- **Skip screenshots when you don't need them.** If you just need to navigate, the UI tree is enough. Only request screenshots for visual checks.
- **Use package name filters for logs.** `get_logs(package_name="com.example.app")` is much faster to parse than unfiltered logcat.
- **Let `tap_and_wait` do the work.** It returns the new UI tree automatically, so the AI can immediately plan its next action without an extra call.

## Common Pitfalls

### Unexpected Dialogs
System dialogs (updates, permissions, "app not responding") can appear at any time. If the AI seems stuck, tell it:
```
Dismiss any dialog on screen and continue.
```

### Loading States
If a screen hasn't loaded yet, the UI tree will be incomplete. Tell the AI to wait:
```
Wait for [element] to appear before continuing.
```
This triggers `wait_for_element` which polls until the element shows up (default 10s timeout).

### Wrong Element Matched
If `tap_element(by="text", value="OK")` hits the wrong "OK" button, be more specific:
```
Tap the OK button in the delete confirmation dialog (use resource-id if available).
```
Or ask the AI to check `get_ui_tree` first and pick the right one based on context.

### Keyboard Covering Elements
After typing, the soft keyboard may cover buttons below. Tell the AI:
```
Press back to dismiss the keyboard, then tap Submit.
```

## Element Targeting Priority

When telling the AI which element to interact with, prefer this order:

1. **`resource-id`** — most reliable, doesn't change with language/theme
2. **`text`** — readable and intuitive, but breaks with localization
3. **`content-desc`** — good for icons and image buttons
4. **Coordinates** — last resort, breaks across screen sizes

## Example: Full Test Sequence

```
Run a smoke test on our app:

1. Install the APK from ./app/build/outputs/apk/debug/app-debug.apk
2. Launch com.example.myapp
3. Verify the login screen appears (look for a "Sign In" button)
4. Type "testuser" in the username field and "password123" in the password field
5. Tap "Sign In" and wait for the home screen
6. Navigate to Settings > Account > Profile
7. Take a screenshot and save to ./test-results/profile.png
8. Check the logs for any errors throughout
9. Report: which screens loaded, any errors found, and the screenshot
```
