#!/bin/sh
# Opens this test run in the browser, served on 127.0.0.1 by serve.mjs (results are written into this folder).
# Without Node the page opens on its own and keeps the results in the browser (use « Save run.json »).
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  exec node serve.mjs "$@"
fi
echo "Node was not found: the page opens on its own and keeps the results in this browser."
echo "When you are done, press « Save run.json » and put the file back in this folder."
if command -v open >/dev/null 2>&1; then open index.html; else xdg-open index.html; fi
