import { randomUUID } from "node:crypto";
import { SESSION_NIX_COMMAND } from "../constants.js";
import { confirmAction, pickOne, userQuestionsOf } from "./ask.js";
import { deleteDshSession, DshDeleteError } from "./delete-session.js";
import { optionalService } from "./host.js";
import { commandResult, currentAgentPreset, currentCwd, currentSessionId, } from "./invocation.js";
import { dshNixUsage, parseDshNixArgs } from "./nix-parse.js";
async function quitHost(ctx, hooks) {
    const exitProcess = hooks.exitProcess ?? ((code) => {
        process.exit(code);
    });
    const host = ctx;
    const disposeRoot = hooks.disposeRoot
        ?? (typeof host.root?.fiber?.dispose === "function"
            ? async () => {
                await host.root.fiber.dispose();
            }
            : undefined);
    if (!disposeRoot) {
        exitProcess(0);
        return;
    }
    const timer = setTimeout(() => exitProcess(0), 5_000);
    timer.unref?.();
    try {
        await disposeRoot();
    }
    finally {
        clearTimeout(timer);
        exitProcess(0);
    }
}
function resumeHint(sessionId) {
    return `dsh --profile pi-tui --resume ${sessionId}`;
}
async function createFreshSession(ctx, options) {
    const agents = optionalService(ctx, "agents");
    const sessionId = randomUUID();
    const meta = {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.parentSession ? { parentSession: options.parentSession } : {}),
        ...(options.agentPreset ? { agentPreset: options.agentPreset } : {}),
    };
    if (agents && typeof agents.create === "function") {
        const presets = optionalService(ctx, "agentPresets");
        let setup;
        if (presets && options.agentPreset && typeof presets.mount === "function") {
            const presetId = options.agentPreset;
            setup = async (agentCtx) => {
                await presets.mount?.(agentCtx, presetId);
            };
        }
        const created = await agents.create({
            sessionId,
            ...(Object.keys(meta).length > 0 ? { meta } : {}),
            ...(setup ? { setup } : {}),
        });
        const createdId = created.agent?.session?.id;
        return typeof createdId === "string" && createdId.length > 0 ? createdId : sessionId;
    }
    const sessions = optionalService(ctx, "sessions");
    if (!sessions || typeof sessions.create !== "function") {
        throw new Error("Neither ctx.agents.create nor ctx.sessions.create is available.");
    }
    const created = sessions.create(sessionId, Object.keys(meta).length > 0 ? { meta } : undefined);
    return typeof created.id === "string" && created.id.length > 0 ? String(created.id) : sessionId;
}
async function deleteCurrentSession(ctx, sessionId) {
    if (!sessionId) {
        return undefined;
    }
    try {
        await deleteDshSession(ctx, sessionId);
        return undefined;
    }
    catch (error) {
        if (error instanceof DshDeleteError && error.status === 404) {
            return undefined;
        }
        const message = error instanceof DshDeleteError ? error.message : String(error);
        return message;
    }
}
async function resolvePreset(ctx, invocation, requested) {
    const presets = optionalService(ctx, "agentPresets");
    if (!presets || typeof presets.list !== "function") {
        if (requested) {
            return { id: requested };
        }
        return { error: "No agentPresets service is mounted; pass /nix agent <preset-id> explicitly." };
    }
    const roster = (await presets.list()).filter((preset) => !preset.broken);
    if (requested) {
        const match = roster.find((preset) => preset.id === requested
            || preset.name === requested
            || preset.id.toLowerCase() === requested.toLowerCase()
            || (preset.name ?? "").toLowerCase() === requested.toLowerCase());
        if (!match) {
            return { error: `Unknown agent preset: ${requested}` };
        }
        return { id: match.id };
    }
    const questions = userQuestionsOf(ctx);
    if (!questions) {
        const ids = roster.map((preset) => preset.id).join(", ");
        return {
            error: `Pick a preset explicitly: /${SESSION_NIX_COMMAND} agent <preset-id>${ids ? `\nAvailable: ${ids}` : ""}`,
        };
    }
    if (roster.length === 0) {
        return { error: "No agent presets are available." };
    }
    const selected = await pickOne(questions, invocation, "Start a new session with which agent preset?", roster.map((preset) => ({
        label: preset.name ?? preset.id,
        description: preset.description ?? preset.id,
    })));
    if (!selected) {
        return "cancelled";
    }
    const match = roster.find((preset) => (preset.name ?? preset.id) === selected || preset.id === selected);
    return match ? { id: match.id } : { error: `Unknown agent preset: ${selected}` };
}
export async function handleDshNixCommand(ctx, invocation, hooks = {}) {
    const parsed = parseDshNixArgs(invocation.rawInput);
    if (parsed.kind === "help") {
        return commandResult("success", dshNixUsage());
    }
    if (parsed.kind === "error") {
        return commandResult("error", `${parsed.error}\n${dshNixUsage()}`);
    }
    const oldId = currentSessionId(invocation);
    const cwd = currentCwd(invocation);
    const questions = userQuestionsOf(ctx);
    try {
        if (parsed.kind === "quit") {
            const confirmed = await confirmAction(questions, invocation, "Delete the current session?", oldId
                ? `This removes ${oldId} through the host cleanup chain, then exits DSH.`
                : "There is no current session id to delete. DSH will still exit.", "Delete and quit");
            if (!confirmed) {
                return commandResult("success", `/${SESSION_NIX_COMMAND} quit cancelled.`);
            }
            const deleteError = await deleteCurrentSession(ctx, oldId);
            if (deleteError) {
                return commandResult("error", `Deleted nothing.\n${deleteError}`);
            }
            const summary = oldId ? `Deleted ${oldId}. Exiting.` : "No current session to delete. Exiting.";
            await quitHost(ctx, hooks);
            return commandResult("success", summary);
        }
        let agentPreset = currentAgentPreset(invocation);
        if (parsed.kind === "agent") {
            const resolved = await resolvePreset(ctx, invocation, parsed.targetAgentName);
            if (resolved === "cancelled") {
                return commandResult("success", `/${SESSION_NIX_COMMAND} agent cancelled.`);
            }
            if ("error" in resolved) {
                return commandResult("error", resolved.error);
            }
            agentPreset = resolved.id;
        }
        const title = parsed.kind === "agent"
            ? `Start a new '${agentPreset}' session and delete the current one?`
            : "Start a new session and delete the current one?";
        const detail = [
            oldId ? `Current session: ${oldId}` : "No current session id is available to delete.",
            cwd ? `cwd: ${cwd}` : undefined,
            agentPreset ? `preset: ${agentPreset}` : undefined,
            "A new DSH session is created first. The host keeps showing this conversation until you resume the new id.",
        ].filter(Boolean).join("\n");
        const confirmed = await confirmAction(questions, invocation, title, detail, "Start");
        if (!confirmed) {
            return commandResult("success", `/${SESSION_NIX_COMMAND} cancelled.`);
        }
        const createdId = await createFreshSession(ctx, {
            ...(cwd ? { cwd } : {}),
            ...(oldId ? { parentSession: oldId } : {}),
            ...(agentPreset ? { agentPreset } : {}),
        });
        const deleteError = await deleteCurrentSession(ctx, oldId);
        const lines = [
            `New session ${createdId}.`,
            `Resume it with: ${resumeHint(createdId)}`,
            "The current view stays on the old session until the host switches.",
        ];
        if (deleteError) {
            lines.push(`The previous session could not be deleted: ${deleteError}`);
        }
        else if (oldId) {
            lines.push(`Deleted previous session ${oldId}.`);
        }
        return commandResult("success", lines.join("\n"));
    }
    catch (error) {
        return commandResult("error", error instanceof Error ? error.message : String(error));
    }
}
