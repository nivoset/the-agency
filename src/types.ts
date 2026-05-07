export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface AgencyRecord {
  key: string;
  repoUrl: string;
  localPath: string;
  addedAt: string;
  updatedAt: string;
  lastPullAttemptAt?: string;
  lastPullSuccessAt?: string;
}

export interface AgencyStore {
  config: Record<string, JsonValue>;
  currentAgency: string | null;
  agencies: Record<string, AgencyRecord>;
}

export interface PromptFile {
  fileName: string;
  path: string;
  frontmatter: Record<string, JsonValue>;
  prompt: string;
}

export interface ListingFolder {
  name: string;
  path: string;
}

export interface ListingPromptSummary {
  fileName: string;
  path: string;
  [key: string]: JsonValue;
}

/** README text for the current listing directory when a conventional readme file exists and is readable. */
export interface ListingReadme {
  fileName: string;
  path: string;
  content: string;
}

export interface ListingResponse {
  ok: true;
  type: "listing";
  message: string;
  agency: string;
  contextPath: string;
  subdepartments: ListingFolder[];
  prompts: ListingPromptSummary[];
  /** Conventional README in the current listing directory, when present and readable. */
  readme?: ListingReadme;
}

export interface PromptResponse {
  ok: true;
  type: "prompt";
  message: string;
  agency: string;
  fileName: string;
  path: string;
  prompt: string;
  matchedBy?: string;
  [key: string]: JsonValue | undefined;
}

export interface ErrorResponse {
  ok: false;
  type: "error";
  message: string;
  candidates?: string[];
  contextPath?: string;
  availableCommands?: string[];
}

export interface HireResponse {
  ok: true;
  type: "hire";
  message: string;
  agency: string;
  repoUrl: string;
  localPath: string;
  didClone: boolean;
  didPull: boolean;
  warnings: string[];
}
