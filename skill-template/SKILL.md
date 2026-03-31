---
name: agency-cli
description: Load this skill when you need the exact agency agent for a task; it tells Codex how to browse, traverse, and resolve the right prompt fast.
---

# Agency CLI — Traversal & Prompt Retrieval

Use this skill to navigate an active agency repository and resolve prompts using `the-agency` CLI.

## Listing the Root

Start from the root to see all available divisions.

```bash
the-agency
```

Returns a JSON response with `"type": "listing"` containing `subdepartments` and `prompts` arrays.

## Traversing Into a Division

Pass one selector to drill into a division and see its agents.

```bash
the-agency <division>
```

Pass two selectors to resolve a specific prompt. Use the `fileName` stem (without `.md`) or the `name` from the listing as the agent selector.

```bash
the-agency <division> <agent>
```

Each listing level returns the same JSON shape: `subdepartments` (folders to go deeper) and `prompts` (resolvable agents). Follow one level at a time.

## Resolving a Prompt

When you reach a prompt, the response changes to `"type": "prompt"` and includes the full `prompt` field with the agent's system prompt content. The `matchedBy` field tells you how the CLI resolved the selector (e.g. `"frontmatter.name"` or `"fileName"`).

```bash
the-agency engineering technical-writer
```

## Filtering Fields

Use `--fields` to request only specific metadata in listing responses. Useful for scanning multiple divisions when choosing between candidates.

```bash
the-agency --fields name,description <division>
the-agency --fields name,description,color,emoji,vibe <division>
```

Available fields: `name`, `description`, `color`, `emoji`, `vibe`.

## Switching Active Agencies

If multiple agencies have been hired, list and switch between them.

```bash
the-agency agencies list
the-agency agencies use <agency-key>
```

## Routing Strategy

Divisions have no descriptions at the root level. Use these heuristics to narrow down which divisions to scan:

- **Code-level work** (reviews, architecture, implementation): `engineering`
- **QA, testing, auditing**: `testing`
- **Product, prioritization, roadmap**: `product`
- **UI/UX, design systems, visual polish**: `design`
- **Marketing, content, brand**: `marketing`
- **Niche/cross-domain specialists**: `specialized`
- **Process, workflows, coordination**: `project-management`

When a task could fit multiple divisions, scan 2-3 likely candidates with `--fields name,description` before resolving a full prompt.

## Worked Example

Task: find an agent for "testing a website for WCAG compliance."

```bash
# 1. Root listing — see all divisions
the-agency

# 2. Scan the testing division for candidates
the-agency --fields name,description testing

# 3. "Accessibility Auditor" matches — resolve its full prompt
the-agency testing accessibility-auditor
```

## Response Shapes

### Listing (`"type": "listing"`)

Returned when the selector resolves to a folder.

```json
{
  "ok": true,
  "type": "listing",
  "message": "These are the available options under ...",
  "agency": "agency-name",
  "contextPath": "testing",
  "subdepartments": [{ "name": "engineering", "path": "engineering" }],
  "prompts": [{ "fileName": "testing-accessibility-auditor.md", "path": "testing/testing-accessibility-auditor.md", "name": "Accessibility Auditor", "description": "..." }]
}
```

### Prompt (`"type": "prompt"`)

Returned when the selector resolves to a single agent.

```json
{
  "ok": true,
  "type": "prompt",
  "matchedBy": "frontmatter.name",
  "name": "Technical Writer",
  "description": "...",
  "prompt": "# Technical Writer Agent\n\nYou are a **Technical Writer**..."
}
```

## Practical Rules

- Always start from a root listing instead of guessing deep paths.
- Follow returned `subdepartments` or `prompts` one level at a time.
- Use the `fileName` stem (without `.md`) as the selector — this is the most reliable match.
- Trust exact matches from a listing over freehand guesses.
- Use `--fields` for ranking or routing decisions; fetch the full prompt only when the choice is clear.
- When multiple candidates match, resolve the full prompt for the top 1-2 and compare.
- If a selector is ambiguous, use the returned candidates and retry with a more exact selector.
- Treat dot-prefixed files and folders as hidden noise.
- Treat top-level `README` and `CONTRIBUTING` markdown files as non-prompts.
