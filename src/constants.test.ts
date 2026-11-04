import { expect, it } from "vitest";
import {
  ARCHIVE_NAME,
  DISCOVER_WEEKLY_NAME,
  READY_TIMEOUT_MS,
  RECHECK_INTERVAL_MS,
  STORAGE_PREFIX,
} from "./constants";

it("pins the spec values", () => {
  expect(DISCOVER_WEEKLY_NAME).toBe("Discover Weekly");
  expect(ARCHIVE_NAME).toBe("Discover Weekly Archive");
  expect(READY_TIMEOUT_MS).toBe(10_000);
  expect(RECHECK_INTERVAL_MS).toBe(21_600_000);
  expect(STORAGE_PREFIX).toBe("discover-weekly-archive:");
});
