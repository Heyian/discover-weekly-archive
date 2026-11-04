import { describe, it, expect, vi } from "vitest";
import { createNotices } from "./notices";
import { SOURCE_MISSING_NOTICE, errorNotice, archivedNotice } from "./messages";

const port = () => ({ info: vi.fn(), error: vi.fn() });

describe("createNotices", () => {
  it("shows archived every time", () => {
    const n = port();
    const notices = createNotices(n);
    notices.archived(2, "A", false);
    notices.archived(1, "A", true);
    expect(n.info).toHaveBeenCalledTimes(2);
    expect(n.info).toHaveBeenNthCalledWith(1, archivedNotice(2, "A", false));
    expect(n.info).toHaveBeenNthCalledWith(2, archivedNotice(1, "A", true));
  });
  it("shows source-missing once per load", () => {
    const n = port();
    const notices = createNotices(n);
    notices.sourceMissing();
    notices.sourceMissing();
    expect(n.info).toHaveBeenCalledTimes(1);
    expect(n.info).toHaveBeenCalledWith(SOURCE_MISSING_NOTICE);
  });
  it("shows error once per load", () => {
    const n = port();
    const notices = createNotices(n);
    notices.error("r");
    notices.error("r");
    expect(n.error).toHaveBeenCalledTimes(1);
    expect(n.error).toHaveBeenCalledWith(errorNotice("r"));
  });
  it("counts the two guards separately", () => {
    const n = port();
    const notices = createNotices(n);
    notices.sourceMissing();
    notices.error("r");
    expect(n.info).toHaveBeenCalledTimes(1);
    expect(n.error).toHaveBeenCalledTimes(1);
  });
  it("shows each again on a new load", () => {
    const n = port();
    createNotices(n).sourceMissing();
    createNotices(n).sourceMissing();
    createNotices(n).error("r");
    createNotices(n).error("r");
    expect(n.info).toHaveBeenCalledTimes(2);
    expect(n.error).toHaveBeenCalledTimes(2);
  });
});
