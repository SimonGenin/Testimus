// Tests and steps

export type StepImage = { file: string; remoteId?: string; figure?: string };

// ponytail: column names the smart column a source backs and item the words of its cell it backs (a requirement
// code), written `@<column> "<item>"` after the quote; without them the source backs the step
export type Source = { docId: string; anchor: string; quote: string; column?: string; item?: string };

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

export type Review = "draft" | "to-fix" | "validated";
export const REVIEWS: readonly Review[] = ["draft", "to-fix", "validated"];
// ponytail: `checked` was a fourth state (a draft whose semantic check finished); a file or a Jira label still holding
// it is read as draft
export const LEGACY_DRAFT = "checked";
// ponytail: only what Claude generated waits for a reviewer; a test written by hand, pulled or imported is the team's own
export const awaitsReview = (t: { review: Review; generated: boolean }) => t.generated && t.review !== "validated";

export type Test = {
  key?: string;
  project: string;
  summary: string;
  folder: string;
  labels: string[];
  status?: string;
  assignee?: string;
  assigneeId?: string;
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
  status?: string;
  assignee?: string;
  assigneeId?: string;
  review: Review;
  generated: boolean;
  edited: boolean;
  sync: SyncState;
  dirty: boolean;
  synced: boolean;
  mtime: number;
  stepCount: number;
  findings?: FindingCounts;
  generating?: boolean;
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

// Xray step field schema

export type XrayField = {
  id: string;
  name: string;
  type: string;
  builtin: boolean;
  required?: boolean;
  disabled?: boolean;
};
// xray.json: what Xray says, read again on demand — never the team's choices
export type XrayJson = { fetchedAt?: string; fields: XrayField[] };

// How a column folds in the step card; a project column may also be hidden (left out unless a step holds text in it)
export type ColumnMode = "open" | "filled" | "collapsed";
export type ColumnShow = ColumnMode | "hidden";
export type ColumnModes = Record<string, ColumnMode>;

// columns.json: the team's step columns in display order. An entry with the id of an Xray step field follows that
// field (a rename in Xray keeps its description); one without id, or whose id Xray no longer has, is local — kept
// in test.md, never pushed. An Xray field without entry comes after them, with its defaults. `description` absent =
// never described (an empty one says Claude leaves the column empty)
export type ColumnEntry = {
  name: string;
  id?: string;
  description?: string;
  mode: ColumnShow;
  referenceSource?: boolean;
};
export type StepColumn = {
  name: string;
  id?: string;
  origin: "xray" | "local";
  builtin: boolean;
  status: "ok" | "new" | "gone";
  description: string;
  mode: ColumnShow;
  referenceSource?: boolean;
};
// What the step card draws: Xray's fields (types, switched off) and every column with its mode
export type ColumnLayout = { fetchedAt?: string; fields: XrayField[]; columns: StepColumn[] };

// tests/<id>/local.json: a test's own settings, outside test.md, never making the test modified
export type TestLocal = { contexts?: string[]; columns?: ColumnModes };

// tests/<id>/.state.json: what the app derived about a test (Jira seen changed since .remote.md; the print of what a
// generation wrote) — never edited
export type TestState = { remoteChangedAt?: string; generatedPrint?: string };

export const BUILTIN_FIELDS: readonly string[] = ["Action", "Data", "Expected Result"];

// Check

export type Severity = "error" | "warning" | "info";
export type FindingKind =
  | "source-missing"
  | "quote-not-found"
  | "quote-not-at-anchor"
  | "quote-weak"
  | "unsupported"
  | "contradicted"
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
  | "column-unsourced"
  | "item-not-found"
  | "observed-only"
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

// Documents

export type DocKind = "spec" | "minutes" | "other";
export type DocStatus = "draft" | "submitted" | "validated";
// docs/<id>/doc.json — the folder is the id (read in, never written). What the team decides (title… contexts,
// conversion) sits apart from what the conversion found (`converted`, absent until the first conversion)
export type DocStats = { sections: number; figures: number; chars: number };
export type DocJson = {
  id: string;
  code: string;
  title: string;
  version: string;
  date: string;
  kind: DocKind;
  status: DocStatus;
  amends?: string[];
  contexts?: string[];
  // `name`: where the original came from — its path on this PC, or the file name of an upload
  source: { name: string; file: string; sha256: string; uploaded?: boolean };
  // the other original beside it (source.pdf beside source.docx, or the reverse)
  twin?: { file: string; sha256: string };
  converted?: { with: string; at: string; warnings: string[]; stats?: DocStats };
  conversion?: DocConversion;
  // the batches of photos (and later videos) attached to the document: each included one is an annex of doc.md
  media?: MediaLot[];
};
// ponytail: one file of a batch — its copy under media/<lot>/files/, the picture made from it under figures/, and
// what Claude read in it (description, labels and kind live in figures.json under fig:lot-<lot>.<item>)
export type MediaItem = {
  id: string;
  name: string;
  file: string;
  kind: "photo";
  sha256: string;
  figure?: string;
  takenAt?: string;
  width?: number;
  height?: number;
  illustrates?: string[];
  state: "new" | "ready" | "analysed" | "failed";
  error?: string;
};
export type MediaLot = {
  id: string;
  title: string;
  included: boolean;
  // the team says the batch shows the reference behaviour: an expected result sourced from it alone is not flagged
  reference?: boolean;
  added: string;
  items: MediaItem[];
  analysed?: { at: string; model?: string; effort?: string };
  // what Claude chose in a video (chapters, key frames), kept so another analysis gives the same anchors (M5)
  plan?: Record<string, unknown>;
};
// ponytail: how a document is converted, chosen when Claude studied it (or by the team) and kept so that every
// reconversion gives the same result
export type DocConversion = {
  from?: "docx" | "pdf";
  reader?: "tagged" | "layout";
  numbers?: { number: string; title: string }[];
  // figures the conversion finds no picture for, drawn from a region of a page of the PDF copy
  figures?: { key: string; page: number; region: [number, number, number, number] }[];
  notes?: string;
};
export type FigureEntry = {
  file: string;
  anchor: string;
  caption: string;
  description: string;
  labels?: string[];
  kind?: "screen" | "diagram" | "symbol" | "table-image" | "photo";
  table?: string;
};
// ponytail: a document the index run under way reads (running, with how far it got) or will read (waiting)
export type DocIndexing = { state: "running" | "waiting"; percent: number; done: number; total: number };
export type DocRef = DocJson & { indexed: "fresh" | "stale" | "missing"; indexing?: DocIndexing };
export type IndexRun = { state: "running" | "waiting"; doc: number; docs: number; done: number; total: number };

// Index

export type ChunkKind = "section" | "figure";
export type Chunk = {
  id: string;
  docId: string;
  anchor: string;
  path: string;
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

export type SearchKind = "test" | "document" | "passage";
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
  /** the key:value filters the query holds, as typed (`known` false: a filter's key with a value it does not take) */
  filters: SearchFilter[];
  /** the query without its filters: what is left to read as words */
  words: string;
  /** the filter being typed at the end of the query, and the values it can take */
  suggest?: SearchSuggest;
};

export type SearchFilter = { token: string; key: string; value: string; known: boolean };
export type SearchSuggest = { token: string; key: string; values: { value: string; count?: number }[] };

export type PassageOutlineItem = {
  anchor: string;
  title: string;
  chars: number;
  figureIds: string[];
};
export type Passage = {
  docId: string;
  anchor: string;
  path: string;
  title: string;
  text: string;
  figures: FigureEntry[];
  truncated?: boolean;
  outline?: PassageOutlineItem[];
  readMore?: string;
  doc: { code: string; title: string; version: string; status: DocStatus };
};

// Document graph

export type EdgeKind = "refers" | "parent" | "sibling" | "shows" | "amends";
export type Edge = { from: string; to: string; kind: EdgeKind; docId: string };

// Retrieval

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

// Models

export type RuntimeId = "transformers" | "llamacpp" | "mock";
export type ModelKind = "embedding" | "reranker";
export type Device = "cpu" | "dml" | "webgpu" | "gpu";
export type Dtype = "fp32" | "fp16" | "q8" | "int8" | "uint8" | "q4" | "q4f16" | "bnb4";
export type HfFile = { path: string; sha256: string; size: number };
// The shape of a GGUF model that sets its memory in llama.cpp, read from its header; ctx is the context it is run with
export type GgufShape = { layers: number; kvHeads: number; keyLength: number; valueLength: number; ctx: number };
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
  gguf?: GgufShape;
  devices: ("gpu" | "cpu")[];
  provenOn?: string[];
  tier: "light" | "standard" | "quality";
  lighter?: string;
  heavier?: string;
};
export type PackVariant = { embedding: string; reranker: string | null };
export type PackMeasure = PackVariant & { first: number; top5: number; questions: number; app: string; date: string };
export type Pack = {
  id: string;
  label: string;
  intent: string;
  variants: PackVariant[];
  retrieval?: Partial<RetrievalSettings>;
  measured?: PackMeasure[];
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

// Vector spaces

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

// Machine, fit, timings, advice

export type GpuInfo = {
  name: string;
  vendor: "nvidia" | "amd" | "intel" | "other";
  driver?: string;
  vramTotalMB: number | null;
  vramUsedMB: number | null;
  source: "nvidia-smi" | "wmi" | "registry" | "llama.cpp";
  integrated?: boolean;
};
export type DriveInfo = { root: string; freeMB: number; totalMB: number };
export type LoadedModel = { name: string; sizeMB: number; vramMB: number; runtime: "llamacpp" };
export type MachineProfile = {
  at: string;
  system?: { platform: string; arch: string };
  onnx?: string | null;
  ramTotalMB: number;
  ramFreeMB: number;
  cpu: { model: string; threads: number };
  gpus: GpuInfo[];
  drives: DriveInfo[];
  loaded: LoadedModel[];
};
export type FitVerdict = "fits" | "tight" | "gpu-too-small" | "ram-too-small" | "unknown" | "untested" | "unsupported";
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

// Benchmark

export type EvidenceRole = "definition" | "rule" | "condition" | "exception" | "amendment" | "contradiction" | "figure";
export type Behavior = {
  id: string;
  question: string;
  queries: string[];
  evidence: { ref: string; role: EvidenceRole; must: boolean }[];
  category?: string;
  validated?: boolean;
};

// Project

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
    claudeHeaders?: boolean;
    describeFigures?: boolean;
    reference?: RagChoice;
    queryTask?: string;
    passageMaxChars?: number;
    retrieval?: Partial<RetrievalSettings>;
  };
  claude: ClaudeConfig;
  glossary?: Record<string, string>;
};

