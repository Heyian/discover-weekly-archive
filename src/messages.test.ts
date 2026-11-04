import { describe, it, expect } from "vitest";
import {
  statusLine,
  archivedNotice,
  SOURCE_MISSING_NOTICE,
  errorNotice,
  shortReason,
} from "./messages";

const f = () => "T";

describe("statusLine", () => {
  it("says not run yet without a record", () => {
    expect(statusLine(null, f)).toBe("Not run yet");
  });
  it("describes each outcome", () => {
    expect(statusLine({ at: 1, outcome: "error", addedCount: 0, error: "boom" }, f)).toBe("Last run: T · failed: boom");
    expect(statusLine({ at: 1, outcome: "source-missing", addedCount: 0 }, f)).toBe("Last run: T · Discover Weekly not found — pick it below");
    expect(statusLine({ at: 1, outcome: "source-empty", addedCount: 0 }, f)).toBe("Last run: T · Discover Weekly was empty, will retry");
    expect(statusLine({ at: 1, outcome: "source-unreadable", addedCount: 0 }, f)).toBe("Last run: T · couldn't read Discover Weekly, will retry");
    expect(statusLine({ at: 1, outcome: "added", addedCount: 1 }, f)).toBe("Last run: T · 1 song added");
    expect(statusLine({ at: 1, outcome: "added", addedCount: 0 }, f)).toBe("Last run: T · 0 songs added");
  });
});

describe("notice copy", () => {
  it("builds the archived notice", () => {
    expect(archivedNotice(3, "My Arch", false)).toBe("Archived 3 songs from Discover Weekly to My Arch");
    expect(archivedNotice(1, "Discover Weekly Archive", true)).toBe("Created Discover Weekly Archive. Archived 1 song from Discover Weekly to Discover Weekly Archive");
  });
  it("has the source-missing and error copy", () => {
    expect(SOURCE_MISSING_NOTICE).toBe("Discover Weekly Archive couldn't find Discover Weekly. Save it to your library, or pick it in Spicetify Settings.");
    expect(errorNotice("boom")).toBe("Discover Weekly Archive failed: boom");
  });
});

describe("shortReason", () => {
  it("uses the first line of an Error message", () => {
    expect(shortReason(new Error("a\nb"))).toBe("a");
  });
  it("stringifies non-errors", () => {
    expect(shortReason("plain string")).toBe("plain string");
  });
  it("cuts to 80 chars with an ellipsis", () => {
    expect(shortReason(new Error("x".repeat(100)))).toBe("x".repeat(79) + "…");
  });
});
