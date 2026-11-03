// Tests and steps (SPEC §6, Xray Editor SPEC §3)

export type StepImage = { file: string; remoteId?: string; figure?: string };

export type Source = { docId: string; anchor: string; quote: string };

export type Step = {
  id?: string;
  fields: Record<string, string>;
  sources: Source[];
  images: StepImage[];
};

export type Cell = { text: string; at: number; end: number };
export type Row = { head: boolean; cells: Cell[]; at: number; end: number };
export type Table = { rows: Row[]; at: number; end: number };
export type Block =
  | { kind: "text"; text: string; at: number; end: number }
  | { kind: "image"; image: StepImage; params: string; at: number; end: number }
  | { kind: "extern"; url: string; params: string; at: number; end: number }
  | { kind: "table"; rows: Row[]; at: number; end: number }
  | { kind: "raw"; text: string; at: number; end: number };

export type Review = "draft" | "checked" | "to-fix" | "validated";
export const REVIEWS: readonly Review[] = ["draft", "checked", "to-fix", "validated"];
// ponytail: only what Claude generated waits for a reviewer; a test written by hand, pulled or imported is the team's own
export const awaitsReview = (t: { review: Review; generated: boolean }) => t.generated && t.review !== "validated";

export type Test = {
  key?: string;
  project: string;
  summary: string;
  folder: string;
  labels: string[];
  status?: string;
  description: string;
  covers: string[];
  clonedFrom?: string;
  preconditions: string[];
  review: Review;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  generatedBy?: string;
  steps: Step[];
  extra: Record<string, string>;
};

export type SyncState = "local" | "modified" | "synced" | "remote-changed";

export type FindingCounts = { errors: number; warnings: number; infos: number; stale: boolean };

export type LocalTestRef = {
  id: string;
  key?: string;
  summary: string;
  folder: string;
  review: Review;
  generated: boolean;
  edited: boolean;
  sync: SyncState;
  dirty: boolean;
  synced: boolean;
  mtime: number;
  stepCount: number;
  findings?: FindingCounts;
};

export type CitingTest = { id: string; key?: string; summary: string; review: Review; steps: number };

export type RemoteTestRef = {
  key: string;
  issueId: string;
  summary: string;
  status: string;
  labels: string[];
  folder: string;
  stepCount: number;
};
export type Precondition = { key: string; issueId: string; summary: string; definition: string };
export type Folder = { name: string; path: string; testsCount: number; totalCount: number; folders: Folder[] };
export type ProjectInfo = { id: string; key: string; name: string; testIssueTypeId: string; testIssueTypeName: string };

export type PlanOp = {
  label: string;
  kind: "create" | "update" | "upload" | "embed" | "label" | "link" | "folder" | "other";
};
export type PushPlanView = {
  testId: string;
  key?: string;
  ops: PlanOp[];
  warnings: string[];
  remoteChanged: boolean;
  review: Review;
  planHash?: string;
};
export type PushOpResult = { label: string; status: "done" | "failed" | "not-started"; error?: string };

// Xray step field schema (SPEC §10)

export type XrayField = {
  id: string;
  name: string;
  type: string;
  builtin: boolean;
  required?: boolean;
  disabled?: boolean;
};
export type FieldPrefs = { order: string[]; collapsed: string[]; hidden: string[]; filled?: string[]; open?: string[] };
export type ColumnMode = "open" | "filled" | "collapsed";
export type ColumnModes = Record<string, ColumnMode>;
export type XrayJson = { fields: XrayField[]; prefs: FieldPrefs; fetchedAt?: string; columns?: ColumnDef[] };

// Step columns: what Claude writes in each field (description), and the columns that live only in test.md.
// A column of Xray is followed by its field id (a rename in Xray keeps its description); one without id, or
// whose id Xray no longer has, is local — kept in test.md, never pushed
export type ColumnDef = { name: string; id?: string; description?: string };
export type StepColumn = {
  name: string;
  origin: "xray" | "local";
  builtin: boolean;
  status: "ok" | "new" | "gone";
  description: string;
};

export const BUILTIN_FIELDS: readonly string[] = ["Action", "Data", "Expected Result"];

