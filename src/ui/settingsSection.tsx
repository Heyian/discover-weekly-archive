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

  React.useEffect(() => {
    let active = true;
    library.listPlaylists().then(
      (playlists) => {
        if (active) setList({ ok: true, playlists });
      },
      () => {
        if (active) setList({ ok: false });
      },
    );
    return () => {
      active = false;
    };
  }, [library]);

  React.useEffect(() => {
    const refresh = (): void => {
      setRunning(scheduler.isRunning());
      setStatus(statusLine(store.getLastRun(), formatTime));
    };
    refresh();
    return scheduler.onChange(refresh);
  }, [scheduler, store, formatTime]);

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
