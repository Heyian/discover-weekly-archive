import { archivedNotice, errorNotice, SOURCE_MISSING_NOTICE } from "./messages";
import type { NotifyPort } from "./types/domain";

/** One instance per module load: the missing-source and error notices each show once per instance. */
export function createNotices(notify: NotifyPort) {
  let sourceMissingShown = false;
  let errorShown = false;

  return {
    archived(count: number, archiveName: string, created: boolean): void {
      notify.info(archivedNotice(count, archiveName, created));
    },
    sourceMissing(): void {
      if (sourceMissingShown) return;
      sourceMissingShown = true;
      notify.info(SOURCE_MISSING_NOTICE);
    },
    error(reason: string): void {
      if (errorShown) return;
      errorShown = true;
      notify.error(errorNotice(reason));
    },
  };
}

export type Notices = ReturnType<typeof createNotices>;
