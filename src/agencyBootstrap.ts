import path from "node:path";

import { deriveAgencyKey, ensureRepo, getRepoLocalPath, isLocalDirectorySource, type SyncResult } from "./git.js";
import { LocalStore } from "./store.js";
import type { AgencyRecord } from "./types.js";

export const DEFAULT_AGENCY_REPO_URL = "https://github.com/msitarzewski/agency-agents.git";

export interface PreparedAgency {
  agencyKey: string;
  isLocalDirectory: boolean;
  localPath: string;
  record: AgencyRecord;
  repoUrl: string;
  sync: SyncResult;
}

export interface AgencySyncOptions {
  makeCurrent?: boolean;
  syncRepo?: (repoUrl: string, localPath: string, lastPullAttemptAt?: string) => Promise<SyncResult>;
}

async function prepareAgency(store: LocalStore, repoUrl: string, options: AgencySyncOptions = {}): Promise<PreparedAgency> {
  const current = await store.load();
  const now = new Date().toISOString();
  const isLocalDirectory = await isLocalDirectorySource(repoUrl);
  const agencyKey = isLocalDirectory ? deriveAgencyKey(path.basename(path.resolve(repoUrl))) : deriveAgencyKey(repoUrl);
  const existing = current.agencies[agencyKey];
  const localPath = isLocalDirectory
    ? path.resolve(repoUrl)
    : existing?.localPath ?? getRepoLocalPath(store.paths.reposDir, agencyKey);
  const syncRepo = options.syncRepo ?? ensureRepo;
  const sync = isLocalDirectory
    ? {
        didClone: false,
        didPull: false,
        pullAttempted: false,
        pullSucceeded: false,
        warnings: [],
      }
    : await syncRepo(repoUrl, localPath, existing?.lastPullAttemptAt);

  return {
    agencyKey,
    isLocalDirectory,
    localPath,
    repoUrl,
    sync,
    record: {
      key: agencyKey,
      repoUrl,
      localPath,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      lastPullAttemptAt: sync.pullAttempted ? now : existing?.lastPullAttemptAt,
      lastPullSuccessAt: sync.pullSucceeded ? now : existing?.lastPullSuccessAt,
    },
  };
}

export async function registerAgency(
  store: LocalStore,
  repoUrl: string,
  options: AgencySyncOptions = {},
): Promise<PreparedAgency> {
  const prepared = await prepareAgency(store, repoUrl, options);
  await store.upsertAgency(prepared.record, options.makeCurrent ?? true);
  return prepared;
}

export async function ensureDefaultLookupAgency(
  store: LocalStore,
  options: AgencySyncOptions = {},
): Promise<PreparedAgency | null> {
  const current = await store.load();
  if (current.currentAgency || Object.keys(current.agencies).length > 0) {
    return null;
  }

  return registerAgency(store, DEFAULT_AGENCY_REPO_URL, {
    ...options,
    makeCurrent: true,
  });
}

