// ponytail: where a run keeps its copy of a picture a step shows — images/<testId>/<the file's own name>, whatever
// folder of the test held it; runs.create writes it there, the Run screen reads it there (the exported page, which has
// no import, keeps the same rule in templates/run-pages/run.js)
export const runImage = (testId: string, file: string) => `images/${testId}/${file.split(/[\\/]/).pop() ?? file}`;
