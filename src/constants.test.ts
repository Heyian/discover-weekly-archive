import { expect, it } from "vitest";
import {
  ADD_BATCH_SIZE,
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

it("keeps the add batch at 100, since no per-call limit was found up to 500", () => {
  expect(ADD_BATCH_SIZE).toBe(100);
});