// Check (SPEC §8)

export type Severity = "error" | "warning" | "info";
export type FindingKind =
  | "source-missing"
  | "quote-not-found"
  | "quote-not-at-anchor"
  | "quote-weak"
  | "related-unread"
  | "unsupported"
  | "contradicted"
  | "wrong-requirement"
  | "requirement-unknown"
  | "id-unknown"
  | "requirement-not-covered"
  | "wrong-object"
  | "negative-missing"
  | "case-missing"
  | "not-simulated-unsourced"
  | "vague-result"
  | "documents-conflict"
  | "empty-field"
  | "raw-embed"
  | "duplicate-step"
  | "figure-not-embedded"
  | "other";
export type Finding = {
  step?: number;
  kind: FindingKind;
  severity: Severity;
  message: string;
  sources: string[];
  pass?: "mechanical" | "semantic";
};
export type CheckFile = { at: string; testHash: string; findings: Finding[] };

// Documents (SPEC §4)

export type DocKind = "spec" | "requirements" | "minutes" | "other";
export type DocStatus = "draft" | "submitted" | "validated";
export type DocJson = {
  id: string;
  code: string;
  title: string;
  version: string;
  date: string;
  kind: DocKind;
  status: DocStatus;
  amends?: string[];
  source: { path: string; sha256: string; file: string };
  convertedWith: string;
  convertedAt: string;
  warnings: string[];
  stats?: { sections: number; figures: number; requirements: number; chars: number };
};
export type FigureEntry = {
  file: string;
  anchor: string;
  caption: string;
  description: string;
  labels?: string[];
  kind?: "screen" | "diagram" | "symbol" | "table-image" | "photo";
};
export type DocRef = DocJson & { indexed: "fresh" | "stale" | "missing" };

// Index (SPEC §5)

export type ModelProfile = {
  name: string;
  hfId: string;
  dims: number;
  dtype: "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4";
  pooling: "cls" | "mean" | "last";
  normalize: boolean;
  queryPrefix: string;
  docPrefix: string;
  maxTokens: number;
};
export type ChunkKind = "section" | "figure" | "matrix-row";
export type Chunk = {
  id: string;
  docId: string;
  anchor: string;
  path: string;
  reqIds: string[];
  figureIds: string[];
  header: string;
  text: string;
  kind: ChunkKind;
};
export type SearchHit = {
  docId: string;
  anchor: string;
  path: string;
  text: string;
  header: string;
  score: number;
  kind: ChunkKind;
  figure?: string;
  via?: "section" | "graph";
  degraded?: boolean;
};

// Search everywhere (search.all)

export type SearchKind = "test" | "requirement" | "document" | "passage";
export type SearchMark = [number, number];
export type SearchMatch = {
  kind: SearchKind;
  id: string;
  title: string;
  titleMarks: SearchMark[];
  detail?: string;
  snippet?: string;
  marks: SearchMark[];
  where?: string;
  score: number;
  why: "words" | "meaning" | "both" | "filter";
  testId?: string;
  key?: string;
  review?: Review;
  awaiting?: boolean;
  step?: number;
  docId?: string;
  anchor?: string;
};
export type SearchResult = {
  hits: SearchMatch[];
  totals: Partial<Record<SearchKind, number>>;
  order: SearchKind[];
  meaning: "on" | "off" | "unavailable";
  unembedded: number;
  notes: string[];
};

export type PassageOutlineItem = {
  anchor: string;
  title: string;
  chars: number;
  reqIds: string[];
  figureIds: string[];
};
export type Passage = {
  docId: string;
  anchor: string;
  path: string;
  title: string;
  text: string;
  figures: FigureEntry[];
  focus?: string;
  truncated?: boolean;
  outline?: PassageOutlineItem[];
  readMore?: string;
  doc: { code: string; title: string; version: string; status: DocStatus };
};

// Evidence model (SPEC-RAG §3)

export type ReqStatement = {
  id: string;
  docId: string;
  source: "body" | "matrix";
  section: string;
  text: string;
  traced: string[];
};
export type RequirementMatrixSpec = { idColumn: string; sectionColumn: string; textColumn?: string };
export type EdgeKind = "defines" | "traces" | "mentions" | "refers" | "parent" | "sibling" | "shows" | "amends";
export type Edge = { from: string; to: string; kind: EdgeKind; docId: string };