export type Context = { id: string; name: string; text: string; paths: string[]; files: string[] };

export type AgentsLevel = { agents: number; cpu: number; freeMB: number; searchMs: number };
export type AgentsMeasure = { limit: number; at: string; reason: string; levels: AgentsLevel[] };

export type Settings = {
  projects: string[];
  lastProject: string;
  claude: { exe: string };
  models: { allowRemote: boolean };
  agents?: { max?: number; adaptive?: boolean; measured?: AgentsMeasure };
  /** a service the user chose to work without: the system check says « not used », not « failed » */
  atlassian?: { skipJira?: boolean; skipXray?: boolean };
  ui?: Record<string, string>;
  rag?: {
    byProject?: Record<string, ActiveChoice>;
    budgets?: Partial<Budgets>;
    dismissed?: Record<string, string>;
    fitAccepted?: Record<string, FitVerdict>;
  };
  updates?: { from?: string };
};

// Claude runs

export type ClaudeScope =
  | { kind: "step"; testId: string; step: number }
  | { kind: "test"; testId: string }
  | { kind: "tests"; testIds: string[] }
  | { kind: "doc"; docId: string }
  | { kind: "project" };
export type ActionState = "open" | "running" | "done" | "dismissed";
export const ACTION_MODELS = ["haiku", "sonnet", "opus"] as const;
export const ACTION_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export type ActionModel = (typeof ACTION_MODELS)[number];
export type ActionEffort = (typeof ACTION_EFFORTS)[number];
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
  suggest?: { model: ActionModel; effort: ActionEffort };
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
/** a problem the app met (a failed check, an error): where it is, and what the app says about it */
export type ChatProblem = { where: string; text: string };
export type ChatSession = {
  id: string;
  sessionId?: string;
  title: string;
  turns: ChatTurn[];
  updatedAt: string;
  /** the conversation is about this problem, not the documents */
  problem?: ChatProblem;
};

