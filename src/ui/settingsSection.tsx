// This module's section on the Spicetify Settings page.
// The only file that imports stdlib; its items unload with the registrar.
import React from "react";
import { createRegistrar, type ModuleRuntimeContext } from "/modules/stdlib/mod.js";
import {
  Select,
  SettingsButtonRow,
  SettingsRow,
  SettingsSection,
} from "/modules/stdlib/lib/primitives.js";
import { statusLine } from "../messages";
import type { Scheduler } from "../scheduler";
import type { Store } from "../storage";
import type { LibraryPort } from "../types/domain";
import {
  archiveOptions,
  LIST_ERROR_LINE,
  sourceOptions,
  type PlaylistList,
} from "./settingsSection.view";

export type { ModuleRuntimeContext };

export interface SettingsDeps {
  store: Store;
  scheduler: Scheduler;
  library: LibraryPort;
  formatTime: (at: number) => string;
}

function Section({ store, scheduler, library, formatTime }: SettingsDeps) {
  const [list, setList] = React.useState<PlaylistList | null>(null);
  const [sourceUri, setSourceUri] = React.useState(() => store.getSourceUri());
  const [archiveUri, setArchiveUri] = React.useState(() => store.getArchiveUri());
  const [running, setRunning] = React.useState(() => scheduler.isRunning());
  const [status, setStatus] = React.useState(() => statusLine(store.getLastRun(), formatTime));

  const mounted = React.useRef(true);
  const listRef = React.useRef<PlaylistList | null>(null);
  const reloadedFor = React.useRef<string | null>(null);

  const loadList = React.useCallback((): void => {
    library.readRootlist().then(
      ({ playlists }) => {
        if (!mounted.current) return;
        listRef.current = { ok: true, playlists };
        setList(listRef.current);
      },
      () => {
        if (!mounted.current) return;
        listRef.current = { ok: false };
        setList(listRef.current);
      },
    );
  }, [library]);

  React.useEffect(() => {
    mounted.current = true;
    loadList();
    return () => {
      mounted.current = false;
    };
  }, [loadList]);

  React.useEffect(() => {
    const refresh = (): void => {
      const running = scheduler.isRunning();
      const archive = store.getArchiveUri();
      setRunning(running);
      setStatus(statusLine(store.getLastRun(), formatTime));
      setSourceUri(store.getSourceUri());
      setArchiveUri(archive);
      // A run may have created or found the Archive after the list loaded: reload once per URI.
      const loaded = listRef.current;
      if (
        !running &&
        archive !== null &&
        loaded?.ok &&
        !loaded.playlists.some((p) => p.uri === archive) &&
        reloadedFor.current !== archive
      ) {
        reloadedFor.current = archive;
        loadList();
      }
    };
    refresh();
    return scheduler.onChange(refresh);
  }, [scheduler, store, formatTime, loadList]);

  return (
    <SettingsSection title="Discover Weekly Archive">
      <SettingsRow label="Source playlist">
        <Select
          options={sourceOptions(list, sourceUri)}
          value={sourceUri}
          ariaLabel="Source playlist"
          onChange={(value) => {
            store.setSourceUri(value);
            setSourceUri(store.getSourceUri());
          }}
        />
      </SettingsRow>
      <SettingsRow label="Archive playlist">
        <Select
          options={archiveOptions(list, archiveUri)}
          value={archiveUri ?? ""}
          ariaLabel="Archive playlist"
          onChange={(value) => {
            if (value === "") return;
            store.setArchiveUri(value);
            setArchiveUri(store.getArchiveUri());
          }}
        />
      </SettingsRow>
      <SettingsButtonRow
        label="Archive now"
        buttonLabel="Archive now"
        disabled={running}
        onClick={() => {
          scheduler.trigger();
        }}
      />
      <SettingsRow label="Status">
        <span>{status}</span>
      </SettingsRow>
      {list && !list.ok ? (
        <SettingsRow label="Playlists">
          <span>{LIST_ERROR_LINE}</span>
        </SettingsRow>
      ) : null}
    </SettingsSection>
  );
}

export function registerSettingsSection(ctx: ModuleRuntimeContext, deps: SettingsDeps): void {
  createRegistrar(ctx).register("settingsSection", <Section {...deps} />);
}