// Retrieval (SPEC-RAG §4)

export type RerankMode = "topk" | "threshold";
export type RetrievalSettings = {
  candidates: number;
  rrfK: number;
  bm25Weights: number[];
  rerank: { top: number; mode: RerankMode; threshold?: number; thresholds?: Record<string, number> };
  expand: "none" | "section" | "graph";
};
export type RagChoice = { pack: string } | { embedding: string; reranker: string | null };
export type ActiveChoice = RagChoice & { variant?: PackVariant };

// Models (SPEC-RAG §7, §8)

export type RuntimeId = "transformers" | "llamacpp" | "mock";
export type ModelKind = "embedding" | "reranker";
export type Device = "cpu" | "dml" | "webgpu" | "gpu";
export type Dtype = "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4" | "q4f16" | "bnb4";
export type HfFile = { path: string; sha256: string; size: number };
export type CatalogEntry = {
  id: string;
  kind: ModelKind;
  label: string;
  family: string;
  licence: string;
  commercialUse: boolean;
  runtimes: RuntimeId[];
  source: {
    hf?: { repo: string; revision: string; path?: string; files?: HfFile[] };
    file?: { sha256: string; size: number };
  };
  quantization: string;
  dtypeByDevice?: Partial<Record<Device, Dtype>>;
  dims: number;
  dimsOptions?: number[];
  maxInputTokens: number;
  pooling?: "cls" | "mean" | "last";
  normalize?: boolean;
  queryInstruction: string;
  docInstruction: string;
  rerankerKind?: "cross-encoder" | "yes-no-lm" | "http";
  size: { downloadMB: number; ramMB: number; vramMB: number };
  devices: ("gpu" | "cpu")[];
  tier: "light" | "standard" | "quality";
  lighter?: string;
  heavier?: string;
  legacyProfile?: string;
};
export type PackVariant = { embedding: string; reranker: string | null };
export type Pack = {
  id: string;
  label: string;
  intent: string;
  variants: PackVariant[];
  retrieval?: Partial<RetrievalSettings>;
};
export type Catalog = { version: number; entries: CatalogEntry[]; packs: Pack[] };

export type InstallVia = "path" | "download";
export type InstallState = "available" | "downloading" | "installed" | "verified" | "active" | "broken" | "outdated";
export type Installation = {
  model: string;
  via: InstallVia;
  runtime: RuntimeId;
  path?: string;
  revision?: string;
  dtype?: Dtype;
  device?: Device;
  sha256?: string;
  dims?: number;
  status: InstallState;
  verifiedAt?: string;
};
export type LlamaBackend = "cuda" | "vulkan" | "cpu";
export type LlamaRuntime = { exe: string; build: string; backend: LlamaBackend; via: "path" | "download" };
export type ModelsRegistry = {
  dir?: string;
  runtimesDir?: string;
  allowRemote: boolean;
  installs: Installation[];
  llamacpp?: LlamaRuntime;
  catalog?: CatalogEntry[];
};
export type ResolvedModel = {
  entry: CatalogEntry;
  install: Installation;
  runtime: RuntimeId;
  device: Device;
  dtype?: Dtype;
  queryTask: string;
};
export type EmbedMode = "query" | "doc";
export type EmbeddingRuntime = {
  probe(m: ResolvedModel): Promise<{ dims: number; maxTokens: number }>;
  embed(m: ResolvedModel, texts: string[], mode: EmbedMode): Promise<Float32Array[]>;
};
export type RerankRuntime = { rerank(m: ResolvedModel, query: string, texts: string[]): Promise<number[]> };

// Vector spaces (SPEC-RAG §6)

export type SpaceFingerprint = {
  runtime: RuntimeId;
  model: string;
  modelId: string;
  pooling: string;
  normalize: boolean;
  queryInstruction: string;
  docInstruction: string;
  dims: number;
  maxInputTokens: number;
  recipe: number;
  unpinned?: boolean;
};
export type VectorSpace = {
  id: string;
  fingerprint: SpaceFingerprint;
  modelId: string;
  dims: number;
  builtAt: string | null;
  complete: boolean;
  lastUsed: string | null;
};

