import { optionalService } from "./host.js";
export function userQuestionsOf(ctx) {
    return optionalService(ctx, "userQuestions");
}
export async function confirmAction(questions, invocation, title, detail, confirmLabel = "Confirm") {
    if (!questions) {
        return true;
    }
    const answer = await questions.ask({
        questions: [
            {
                id: "confirm",
                question: title,
                detail,
                options: [{ label: confirmLabel }, { label: "Cancel" }],
            },
        ],
        agent: invocation.agent,
        signal: invocation.signal,
    });
    return answer.answers.some((item) => item.id === "confirm" && item.selected.includes(confirmLabel));
}
export async function pickOne(questions, invocation, title, options) {
    const answer = await questions.ask({
        questions: [
            {
                id: "pick",
                question: title,
                options,
            },
        ],
        agent: invocation.agent,
        signal: invocation.signal,
    });
    return answer.answers.find((item) => item.id === "pick")?.selected[0];
}
