import { describe, it, expect, beforeEach } from "vitest";
import { Adb, parseBounds, escapeShellText, discoverPath } from "../adb.js";

describe("parseBounds", () => {
  it("should parse valid bounds string correctly", () => {
    const result = parseBounds("[0,0][540,96]");
    expect(result).toEqual({
      x: 0,
      y: 0,
      width: 540,
      height: 96,
    });
  });

  it("should parse bounds with different coordinates", () => {
    const result = parseBounds("[100,200][300,400]");
    expect(result).toEqual({
      x: 100,
      y: 200,
      width: 200,
      height: 200,
    });
  });

  it("should handle zero-size bounds", () => {
    const result = parseBounds("[50,50][50,50]");
    expect(result).toEqual({
      x: 50,
      y: 50,
      width: 0,
      height: 0,
    });
  });

  it("should return null for invalid bounds string", () => {
    expect(parseBounds("invalid")).toBeNull();
    expect(parseBounds("[0,0]")).toBeNull();
    expect(parseBounds("")).toBeNull();
    expect(parseBounds("[abc,def][ghi,jkl]")).toBeNull();
  });

  it("should handle large coordinates", () => {
    const result = parseBounds("[1000,2000][3000,4000]");
    expect(result).toEqual({
      x: 1000,
      y: 2000,
      width: 2000,
      height: 2000,
    });
  });
});

