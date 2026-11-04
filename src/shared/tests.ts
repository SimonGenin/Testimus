const TEST_IN_PATH = /(?:^|[\\/])tests[\\/]+([^\\/]+)[\\/]/;

// ponytail: the one reading of « this file belongs to test <id> » — tests/<id>/…, a local id or a Jira key; the core
// counts what a Claude run wrote with it, the activity view draws the same run
export function testInPath(path: string): string | undefined {
  return path.match(TEST_IN_PATH)?.[1];
}

export const FILE_WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
