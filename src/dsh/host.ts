export interface DshHostContext {
  get(name: string): unknown;
}

export function optionalService<T>(ctx: DshHostContext, name: string): T | undefined {
  if (typeof ctx.get !== "function") {
    return undefined;
  }
  return ctx.get(name) as T | undefined;
}