// Machine, fit, timings, advice (SPEC-RAG §7.8–§7.10)

export type GpuInfo = {
  name: string;
  vendor: "nvidia" | "amd" | "intel" | "other";
  driver?: string;
  vramTotalMB: number | null;
  vramUsedMB: number | null;
  source: "nvidia-smi" | "wmi" | "registry";
};
export type DriveInfo = { root: string; freeMB: number; totalMB: number };
export type LoadedModel = { name: string; sizeMB: number; vramMB: number; runtime: "llamacpp" };
export type MachineProfile = {
  at: string;
  ramTotalMB: number;
  ramFreeMB: number;
  cpu: { model: string; threads: number };
  gpus: GpuInfo[];
  drives: DriveInfo[];
  loaded: LoadedModel[];
};
export type FitVerdict = "fits" | "tight" | "gpu-too-small" | "ram-too-small" | "unknown";
export type Fit = {
  verdict: FitVerdict;
  device: "gpu" | "cpu";
  needMB: { vram: number; ram: number };
  freeMB: { vram: number | null; ram: number };
  totalMB: { vram: number | null; ram: number };
  unload: string[];
  message: string;
};
export type PerfOp =
  | "embed.query"
  | "embed.index"
  | "rerank"
  | "search.bm25"
  | "search.vector"
  | "search.total"
  | "model.load"
  | "claude.run";
export type PerfLine = {
  at: string;
  op: PerfOp;
  model?: string;
  fingerprint?: string;
  runtime?: RuntimeId;
  device?: Device;
  quantization?: string;
  items: number;
  tokens?: number;
  ms: number;
  loadMs?: number;
  peakRssMB?: number;
  vramMB?: number;
  partialOffload?: boolean;
  oom?: boolean;
  project?: string;
  jobId?: string;
};
export type Budgets = { queryMs: number; indexPassagesPerSec: number; headroom: number };
export type Advice = {
  id: string;
  direction: "upgrade" | "downgrade";
  from: RagChoice;
  to: RagChoice;
  reason: string;
  quality: string;
};

// Benchmark (SPEC-RAG §10)

export type EvidenceRole = "definition" | "rule" | "condition" | "exception" | "amendment" | "contradiction" | "figure";
export type Behavior = {
  id: string;
  question: string;
  queries: string[];
  evidence: { ref: string; role: EvidenceRole; must: boolean }[];
  category?: string;
  validated?: boolean;
};

// Project (SPEC §3)

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type ClaudeRun = { model?: string; effort?: Effort };
export type Preset = { label: string; prompt: string };
export type ClaudeConfig = { model: string; effort: Effort; presets: Preset[]; contexts: string[] };
export type ProjectJson = {
  name: string;
  jiraProject: string;
  jiraOffline?: boolean;
  language: string;
  labelPrefix: string;
  folders: string[];
  rag: {
    embedding: string;
    reranker: string | null;
    claudeHeaders?: boolean;
    describeFigures?: boolean;
    reference?: RagChoice;
    queryTask?: string;
    passageMaxChars?: number;
    retrieval?: Partial<RetrievalSettings>;
  };
  claude: ClaudeConfig;
  csvMapping?: Record<string, string>;
  requirementPatterns?: string[];
  requirementMatrix?: RequirementMatrixSpec;
  requirementField?: string;
  traces?: Trace[];
  glossary?: Record<string, string>;
};

// Tracked ids (SPEC §4 « Tracked ids »): what the team picks out of the documents and writes in a step column
export type Trace = { id: string; label: string; patterns: string[]; field: string; ask?: string };
export type TraceView = Trace & {
  origin: "declared" | "detected";
  column: "in-xray" | "local";
  found: number;
  docs: number;
};
export type TraceItem = { id: string; doc: string; anchor: string; context: string };
export type TraceScan = {
  total: number;
  distinct: number;
  docs: { doc: string; count: number; distinct: number }[];
  items: TraceItem[];
};
export type TraceUse = { test: string; key?: string; summary: string; steps: number[] };
export type TraceCoverage = {
  trace: string;
  label: string;
  field: string;
  total: number;
  covered: number;
  tests: number;
  items: (TraceItem & { uses: TraceUse[] })[];
  unknown: { id: string; uses: TraceUse[] }[];
};
export type Context = { id: string; name: string; text: string; paths: string[]; files: string[] };

