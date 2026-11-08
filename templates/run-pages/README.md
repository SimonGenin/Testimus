# A test run, as pages

This folder is a test run exported from Testimus. It works on any PC, without Testimus.

## Run the tests

- **Windows**: double-click `start.cmd`. **macOS / Linux**: run `sh start.sh`.
- The run opens in the browser on `http://127.0.0.1:<port>/`. Keep the window that opened beside it while you test:
  it is the small local server (`serve.mjs`) that writes each result into this folder, as you go.
- For each test: OK or NOK on each step (a note on what happened when NOK, a screenshot if useful), then the result
  of the test (Passed, Problem, Blocked with its reason, Not run), comments and questions. Your name goes in
  « Tester ».

Without Node on the PC, `start.cmd` opens `index.html` directly: the page keeps the results in the browser, and the
screenshots only in the page until it is saved. When you
are done, press **Save run.json** and put the downloaded `run.json` back in this folder (replace the old one).

## Bring the results back

Copy the whole folder back next to Testimus, then in Testimus: Run › the run › **Import results…**, and pick this
folder (or the saved `run.json`). Testimus shows what it will import first; when a test has a result in both places,
the newer one wins and the older one is kept in its history.

## What is here

- `index.html`, `run.js` — the run, one page and its script (no network but this PC).
- `run.json` — the tests as they were when the run was made.
- `results/<test>.json` — the result of each test; `results/<test>/` its screenshots.
- `images/<test>/` — the pictures of the tests' steps.
- `serve.mjs`, `start.cmd`, `start.sh` — the local server and how to start it. It listens on 127.0.0.1 only, serves
  only this folder and writes only the results of this run's tests.
