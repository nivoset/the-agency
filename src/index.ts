#!/usr/bin/env node

import { Command } from "commander";
import path from "node:path";

import { deriveAgencyKey, ensureRepo, getRepoLocalPath, isLocalDirectorySource } from "./git.js";
import { resolveAgencyPath } from "./promptCatalog.js";
import { LocalStore } from "./store.js";
import type { AgencyRecord, ErrorResponse, HireResponse, JsonValue } from "./types.js";

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function toJsonValue(input: string): JsonValue {
  const trimmed = input.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as JsonValue;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function parseFields(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const fields = value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  return fields.length > 0 ? fields : undefined;
}

function buildError(message: string, extras: Partial<ErrorResponse> = {}): ErrorResponse {
  return {
    ok: false,
    type: "error",
    message,
    ...extras,
  };
}

async function handleHire(store: LocalStore, repoUrl: string): Promise<void> {
  const current = await store.load();
  const now = new Date().toISOString();
  const isLocalDirectory = await isLocalDirectorySource(repoUrl);
  const agencyKey = isLocalDirectory ? deriveAgencyKey(path.basename(path.resolve(repoUrl))) : deriveAgencyKey(repoUrl);
  const existing = current.agencies[agencyKey];
  const localPath = isLocalDirectory
    ? path.resolve(repoUrl)
    : existing?.localPath ?? getRepoLocalPath(store.paths.reposDir, agencyKey);
  const sync = isLocalDirectory
    ? {
        didClone: false,
        didPull: false,
        pullAttempted: false,
        pullSucceeded: false,
        warnings: [],
      }
    : await ensureRepo(repoUrl, localPath, existing?.lastPullAttemptAt);

  const record: AgencyRecord = {
    key: agencyKey,
    repoUrl,
    localPath,
    addedAt: existing?.addedAt ?? now,
    updatedAt: now,
    lastPullAttemptAt: sync.pullAttempted ? now : existing?.lastPullAttemptAt,
    lastPullSuccessAt: sync.pullSucceeded ? now : existing?.lastPullSuccessAt,
  };

  await store.upsertAgency(record, true);

  const payload: HireResponse = {
    ok: true,
    type: "hire",
    message: isLocalDirectory
      ? `Agency "${agencyKey}" is now active from the local directory source and ready for prompt lookup.`
      : `Agency "${agencyKey}" is now active and ready for prompt lookup.`,
    agency: agencyKey,
    repoUrl,
    localPath,
    didClone: sync.didClone,
    didPull: sync.didPull,
    warnings: sync.warnings,
  };
  printJson(payload);
}

async function handleAgencyList(store: LocalStore): Promise<void> {
  const data = await store.load();
  const agencies = Object.values(data.agencies).sort((left, right) => left.key.localeCompare(right.key));

  printJson({
    ok: true,
    type: "agencies",
    message: agencies.length
      ? "These are the agencies currently registered in local storage."
      : "No agencies are registered yet. Run `the-agency hire <git-repo>` to add one.",
    currentAgency: data.currentAgency,
    agencies,
  });
}

async function handleAgencyUse(store: LocalStore, agencyKey: string): Promise<void> {
  const data = await store.load();
  if (!data.agencies[agencyKey]) {
    printJson(
      buildError(`Agency "${agencyKey}" is not registered locally. Run \`the-agency agencies list\` to see valid options.`),
    );
    process.exitCode = 1;
    return;
  }

  await store.setCurrentAgency(agencyKey);
  printJson({
    ok: true,
    type: "agency-select",
    message: `Agency "${agencyKey}" is now active.`,
    agency: agencyKey,
  });
}

async function handleConfigList(store: LocalStore): Promise<void> {
  const config = await store.listConfig();
  printJson({
    ok: true,
    type: "config-list",
    message: Object.keys(config).length
      ? "These are the locally stored config options."
      : "There are no config values stored yet.",
    config,
  });
}

async function handleConfigGet(store: LocalStore, key: string): Promise<void> {
  const value = await store.getConfig(key);
  if (typeof value === "undefined") {
    printJson(buildError(`Config key "${key}" is not set locally.`));
    process.exitCode = 1;
    return;
  }

  printJson({
    ok: true,
    type: "config-get",
    message: `Loaded config key "${key}".`,
    key,
    value,
  });
}

async function handleConfigSet(store: LocalStore, key: string, value: string): Promise<void> {
  const parsed = toJsonValue(value);
  await store.setConfig(key, parsed);
  printJson({
    ok: true,
    type: "config-set",
    message: `Stored config key "${key}".`,
    key,
    value: parsed,
  });
}

async function handleLookup(store: LocalStore, selectors: string[], fields?: string[]): Promise<void> {
  const data = await store.load();
  if (!data.currentAgency) {
    printJson(
      buildError(
        "No agency is active yet. Run `the-agency hire <git-repo>` or `the-agency agencies use <agency-key>` first.",
      ),
    );
    process.exitCode = 1;
    return;
  }

  const agency = data.agencies[data.currentAgency];
  if (!agency) {
    printJson(
      buildError(
        `The active agency "${data.currentAgency}" is missing from local storage. Run \`the-agency agencies list\` to inspect the registry.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const response = await resolveAgencyPath(agency.localPath, agency.key, selectors, fields);
  printJson(response);
  if (!response.ok) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const store = new LocalStore();
  const program = new Command();

  program
    .name("the-agency")
    .description("Hire prompt repositories and resolve prompts from the active agency")
    .showHelpAfterError()
    .option("--fields <fields>", "Comma-separated fields to include in listings or prompt payloads");

  program
    .command("hire")
    .argument("<git-repo>", "Git repository URL to clone or reactivate")
    .action(async (gitRepo: string) => {
      await handleHire(store, gitRepo);
    });

  const agencies = program.command("agencies").description("Inspect or switch locally stored agencies");
  agencies.command("list").action(async () => {
    await handleAgencyList(store);
  });
  agencies
    .command("use")
    .argument("<agency-key>", "Agency key from the local registry")
    .action(async (agencyKey: string) => {
      await handleAgencyUse(store, agencyKey);
    });

  const config = program.command("config").description("Manage local config key/value items");
  config.command("list").action(async () => {
    await handleConfigList(store);
  });
  config
    .command("get")
    .argument("<key>", "Config key to read")
    .action(async (key: string) => {
      await handleConfigGet(store, key);
    });
  config
    .command("set")
    .argument("<key>", "Config key to write")
    .argument("<value>", "JSON, number, boolean, null, or string value")
    .action(async (key: string, value: string) => {
      await handleConfigSet(store, key, value);
    });

  program
    .argument("[selectors...]", "Folder and prompt selectors for the active agency")
    .action(async (selectors: string[]) => {
      const fields = parseFields(program.opts<{ fields?: string }>().fields);
      await handleLookup(store, selectors, fields);
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected the-agency CLI failure.";
  printJson(buildError(message));
  process.exitCode = 1;
});
