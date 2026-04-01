import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { DEFAULT_AGENCY_REPO_URL, ensureDefaultLookupAgency } from "../agencyBootstrap.js";
import { parseFrontmatter } from "../frontmatter.js";
import { deriveAgencyKey, isLocalDirectorySource, shouldAttemptPull } from "../git.js";
import { resolveAgencyPath } from "../promptCatalog.js";
import { LocalStore } from "../store.js";

async function testParseFrontmatter(): Promise<void> {
  const result = parseFrontmatter(`---
name: UI Designer
description: Makes interfaces
---
# Prompt body
`);

  assert.equal(result.frontmatter.name, "UI Designer");
  assert.equal(result.frontmatter.description, "Makes interfaces");
  assert.equal(result.body, "# Prompt body\n");
}

async function testLocalStore(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agency-store-"));
  const store = new LocalStore({
    appDir: tempRoot,
    reposDir: path.join(tempRoot, "repos"),
    storeFile: path.join(tempRoot, "store.json"),
  });

  await store.setConfig("currentRepo", "example");
  await store.upsertAgency(
    {
      key: "agency-agents",
      repoUrl: "git@example.com:org/agency-agents.git",
      localPath: path.join(tempRoot, "repos", "agency-agents"),
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    true,
  );

  const reloaded = await store.load();
  assert.equal(reloaded.config.currentRepo, "example");
  assert.equal(reloaded.currentAgency, "agency-agents");
  assert.ok(reloaded.agencies["agency-agents"]);
}

async function testDefaultAgencyBootstrap(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agency-bootstrap-"));
  const store = new LocalStore({
    appDir: tempRoot,
    reposDir: path.join(tempRoot, "repos"),
    storeFile: path.join(tempRoot, "store.json"),
  });

  const bootstrapped = await ensureDefaultLookupAgency(store, {
    syncRepo: async () => ({
      didClone: true,
      didPull: false,
      pullAttempted: false,
      pullSucceeded: false,
      warnings: [],
    }),
  });

  assert.ok(bootstrapped);
  if (bootstrapped) {
    assert.equal(bootstrapped.repoUrl, DEFAULT_AGENCY_REPO_URL);
    assert.equal(bootstrapped.agencyKey, "msitarzewski-agency-agents");
    assert.equal(bootstrapped.record.key, "msitarzewski-agency-agents");
  }

  const reloaded = await store.load();
  assert.equal(reloaded.currentAgency, "msitarzewski-agency-agents");
  assert.ok(reloaded.agencies["msitarzewski-agency-agents"]);
}

async function testDefaultAgencyBootstrapFailureIsReported(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agency-bootstrap-failure-"));
  const fakeBinDir = path.join(tempRoot, "bin");
  await mkdir(fakeBinDir, { recursive: true });

  const fakeGitPath = path.join(fakeBinDir, "git");
  await writeFile(
    fakeGitPath,
    `#!/bin/sh
printf 'simulated git clone failure\\n' >&2
exit 1
`,
    "utf8",
  );
  await chmod(fakeGitPath, 0o755);

  const result = spawnSync(process.execPath, [path.join(process.cwd(), "dist", "index.js")], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENCY_HOME: tempRoot,
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, false);
  assert.equal(payload.type, "error");
  assert.match(payload.message, /default agency/i);
  assert.match(payload.message, /simulated git clone failure/);
  assert.match(payload.message, /the-agency hire/i);
  assert.match(payload.message, /the-agency agencies use/i);
}

async function testDefaultStorePathUsesProjectDirectory(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agency-cwd-"));
  const originalCwd = process.cwd();
  const originalHome = process.env.AGENCY_HOME;

  process.chdir(tempRoot);
  delete process.env.AGENCY_HOME;

  const { getDefaultStorePaths } = await import("../store.js");
  const paths = getDefaultStorePaths();
  assert.equal(paths.appDir, path.join(process.cwd(), ".agency"));

  process.chdir(originalCwd);
  if (typeof originalHome === "undefined") {
    delete process.env.AGENCY_HOME;
  } else {
    process.env.AGENCY_HOME = originalHome;
  }
}

async function testPromptResolution(): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agency-repo-"));
  const designDir = path.join(repoRoot, "design");
  const nestedDir = path.join(designDir, "specialists");
  await mkdir(nestedDir, { recursive: true });

  await writeFile(
    path.join(designDir, "ui_designer.md"),
    `---
name: UI Designer
description: Designs interfaces
color: purple
---
You are the UI designer.
`,
    "utf8",
  );

  await writeFile(
    path.join(nestedDir, "ux-researcher.md"),
    `---
name: UX Researcher
description: Finds user needs
---
You are the UX researcher.
`,
    "utf8",
  );

  const listing = await resolveAgencyPath(repoRoot, "agency-agents", ["design"]);
  assert.equal(listing.ok, true);
  if (listing.ok && listing.type === "listing") {
    assert.equal(listing.subdepartments[0]?.name, "specialists");
    assert.equal(listing.prompts[0]?.fileName, "ui_designer.md");
  }

  const resolved = await resolveAgencyPath(repoRoot, "agency-agents", ["design", "ui-designer"]);
  assert.equal(resolved.ok, true);
  if (resolved.ok && resolved.type === "prompt") {
    assert.equal(resolved.fileName, "ui_designer.md");
    assert.equal(resolved.name, "UI Designer");
    assert.equal(resolved.matchedBy, "fileName");
  }
}

