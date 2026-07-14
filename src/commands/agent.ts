export async function agentListAction(_opts: Record<string, never>): Promise<void> {
  throw new Error("not implemented");
}
export async function agentInfoAction(_id: string): Promise<void> {
  throw new Error("not implemented");
}
export async function agentInstallAction(
  _id: string, _opts: { version?: string; runtime?: string },
): Promise<void> {
  throw new Error("not implemented");
}
export async function agentUpdateAction(
  _id: string | undefined, _opts: Record<string, never>,
): Promise<void> {
  throw new Error("not implemented");
}
export async function agentGuideAction(_id: string, _opts: { md?: boolean }): Promise<void> {
  throw new Error("not implemented");
}
