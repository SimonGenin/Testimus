// ponytail: opening \\host\share (or //host, \\?\UNC\…, \\.\…) makes Windows sign in to that host with the user's
// NTLM hash, so a path the app is handed from outside is never one of these, whoever sends it
export function uncPath(p: string): boolean {
  return /^\s*[\\/]{2}/.test(p);
}
