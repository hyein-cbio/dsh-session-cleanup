export function optionalService(ctx, name) {
    if (typeof ctx.get !== "function") {
        return undefined;
    }
    return ctx.get(name);
}
