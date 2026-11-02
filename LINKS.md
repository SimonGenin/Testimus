# LINKS.md — what Testimus reuses on this PC

Where each piece lives and what to take from it. Read the original; never edit it from here.
`.claude/settings.json` grants read access to these folders.

## Code to port

| Where | What to take |
|---|---|
| `D:\Projects\XrayEditor\SPEC.md` | §3 test file format, §5 module contracts, §6 sync semantics (pull, dirty detection, push plan, 429 back-off), §7 Claude runs (prompt on stdin, snapshot/revert, failure diagnosis), §9 browser-mock mode |
| `D:\Projects\XrayEditor\src\lib\` | `testfile.ts`, `table.ts`, `adf.ts`, `jira.ts`, `sync.ts`, `store.ts`, `claude.ts`, `activity.ts`, `types.ts`; `api.mock.ts` (fixture Jira) becomes the `--mock` backend |
| `D:\Projects\XrayEditor\src\components\` | `editor/` (TestEditor, StepCard, FieldBlocks, TableBlock, Lightbox), `shell/`, `claude/` (ClaudeDock, ConnectClaude), `ui/` (the whole vocabulary) |
| `D:\Projects\XrayEditor\src\styles\`, `design\proposal-2026\` | the light refresh look, tokens, `xe-*` classes |
| `D:\Projects\XrayEditor\tests\unit\`, `tests\e2e\` | tests that come along with the modules they cover |
| `D:\Projects\XrayEditor\scripts\live-check.ts` | the read-only live check pattern |
| `D:\Projects\Transkell\` | the original template Xray Editor started from (vite, tsconfig, playwright config) |

## Jira / Xray tooling

| Where | What |
|---|---|
| `~/.atlassian/credentials.json`, `~/.atlassian/xray_credentials.json` | credentials, read in place, never copied |
| `C:\Users\s.genin\.claude\skills\xray-find\scripts\` | `jira_search.py`, `jira_get.py`, `jira_meta.py`, `xray_test_steps.py` — read-only probes of a live project; `_lib.py` for auth; `setup_xray_api_key.py` |
| `C:\Users\s.genin\.claude\skills\atlassian-import\scripts\setup_credentials.py` | Jira token setup / rotation |
| `C:\Users\s.genin\.claude\skills\xray-link\` | issue links (a test covering a story or bug) |
| `D:\SVN\B040L00192_Australia_BHP_TCC_Sources\.xray\` | BHP's test-authoring knowledge base: `test-authoring-guide.md` (how a house-style test reads), `release-process.md`, `analysis/images.md` (screenshot typologies), `scripts/xray_create_tests.py` and `xray_upload_step_images.py` (create tests and embed step images through the API), `scripts/xray_folder_tests.py` (Test Repository folders by GraphQL) |

## Documents and conversion

| Where | What |
|---|---|
| `C:\Users\s.genin\Transurb\2_SIM - Documents\02_Projects\L.00320 - France - RATP - SOSIE\01 - Manage\01 - Client\14 - Livraisons documentaires\J5\D401-1 Specifications Fonctionnelles - J5\` | the RATP specs the team starts with (copy, never open in place): `Traction\SOSIE_211_D401-1_3_01.01`, `Signalisation\SOSIE_211_D401-1_4_01_01_TC`, `Itinéraires\SOSIE_211_D401-1_5_01_02_TC`, `Modèle train\SOSIE_211_D401-1_2_01.02`, `Instructeur\SOSIE_6_D401-1_01.00`, `PCC NG\SOSIE_4113_D401-1_01.00`, `Console d'Aide au Départ\SOSIE_4114_D401-1_01.01` (`.docx`, some also `.pdf`; `Archives\` holds old versions) |
| `C:\Users\s.genin\Downloads\Matrice_RATP_analyse_SIM_TCO_v3_20261022.xlsx` | the RATP requirements matrix (sheet `Matrice`: 3 717 rows, `ID Exigence`, `Texte exigence`, target document and chapter, test columns) — source for `requirements/requirements.csv` |
| `tests/fixtures/csv/` | a CSV the team produces today with NotebookLM / SurfSense (copied from `Downloads`) |
| `D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\scripts\inline-figures.py` | puts the docx images back where they belong after a text-only conversion; handles `Target`-before-`Id` relations and VML images |
| `npx -y @firecrawl/anydoc <file.docx> -o <out.md>` | text + tables of a docx, local, no key (used with `inline-figures.py`) |
| `D:\SVN\B040L00192_Australia_BHP_TCC_Sources\.xray\scripts\pdf_catalog.py` | indexes every `Figure N-M` / `Table N-M` of a PDF with page and caption, renders them — a model for figure extraction from PDFs |
| `D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\documentation\` | client documents already converted to Markdown for the Sosie code (`README.md` says which document wins); useful to compare a conversion, not a Testimus input |

## Local models and runtimes (dev PC, for SPEC-RAG.md)

| Where | What |
|---|---|
| `D:\transformers-models\` | ONNX models in the transformers.js layout `<org>/<name>/`: `Xenova/bge-m3`, `onnx-community/Qwen3-Embedding-0.6B-ONNX`, `onnx-community/bge-reranker-v2-m3-ONNX` (each q8 + fp16), `n24q02m/Qwen3-Reranker-0.6B-ONNX` (q8 + yes/no head); GGUF rerankers for llama.cpp: `ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF`, `Voodisss/Qwen3-Reranker-4B-GGUF-llama_cpp`, `Voodisss/Qwen3-Reranker-8B-GGUF-llama_cpp` (Q8_0). SHA-256 checked against Hugging Face on 2026-11-02 |
| `D:\transformers-models\Qwen\` | official Qwen GGUF embeddings for llama.cpp (Apache-2.0): `Qwen3-Embedding-0.6B-GGUF` (Q8_0), `Qwen3-Embedding-4B-GGUF` (Q4_K_M, Q8_0), `Qwen3-Embedding-8B-GGUF` (Q4_K_M, Q8_0) — byte-identical to Ollama's `qwen3-embedding` tags, SHA-256 checked |
| (Ollama) | **uninstalled on 2026-11-02** after the tests of SPEC-RAG §16: not on this PC, not to be installed or used for Testimus here. Its models are duplicates of the Qwen GGUF files above. |
| `D:\llama.cpp\b12032-cuda13\` | official ggml-org build b12032, CUDA 13.4 + cudart (works on the RTX 5080 with driver 591.44 / CUDA 13.1); `llama-server.exe --reranking --pooling rank`. `b12032-vulkan\` is the fallback build |

## Execution side (later phases)

| Where | What |
|---|---|
| `D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\skills\testing\` | interactive test sheet (HTML + `data.json`, OK / NOK / – per line) |
| `D:\SVN\B040L00320_Ratp_Sosie_Sources\.claude\skills\testr4\`, `R4\README.md` | running a test in the real Sosie simulator through R4, with captures as proof — a source of step screenshots |