async function testRootFilteringUsesGitignoreAndSkipsNoiseFiles(): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agency-repo-"));
  await mkdir(path.join(repoRoot, ".git"), { recursive: true });
  await mkdir(path.join(repoRoot, ".hidden"), { recursive: true });
  await mkdir(path.join(repoRoot, "node_modules"), { recursive: true });
  await mkdir(path.join(repoRoot, "team"), { recursive: true });

  await writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\nignored.md\n", "utf8");
  await writeFile(path.join(repoRoot, ".secret.md"), "---\nname: Secret\n---\nSecret\n", "utf8");
  await writeFile(path.join(repoRoot, "README.md"), "# Root readme\n", "utf8");
  await writeFile(path.join(repoRoot, "CONTRIBUTING.md"), "# Root contributing\n", "utf8");
  await writeFile(path.join(repoRoot, "ignored.md"), "---\nname: Ignored\n---\nIgnored\n", "utf8");
  await writeFile(path.join(repoRoot, "IGNORED.MD"), "---\nname: Ignored Upper\n---\nIgnored\n", "utf8");
  await writeFile(path.join(repoRoot, ".hidden", "buried.md"), "---\nname: Buried\n---\nBuried\n", "utf8");
  await writeFile(path.join(repoRoot, "team", "README.md"), "---\nname: Nested Readme Prompt\n---\nNested\n", "utf8");
  await writeFile(path.join(repoRoot, "team", "brief.md"), "---\nname: Team Brief\n---\nBrief\n", "utf8");

  const listing = await resolveAgencyPath(repoRoot, "agency-agents", []);
  assert.equal(listing.ok, true);
  if (listing.ok && listing.type === "listing") {
    assert.deepEqual(
      listing.subdepartments.map((item) => item.name),
      ["team"],
    );
    assert.deepEqual(listing.prompts, []);
  }

  const nestedListing = await resolveAgencyPath(repoRoot, "agency-agents", ["team"]);
  assert.equal(nestedListing.ok, true);
  if (nestedListing.ok && nestedListing.type === "listing") {
    assert.deepEqual(
      nestedListing.prompts.map((item) => item.fileName),
      ["brief.md", "README.md"],
    );
  }
}

async function testAmbiguity(): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "agency-repo-"));
  const designDir = path.join(repoRoot, "design");
  await mkdir(designDir, { recursive: true });

  await writeFile(path.join(designDir, "ui_designer.md"), "---\nname: UI Designer\n---\nA", "utf8");
  await writeFile(path.join(designDir, "ui-art-designer.md"), "---\nname: UI Art Designer\n---\nB", "utf8");

  const response = await resolveAgencyPath(repoRoot, "agency-agents", ["design", "ui"]);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.ok(response.candidates);
    assert.equal(response.candidates.length, 2);
  }
}

async function testHelpers(): Promise<void> {
  assert.equal(
    deriveAgencyKey("git@github.com:msitarzewski/agency-agents.git"),
    "msitarzewski-agency-agents",
  );
  const localDir = await mkdtemp(path.join(os.tmpdir(), "agency-source-"));
  assert.equal(await isLocalDirectorySource(localDir), true);
  assert.equal(await isLocalDirectorySource(path.join(localDir, "missing")), false);
  assert.equal(shouldAttemptPull(undefined), true);
  assert.equal(shouldAttemptPull(new Date().toISOString()), false);
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  assert.equal(shouldAttemptPull(old), true);
}

async function main(): Promise<void> {
  await testParseFrontmatter();
  await testLocalStore();
  await testDefaultAgencyBootstrap();
  await testDefaultAgencyBootstrapFailureIsReported();
  await testDefaultStorePathUsesProjectDirectory();
  await testPromptResolution();
  await testRootFilteringUsesGitignoreAndSkipsNoiseFiles();
  await testAmbiguity();
  await testHelpers();
  process.stdout.write("All tests passed.\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