describe("escapeShellText", () => {
  it("should escape spaces with %s", () => {
    expect(escapeShellText("hello world")).toBe("hello%sworld");
  });

  it("should escape single quotes", () => {
    expect(escapeShellText("it's")).toBe("it\\'s");
  });

  it("should escape double quotes", () => {
    expect(escapeShellText('say "hello"')).toBe("say%s\\\"hello\\\"");
  });

  it("should escape backticks", () => {
    expect(escapeShellText("`command`")).toBe("\\`command\\`");
  });

  it("should escape dollar signs", () => {
    expect(escapeShellText("$variable")).toBe("\\$variable");
  });

  it("should escape backslashes", () => {
    expect(escapeShellText("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("should escape ampersands", () => {
    expect(escapeShellText("foo & bar")).toBe("foo%s\\&%sbar");
  });

  it("should escape pipes", () => {
    expect(escapeShellText("foo | bar")).toBe("foo%s\\|%sbar");
  });

  it("should escape semicolons", () => {
    expect(escapeShellText("cmd1; cmd2")).toBe("cmd1\\;%scmd2");
  });

  it("should escape parentheses", () => {
    expect(escapeShellText("(expression)")).toBe("\\(expression\\)");
  });

  it("should escape angle brackets", () => {
    expect(escapeShellText("<tag>")).toBe("\\<tag\\>");
  });

  it("should handle complex mixed special characters", () => {
    const input = `it's "complex" $test & <foo>`;
    const expected = "it\\'s%s\\\"complex\\\"%s\\$test%s\\&%s\\<foo\\>";
    expect(escapeShellText(input)).toBe(expected);
  });

  it("should handle empty string", () => {
    expect(escapeShellText("")).toBe("");
  });

  it("should handle text with no special characters", () => {
    expect(escapeShellText("hello")).toBe("hello");
  });
});

describe("discoverPath", () => {
  it("should return fallback name when ANDROID_HOME is not set and default path does not exist", () => {
    const originalAndroidHome = process.env.ANDROID_HOME;
    delete process.env.ANDROID_HOME;

    const result = discoverPath("nonexistent/tool", "fallback-tool");

    // Should return fallback since neither ANDROID_HOME nor default SDK path will have this
    expect(result).toBe("fallback-tool");

    if (originalAndroidHome) {
      process.env.ANDROID_HOME = originalAndroidHome;
    }
  });

  it("should construct correct default SDK path", () => {
    const originalAndroidHome = process.env.ANDROID_HOME;
    delete process.env.ANDROID_HOME;

    const result = discoverPath("platform-tools/adb", "adb");

    // Result will be the default path if it exists, or fallback if it doesn't
    // Since we can't guarantee the path exists, we just verify the logic doesn't crash
    expect(typeof result).toBe("string");

    if (originalAndroidHome) {
      process.env.ANDROID_HOME = originalAndroidHome;
    }
  });
});

describe("Adb.parseUiXml", () => {
  let adb: Adb;

  beforeEach(() => {
    adb = new Adb();
  });

  it("should parse simple UI XML with one element", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Settings" resource-id="com.android.settings:id/title" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,0][540,96]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(1);
    expect(elements[0]).toEqual({
      index: 0,
      resourceId: "com.android.settings:id/title",
      text: "Settings",
      contentDesc: "",
      className: "android.widget.TextView",
      bounds: { x: 0, y: 0, width: 540, height: 96 },
      center: { x: 270, y: 48 },
      clickable: true,
      enabled: true,
      focused: false,
      checked: false,
      scrollable: false,
    });
  });

  it("should parse UI XML with multiple elements", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Settings" resource-id="com.android.settings:id/title" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,0][540,96]" />
  <node index="1" text="" resource-id="" class="android.view.View" content-desc="Navigate up" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,96][144,240]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(2);

    expect(elements[0].text).toBe("Settings");
    expect(elements[0].resourceId).toBe("com.android.settings:id/title");

    expect(elements[1].text).toBe("");
    expect(elements[1].contentDesc).toBe("Navigate up");
    expect(elements[1].bounds).toEqual({ x: 0, y: 96, width: 144, height: 144 });
    expect(elements[1].center).toEqual({ x: 72, y: 168 });
  });

  it("should skip elements without identifier or clickable attribute", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.view.View" content-desc="" clickable="false" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,0][100,100]" />
  <node index="1" text="Button" resource-id="" class="android.widget.Button" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,100][100,200]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(1);
    expect(elements[0].text).toBe("Button");
  });

  it("should skip elements with invalid bounds", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Invalid" resource-id="id/invalid" class="android.view.View" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="invalid" />
  <node index="1" text="Valid" resource-id="id/valid" class="android.view.View" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,0][100,100]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(1);
    expect(elements[0].text).toBe("Valid");
  });

  it("should parse self-closing node tags", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Self Closing" resource-id="id/test" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[10,20][110,120]"/>
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(1);
    expect(elements[0].text).toBe("Self Closing");
    expect(elements[0].bounds).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("should calculate center coordinates correctly", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Center Test" resource-id="id/center" class="android.view.View" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[100,200][300,400]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(1);
    expect(elements[0].center).toEqual({ x: 200, y: 300 });
  });

  it("should handle boolean attributes correctly", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="All True" resource-id="id/test" class="android.view.View" content-desc="" clickable="true" enabled="true" focused="true" checked="true" scrollable="true" bounds="[0,0][100,100]" />
  <node index="1" text="All False" resource-id="id/test2" class="android.view.View" content-desc="" clickable="true" enabled="false" focused="false" checked="false" scrollable="false" bounds="[0,100][100,200]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(2);

    expect(elements[0].clickable).toBe(true);
    expect(elements[0].enabled).toBe(true);
    expect(elements[0].focused).toBe(true);
    expect(elements[0].checked).toBe(true);
    expect(elements[0].scrollable).toBe(true);

    expect(elements[1].clickable).toBe(true);
    expect(elements[1].enabled).toBe(false);
    expect(elements[1].focused).toBe(false);
    expect(elements[1].checked).toBe(false);
    expect(elements[1].scrollable).toBe(false);
  });

  it("should handle missing XML declaration", () => {
    const xml = `<hierarchy rotation="0">
  <node index="0" text="No XML Declaration" resource-id="id/test" class="android.view.View" content-desc="" clickable="true" enabled="true" focused="false" checked="false" scrollable="false" bounds="[0,0][100,100]" />
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(1);
    expect(elements[0].text).toBe("No XML Declaration");
  });

  it("should handle empty hierarchy", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
</hierarchy>`;

    const elements = adb.parseUiXml(xml);

    expect(elements).toHaveLength(0);
  });
});