export type Settings = {
  projects: string[];
  lastProject: string;
  theme: "system" | "light" | "dark";
  stepLayout: "stacked" | "split";
  claude: { exe: string };
  models: { allowRemote: boolean };
  ui?: Record<string, string>;
  rag?: { byProject?: Record<string, ActiveChoice>; budgets?: Partial<Budgets>; dismissed?: Record<string, string> };
};

// Claude runs (SPEC §11)

export type ClaudeScope =
  | { kind: "step"; testId: string; step: number }
  | { kind: "test"; testId: string }
  | { kind: "tests"; testIds: string[] }
  | { kind: "doc"; docId: string }
  | { kind: "project" };
export type ActionState = "open" | "running" | "done" | "dismissed";
export type ClaudeAction = {
  id: string;
  title: string;
  scope: ClaudeScope;
  where: string;
  problem: string;
  why: string;
  plan: string[];
  stamp: string;
  proposedBy: { run: string; model: string; effort: Effort | ""; at: string; runId?: string };
  state: ActionState;
  at: string;
  last?: { runId: string; ok: boolean; summary: string; at: string; model: string; effort: Effort };
};
export type ClaudeEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: string }
  | {
      type: "result";
      ok: boolean;
      text: string;
      costUsd?: number;
      tokens?: Tokens;
      sessionId?: string;
      durationMs: number;
    }
  | { type: "stderr"; text: string };
export type Tokens = { input: number; output: number };
export type ClaudeResult = {
  ok: boolean;
  summary: string;
  durationMs: number;
  costUsd?: number;
  tokens?: Tokens;
  sessionId?: string;
  changedTests: string[];
  diagnosis?: Diagnosis;
  raw: string;
};
export type Diagnosis = {
  kind: "connect" | "login" | "credit" | "limit" | "network" | "other";
  title: string;
  detail: string;
};
export type ChatTurn = { role: "user" | "assistant"; text: string; at: string };
export type ChatSession = { id: string; sessionId?: string; title: string; turns: ChatTurn[]; updatedAt: string };

// Jobs (SPEC §2)

export type JobStatus = "running" | "done" | "failed" | "cancelled";
export type Job = {
  id: string;
  kind: string;
  subject: string;
  status: JobStatus;
  startedAt: string;
  endedAt?: string;
  progress?: { done: number; total: number };
  message?: string;
  result?: unknown;
  error?: string;
  pid?: number;
};
export type PullStage =
  | {
      phase: "read";
      summary: string;
      folder: string;
      status?: string;
      steps: number;
      images: number;
      preconditions: number;
      covers: number;
      labels: number;
    }
  | { phase: "images"; done: number; total: number }
  | { phase: "write" };
export type PullInfo = { key: string } & PullStage;
export type JobEvent =
  | { jobId: string; at: string; type: "status"; job: Job }
  | {
      jobId: string;
      at: string;
      type: "progress";
      message: string;
      done?: number;
      total?: number;
      pull?: PullInfo;
    }
  | { jobId: string; at: string; type: "log"; level: "info" | "warn" | "error"; message: string }
  | { jobId: string; at: string; type: "claude"; event: ClaudeEvent }
  | { jobId: ""; at: string; type: "notice"; message: string };

// System (SPEC §14)

export type CheckState = "ok" | "warn" | "fail" | "skip";
export type DoctorAction = { label: string; command: string; input?: Record<string, unknown>; value?: string };
export type DoctorCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  fix?: string;
  action?: DoctorAction;
};
export type CredsStatus = {
  jira: {
    file: string;
    exists: boolean;
    complete: boolean;
    invalid?: boolean;
    problem?: string;
    baseUrl?: string;
    email?: string;
  };
  xray: { file: string; exists: boolean; complete: boolean; invalid?: boolean; problem?: string };
};
