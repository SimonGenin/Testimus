---
name: xray-cloud-api
description: Facts about the Jira Cloud REST and Xray Cloud GraphQL APIs that Testimus relies on (auth, test and step queries, step mutations, custom step fields, attachments embedded in steps, rate limits), and how to check one read-only against a live project. Use when writing or debugging anything under src/core/lib/jira.ts or sync.ts, when a command reads or writes Xray, or when a fact about Xray is in doubt.
---

# Xray Cloud API for Testimus

The working reference implementation is `D:\Projects\XrayEditor\src\lib\jira.ts` (read it before
writing a query: shapes, paging and error messages there are proven against BHPTCC). This skill
lists what Testimus uses and what is still unverified.

## Hard rule

**No write against a production project during development** (`LFRPS12`, `BHPTCC`, any project a
team works in). Prove a write with a unit test over a fake `http` that asserts the exact request.
Live calls are read-only; a write against a sandbox project needs the user's go-ahead in chat.

## Auth

- Jira REST v3: basic auth `email:token` from `~/.atlassian/credentials.json`,
  base `https://transurb.atlassian.net`.
- Xray: `POST https://xray.cloud.getxray.app/api/v2/authenticate` with
  `{ client_id, client_secret }` from `~/.atlassian/xray_credentials.json` → a JWT (string body),
  then `POST /api/v2/graphql` with `Authorization: Bearer <jwt>`. Cache the JWT per process.
- 401 messages name the file to fix (Xray Editor's wording).

## Reads (proven in Xray Editor)

- `GET /rest/api/3/project/{key}` → project id, issue types (`Xray Test`, else `Test`).
- GraphQL `getTests(jql, projectId, folder, limit ≤ 100, start)` → `results { issueId jira(fields:[…])
  steps { id action data result attachments { id filename downloadLink } } preconditions … }`.
- `getFolder` / folder tree, `getPreconditions` (paged by 100).
- `GET /rest/api/3/issue/{key}?fields=summary,labels,status,description,issuelinks` — description is
  ADF; `Cloners` outward link = cloned from; `Test` outward link = covers.
- JQL cannot see Xray folders; folders come from GraphQL only.

## Writes (proven by unit tests in Xray Editor, not run live)

`createTest(jira:{fields}, testType:{name:"Manual"}, steps:[CreateStepInput], folderPath,
preconditionIssueIds)`, `addTestStep`, `updateTestStep(stepId, step: UpdateStepInput)`,
`removeTestStep`, `removeAllTestSteps`, `updateTestFolder`, `addPreconditionsToTest`,
`removePreconditionsFromTest`; Jira `PUT /rest/api/3/issue/{key}` for summary/labels/description,
`POST /rest/api/3/issueLink` for covers.

## Screenshots in steps

An attachment shows in Jira only when the step text embeds it:
`!xray-attachment://<attachmentId>|width=W,height=H!`. Upload first (`updateTestStep` with
`attachments.add`), re-read the step for the new ids, then write the markers — two operations
(Xray Editor `planPush`: "Embed N images in step k"). Locally the marker is
`![](images/<file> "width=W,height=H")`.

## Custom step fields (verified read-only 2026-11-02 on LFRPS12-327, schema by introspection)

- Field definitions: `getProjectSettings(projectIdOrKey: "<project id>") { testStepSettings { fields {
  id name type required disabled values } } }`. Built-ins come back as `action`, `data`, `result`;
  LFRPS12 adds one `text-single` custom field (`id: "69d5fcb02f2b49abf7fb76e6"`).
- Read: `Step.customFields { id name value }` — `value` is a JSON scalar; a `text-single` value is a
  plain string. `data` may be `null`.
- Write: `customFields: [{ id, value }]` (`CustomStepFieldInput`) in `CreateStepInput` and
  `UpdateStepInput` (schema-checked; not yet run as a write).

## Limits

`429` with `Retry-After` (seconds or HTTP date): wait that long, then 5/10/20 s, three tries; cap 6
requests in flight (Xray Editor `jira.send`). Paging is `start`/`limit`, max 100.