// Jobs

export type JobStatus = "running" | "done" | "failed" | "cancelled";
export type JobCause = { jobId: string; why: "after-failure" | "follow-up" | "retry" };
export type StepStatus = "waiting" | "running" | "done" | "failed" | "cancelled" | "skipped";
export type JobStep = {
  id: string;
  label: string;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  done?: number;
  total?: number;
  message?: string;
  jobId?: string;
};
export type JobProcess = {
  id: string;
  label: string;
  command: string;
  pid?: number;
  step?: string;
  startedAt: string;
  endedAt?: string;
  exit?: number | null;
};
export type Job = {
  id: string;
  kind: string;
  subject: string;
  label?: string;
  status: JobStatus;
  startedAt: string;
  endedAt?: string;
  progress?: { done: number; total: number };
  message?: string;
  result?: unknown;
  error?: string;
  fix?: string;
  // a stable name for the failure (UserError.code), so a page reacts to it without reading the message
  code?: string;
  pid?: number;
  parentId?: string;
  cause?: JobCause;
  steps?: JobStep[];
  processes?: JobProcess[];
  interrupted?: true;
  rerun?: { name: string; input: unknown };
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
// ponytail: every event names its project (null: the machine's own work), so a page only follows its own project
export type JobEvent = (
  | { jobId: string; at: string; type: "status"; job: Job }
  | {
      jobId: string;
      at: string;
      type: "progress";
      message: string;
      done?: number;
      total?: number;
      pull?: PullInfo;
      step?: string;
    }
  | { jobId: string; at: string; type: "log"; level: "info" | "warn" | "error"; message: string; step?: string }
  | { jobId: string; at: string; type: "claude"; event: ClaudeEvent; step?: string; process?: string }
  | { jobId: string; at: string; type: "steps"; steps: JobStep[] }
  | { jobId: string; at: string; type: "process"; process: JobProcess }
  | { jobId: string; at: string; type: "changed"; paths: string[]; added?: string[]; removed?: string[] }
  | { jobId: ""; at: string; type: "notice"; message: string }
) & { project?: string | null };

// System

export type CheckState = "ok" | "warn" | "fail" | "skip";
export type DoctorAction = { label: string; command: string; input?: Record<string, unknown>; value?: string };
export type DoctorCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  fix?: string;
  action?: DoctorAction;
  also?: DoctorAction;
  caution?: string;
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
