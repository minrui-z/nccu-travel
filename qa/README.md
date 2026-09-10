# Reproducible XLS preservation QA

These scripts have no machine-specific paths. They read the checked-in static assets and write test results to a separate output directory. No Java is required for the daily checks. The unchanged original layouts (`general-6.xls` / `student-7.xls`) remain the original blank baselines. The release contains 25 native XLS templates: 24 regular variants covering 1–12 columns in both forms, plus `student-7-private.xls`.

## Daily Node checks

From the website repository root, with `cfb` and `tsx` installed:

```sh
npx tsx qa/verify-xls.ts --templates public/templates --engine lib/xls/xls-exporter.ts --output qa-output
```

All paths are optional and default to those shown. The engine is dynamically loaded from `--engine`; this script does not include a second implementation of the exporter.

It validates every manifest SHA-256; original fonts, XF records, row/column geometry, print/name/settings records, drawings and drawing continuations; cell styles outside the dynamic date region; unchanged auxiliary OLE streams; and unchanged input buffers. After filling a variant, every BIFF record outside the explicitly permitted cell, SST and offset-index records must remain identical. Rich Unicode and 84 long strings per form exercise several SST CONTINUE records. Invalid cells, malformed Unicode, control characters, excessive length, nonfinite numbers and invalid rich-text fonts must reject.

Outputs: 24 populated variants + 2 rich-text cases + 2 SST stress cases, with all expected values in `qa-output/xls-report.json`. This test exports intentionally synthetic data; it does not assert financial-rule correctness or text fit for arbitrary user input.

The supplemental template is covered separately by `tests/student-private-template.test.ts` and `tests/private-export.test.ts`. Only a seven-column student claim containing private dates selects it: C14:M14 is partitioned along the existing date columns so shared work text cannot appear under a private date. The tests preserve the original baseline, verify deterministic regeneration and unchanged records outside that work row, and check that every private cell below the date is a native BIFF `BLANK`, with no stale text or zero values.

Regenerate this supplemental asset after preparing the regular variants and manifests:

```sh
node --import tsx scripts/build-student-private-template.ts
```

`npm run build` followed by `npm run test:build` executes the emitted browser Worker without Node globals across 32 export scenarios: all 24 regular layouts, both sample claims, both route cases, both text-fitting cases and both private-date cases. The student private-date case exercises the supplemental seventh-column layout.

## Independent xlrd reader

Install isolated Python dependencies:

```sh
python3 -m venv .venv-qa
.venv-qa/bin/python -m pip install -r qa/requirements.txt
.venv-qa/bin/python qa/verify-reopen.py --output qa-output
```

On Codex macOS, first load workspace dependencies and use the bundled Python. The reader does not import the exporter. It checks every requested value, numeric cell type and rich-text run in all 28 output files. Result: `qa-output/reopen-report.json`.

## Optional print QA

Pass an explicitly approved headless LibreOffice renderer:

```sh
.venv-qa/bin/python qa/verify-print.py --output qa-output --soffice /path/to/approved/soffice --font-dir /path/to/fonts
```

`--font-dir` is repeatable. Omit it to use the renderer's default font configuration. On Codex macOS, always choose the workspace dependency `bin/override/soffice`; do not use system/Homebrew LibreOffice. The script prepends the chosen binary's directory to PATH, creates a unique temporary profile, clears only its own stale output PDFs, and renders all 24 populated regular variants in one process with one font configuration. Also reopen and render the supplemental student template and a mixed private/claimable seven-column output in that same font environment; confirm blank private columns and one A4 portrait page.

Every general variant must produce 2 A4 portrait pages, with the original attachment identified on page 2. Every student variant must produce 1 A4 portrait page. Results and PDFs are written beneath the chosen output directory. This does not open an Office window.

Print checks establish page count, paper geometry and attachment placement. They do not prove pixel identity across fonts or Excel versions. A UI capacity validator and actual browser-download smoke test remain separate checks. The long-string stress files are intentionally not rendered.

## Publishing and CI

Commit this `qa/` directory and optionally its Markdown validation report. Keep generated XLS/PDF files and Python environments out of the repository, for example:

```gitignore
qa-output/
.venv-qa/
```

A Node CI job needs only dependency installation and the first command. The independent reader and renderer can run as optional additional jobs. Never publish a report claiming checks passed without rerunning the scripts against the assets and engine being released.

## Selection-state and public-data checks

Unit tests also cover merged private columns, clearing old values when returning to a claimable status, transit/meal state transitions, and seasonal allowance lookup without silently splitting dates or copying an unavailable quote. FX selections must discard quotes and evidence that no longer apply after a currency, source or reference-date change; changing trip dates invalidates the prior insurance-cap confirmation.

The release FX data spans 414 quotation dates from 2025-01-02 through 2026-09-08 and 19 currencies. Missing quotation dates remain missing; reference-data tests must not treat a stale date as a match. This coverage is separate from the 32 native Worker export scenarios.

## Editable text fitting

Generate fitting fixtures with `node --import tsx qa/verify-text-fitting.ts qa-output/text-fitting`, then run `python3 qa/verify-text-fitting.py qa-output/text-fitting` using the isolated xlrd environment above. On Codex macOS use the loaded bundled Python. The reader checks text, XF/font assignments, wrapping, and rich-text runs. Optionally render `general-full-fit.xls` and `student-full-fit.xls` to PDF in that directory with the approved renderer and fonts; the reader then also checks A4 pages and complete purpose/work/note text. Original FONT/XF records remain unchanged; only copies assigned to editable cells carry fitting changes.
