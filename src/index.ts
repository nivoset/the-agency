#!/usr/bin/env node

import { Command } from "commander";

import { DEFAULT_AGENCY_REPO_URL, ensureDefaultLookupAgency, registerAgency } from "./agencyBootstrap.js";
import { resolveAgencyPath, tryReadRootDisplayDocument } from "./promptCatalog.js";
import { LocalStore } from "./store.js";
import type { AgencyRecord, ErrorResponse, HireResponse, JsonValue, ListingReadme } from "./types.js";

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printListingReadme(readme: ListingReadme): void {
  const text = readme.content.replace(/\r\n/g, "\n");
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
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
  const prepared = await registerAgency(store, repoUrl, {
    makeCurrent: true,
  });

  const payload: HireResponse = {
    ok: true,
    type: "hire",
    message: prepared.isLocalDirectory
      ? `Agency "${prepared.agencyKey}" is now active from the local directory source and ready for prompt lookup.`
      : `Agency "${prepared.agencyKey}" is now active and ready for prompt lookup.`,
    agency: prepared.agencyKey,
    repoUrl: prepared.repoUrl,
    localPath: prepared.localPath,
    didClone: prepared.sync.didClone,
    didPull: prepared.sync.didPull,
    warnings: prepared.sync.warnings,
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

async function handleLookup(
  store: LocalStore,
  selectors: string[],
  fields: string[] | undefined,
  asJson: boolean,
  helpText?: string,
): Promise<void> {
  const data = await store.load();
  let agency: AgencyRecord | undefined;

  if (data.currentAgency) {
    agency = data.agencies[data.currentAgency];
  } else {
    try {
      const bootstrapped = await ensureDefaultLookupAgency(store);
      if (bootstrapped) {
        agency = bootstrapped.record;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      printJson(
        buildError(
          `Failed to bootstrap the default agency from ${DEFAULT_AGENCY_REPO_URL}: ${reason}. Run \`the-agency hire <git-repo>\` or \`the-agency agencies use <agency-key>\` once network access is available.`,
        ),
      );
      process.exitCode = 1;
      return;
    }
  }

  if (!agency) {
    const message = data.currentAgency
      ? `The active agency "${data.currentAgency}" is missing from local storage. Run \`the-agency agencies list\` to inspect the registry.`
      : "No agency is active yet. Run `the-agency hire <git-repo>` or `the-agency agencies use <agency-key>` first.";
    printJson(buildError(message));
    process.exitCode = 1;
    return;
  }

  if (!asJson && selectors.length === 0 && !fields) {
    const displayDocument = await tryReadRootDisplayDocument(agency.localPath);
    if (displayDocument) {
      printListingReadme(displayDocument);
      return;
    }
    if (helpText) {
      process.stdout.write(helpText);
      return;
    }
  }

  const response = await resolveAgencyPath(agency.localPath, agency.key, selectors, fields);
  if (!asJson && response.ok && response.type === "listing" && response.readme) {
    printListingReadme(response.readme);
    return;
  }
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
    .option("--fields <fields>", "Comma-separated fields to include in listings or prompt payloads")
    .option("--json", "Always emit JSON (skip layer README text on stdout for listings with a README)");

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
      const options = program.opts<{ fields?: string; json?: boolean }>();
      const fields = parseFields(options.fields);
      await handleLookup(store, selectors, fields, Boolean(options.json), program.helpInformation());
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected the-agency CLI failure.";
  printJson(buildError(message));
  process.exitCode = 1;
});
