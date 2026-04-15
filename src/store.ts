import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgencyRecord, AgencyStore, JsonValue } from "./types.js";

const APP_DIR_NAME = ".agency";
const STORE_FILE_NAME = "store.json";
const REPOS_DIR_NAME = "repos";
const CORRUPTED_STORE_RECOVERY_GUIDANCE =
  "Delete or repair the file, or restore it from backup, then rerun the command.";

export interface StorePaths {
  appDir: string;
  reposDir: string;
  storeFile: string;
}

export function getDefaultStorePaths(): StorePaths {
  const configuredDir = process.env.AGENCY_HOME?.trim();
  const appDir = configuredDir
    ? path.resolve(configuredDir)
    : path.join(process.cwd(), APP_DIR_NAME);
  return {
    appDir,
    reposDir: path.join(appDir, REPOS_DIR_NAME),
    storeFile: path.join(appDir, STORE_FILE_NAME),
  };
}

export function createEmptyStore(): AgencyStore {
  return {
    config: {},
    currentAgency: null,
    agencies: {},
  };
}

export class LocalStore {
  public readonly paths: StorePaths;
  private cachedStore: AgencyStore | undefined;

  public constructor(paths: StorePaths = getDefaultStorePaths()) {
    this.paths = paths;
  }

  public async ensure(): Promise<void> {
    await mkdir(this.paths.appDir, { recursive: true });
    await mkdir(this.paths.reposDir, { recursive: true });
  }

  public async load(): Promise<AgencyStore> {
    await this.ensure();
    if (this.cachedStore) {
      return structuredClone(this.cachedStore);
    }

    try {
      const raw = await readFile(this.paths.storeFile, "utf8");
      this.cachedStore = this.normalizeStore(JSON.parse(raw) as Partial<AgencyStore>);
      return structuredClone(this.cachedStore);
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code === "ENOENT") {
        this.cachedStore = createEmptyStore();
        return structuredClone(this.cachedStore);
      }
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to read agency store at "${this.paths.storeFile}": ${error.message}. ` +
            CORRUPTED_STORE_RECOVERY_GUIDANCE,
          { cause: error },
        );
      }
      throw error;
    }
  }

  public async save(store: AgencyStore): Promise<void> {
    await this.ensure();
    const normalizedStore = this.normalizeStore(store);
    const tempFile = `${this.paths.storeFile}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(normalizedStore, null, 2)}\n`, "utf8");
    await rename(tempFile, this.paths.storeFile);
    this.cachedStore = structuredClone(normalizedStore);
  }

  public async listConfig(): Promise<Record<string, JsonValue>> {
    const store = await this.load();
    return store.config;
  }

  public async getConfig(key: string): Promise<JsonValue | undefined> {
    const store = await this.load();
    return store.config[key];
  }

  public async setConfig(key: string, value: JsonValue): Promise<AgencyStore> {
    const store = await this.load();
    store.config[key] = value;
    await this.save(store);
    return store;
  }

  public async listAgencies(): Promise<Record<string, AgencyRecord>> {
    const store = await this.load();
    return store.agencies;
  }

  public async setCurrentAgency(key: string): Promise<AgencyStore> {
    const store = await this.load();
    store.currentAgency = key;
    await this.save(store);
    return store;
  }

  public async upsertAgency(record: AgencyRecord, makeCurrent = true): Promise<AgencyStore> {
    const store = await this.load();
    store.agencies[record.key] = record;
    if (makeCurrent) {
      store.currentAgency = record.key;
    }
    await this.save(store);
    return store;
  }

  public async reset(): Promise<void> {
    await rm(this.paths.appDir, { recursive: true, force: true });
    this.cachedStore = undefined;
  }

  private normalizeStore(store: Partial<AgencyStore> | null | undefined): AgencyStore {
    return {
      config: store?.config ?? {},
      currentAgency: store?.currentAgency ?? null,
      agencies: store?.agencies ?? {},
    };
  }
}
