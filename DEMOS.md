# Example Workflows

These are real-world examples of what you can ask an AI assistant to do with this server. Each workflow is a single prompt that drives the full interaction — no manual steps required.

The examples use [mcp_test_app](../mcp_test_app), a minimal Flutter app with two buttons: one that shows a popup and one that throws an error. Adapt the prompts to your own app by swapping the package name and element text.

See [PROMPTING.md](PROMPTING.md) for tips on writing effective prompts.

---

## 1. Build, Deploy & Verify

```
Build and deploy the flutter app at ../mcp_test_app onto the emulator using fvm.
Once it is deployed, verify that the app is there and describe what you see.
Keep track of the log to check if anything goes wrong.
```

**Demo response:**

> The app is deployed and running successfully. Here's what I see:
>
> App UI:
> - Purple/lavender themed app bar titled "MCP Test App"
> - A counter display: "You have pushed the button this many times: 0"
> - Two buttons: "show popup a" and "show popup b"
> - A floating action button (+) in the bottom-right corner — likely the counter increment button
>
> Logs — nothing critical:
> - HWUI warnings about EGL config and swap behavior — these are common emulator rendering warnings, not app issues
> - One SELinux avc: denied for reading max_map_count — this is a standard Android emulator restriction, harmless for a Flutter app
> - No crashes or Flutter errors
>
> The app is running cleanly.

---

## 2. UI Interaction & State Verification

```
Look at the open emulator with get_ui_tree. Click the + button 3 times, then open popup a
and verify it shows the counter is at 3. Close the popup.
Log and tell me about any errors that happen.
```

**Demo response:**

> Everything completed successfully — no errors:
>
> 1. Tapped Increment 3 times — counter updated from 0 → 3.
> 2. Opened Popup A — displayed "Counter is at 3." confirming the correct value.
> 3. Closed the popup — returned to the main screen with counter still at 3.

---

## 3. Error Detection

```
Look at the open emulator with get_ui_tree. The current state should have 3 clicks registered.
Click the + button 3 times, then open popup b and verify it shows the counter is at 6.
Close the popup. Log and tell me about any errors that happen.
```

**Demo response:**

> Steps completed:
> - Counter started at 3 (confirmed via UI tree)
> - Clicked Increment (+) 3 times successfully
> - Counter is now correctly at 6
>
> Bug found — Popup B does not open:
> - Tapped "show popup b" twice, both taps registered at (540, 1556), but no popup appeared
> - The screen remained on the main view with no dialog or overlay
>
> Errors in logcat:
> - No app-level errors at all — no Flutter exceptions, no crash, nothing from com.example.mcp_test_app
> - System-level noise only (not app-related):
>   - HwcComposer: getLuts failed — hardware compositor issue on the emulator (benign)
>   - IPCThreadState: Sending oneway calls to frozen process — system IPC warnings (benign)
>   - AndroidRuntime: Shutting down VM — from the accessibility dumper process, not the app
>
> Conclusion: The "show popup b" button is silently broken — the tap is registering but the popup never opens and no error is thrown. This looks like the button's onPressed handler is either missing or the dialog/route it tries to show is failing silently. Worth checking the showDialog/navigation call tied to popup b in the source code.

---

## 4. Full Test Sequence

```
You're in a flutter project. Build the app and deploy it to the emulator.
Check the logs for errors and warnings. Once the app is built, analyze it with get_ui_tree.
Tap the + button 3 times, and make sure the counter says 3.
Open Popup A and again check for the counter to say 3, and close it.
Click the + button 3 more times, check the counter to say 6, open Popup B and again
check if it displays the number 6. Then, summarize all of your findings.
```

**Demo response:**

**Build & Deployment**
- Built successfully with fvm flutter build apk --debug in ~1.2s (Gradle fast build).
- Installed and launched on emulator-5554 (Pixel 9a / sdk_gphone64_arm64, API 35).
- No errors or warnings in the initial logs at launch.

**UI Tree Analysis (initial state)**

The app exposes 7 accessibility elements:
- App bar: "MCP Test App"
- Label: "You have pushed the button this many times:"
- Counter display (starting at "0")
- "show popup a" button
- "show popup b" button
- "Increment" FAB (+)

**Counter Behavior — Phase 1 (0 → 3)**
- Tapped + 3 times → counter correctly displayed 3. ✅

**Popup A (counter = 3)**
- Opened successfully via "show popup a".
- Dialog correctly displayed: "Counter is at 3." ✅
- Closed via "Close" button — dismissed cleanly.

**Counter Behavior — Phase 2 (3 → 6)**
- Tapped + 3 more times → counter correctly displayed 6. ✅

**Popup B (counter = 6) — BUG FOUND**
- Tapping "show popup b" produced no dialog.
- The app did not crash and remained on the main screen with counter at 6.
- No visual feedback of any kind was shown to the user.
- Root cause (main.dart:82): The button's onPressed handler intentionally throws an exception instead of showing a dialog. Flutter silently caught the exception — no logcat output, no red error screen, no crash. This is particularly dangerous because the failure is completely invisible to the user in the installed APK build.

**Summary**

| Step | Expected | Actual | Status |
|---|---|---|---|
| Build | Clean APK | Built in ~1.2s, no warnings | ✅ |
| Launch logs | No errors | No errors or warnings | ✅ |
| Counter after 3 taps | Shows "3" | Shows "3" | ✅ |
| Popup A (at 3) | "Counter is at 3." | "Counter is at 3." | ✅ |
| Counter after 6 taps | Shows "6" | Shows "6" | ✅ |
| Popup B (at 6) | Shows counter value | Throws exception silently, no dialog shown | ❌ Bug |
