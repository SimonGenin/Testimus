import { join } from "node:path";
import { UserError } from "../../command.ts";
import { env } from "../../env.ts";
import type { ProjectInfo, XrayJson } from "../../types.ts";
import { storeXray } from "../columns.ts";
import { getProjectInfo, getStepFields } from "../jira/read.ts";
import { readJson, readProject, readXray, writeJson, writeProject } from "../project.ts";

// ponytail: the one gate before Jira — a project with no key, or disconnected by the user, never reaches it
export function jiraKey(project: string): string {
  const p = readProject(project);
  if (p.jiraOffline)
    throw new UserError(
      `Jira is disconnected for this project — ${p.jiraProject} is neither read nor written.`,
      "Reconnect it from the Jira tab, or: testimus xray connect",
      "jira-disconnected",
    );
  if (!p.jiraProject)
    throw new UserError(
      "This project is not connected to a Jira project.",
      "Connect one from the Jira tab, or: testimus xray connect LFRPS12",
      "jira-not-connected",
    );
  return p.jiraProject;
}

const infoFile = (project: string) => join(project, ".testimus", "jira-project.json");

// ponytail: Jira's own project id and test issue type, asked once per project and kept as a derived file
export async function projectInfo(project: string): Promise<ProjectInfo> {
  const key = jiraKey(project);
  const cached = readJson<ProjectInfo | null>(infoFile(project), null);
  if (cached?.key === key && cached.id) return cached;
  const info = await getProjectInfo(key);
  writeJson(infoFile(project), info);
  return info;
}

// ponytail: the key is checked in Jira before it is saved — a typo or a project without Xray never becomes
// the project's key
export async function connectJira(project: string, key: string): Promise<ProjectInfo> {
  const info = await getProjectInfo(key);
  writeJson(infoFile(project), info);
  const { jiraOffline: _, ...cur } = readProject(project);
  writeProject(project, { ...cur, jiraProject: info.key, name: cur.name || info.key });
  return info;
}

export function disconnectJira(project: string): void {
  writeProject(project, { ...readProject(project), jiraOffline: true });
}

export async function refreshFields(project: string): Promise<XrayJson> {
  const fields = await getStepFields((await projectInfo(project)).id);
  return storeXray(project, fields, env.now().toISOString());
}

// ponytail: the step columns are read again from Xray before each push (Xray Editor reads them on every project
// open and push) and kept in xray.json, the team's columns following them; offline, the copy already there is used
export async function freshXray(project: string): Promise<XrayJson> {
  try {
    return await refreshFields(project);
  } catch {
    return readXray(project);
  }
}
