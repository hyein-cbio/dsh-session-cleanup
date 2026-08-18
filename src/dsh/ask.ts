import { optionalService, type DshHostContext } from "./host.js";
import type { DshCommandInvocation } from "./invocation.js";

interface AskOption {
  label: string;
  description?: string;
}

export interface UserQuestionsLike {
  ask(request: {
    questions: Array<{
      id: string;
      question: string;
      detail?: string;
      options?: AskOption[];
      multiSelect?: boolean;
    }>;
    agent?: unknown;
    signal?: AbortSignal;
  }): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>;
}

export function userQuestionsOf(ctx: DshHostContext): UserQuestionsLike | undefined {
  return optionalService<UserQuestionsLike>(ctx, "userQuestions");
}

export async function confirmAction(
  questions: UserQuestionsLike | undefined,
  invocation: DshCommandInvocation,
  title: string,
  detail: string,
  confirmLabel = "Confirm",
): Promise<boolean> {
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

export async function pickOne(
  questions: UserQuestionsLike,
  invocation: DshCommandInvocation,
  title: string,
  options: AskOption[],
): Promise<string | undefined> {
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
