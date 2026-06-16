import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildToolResult } from "./result";
import type { AskAnswer, AskToolResult, NormalizedQuestion, QuestionResult } from "./types";
import { withUILock } from "./ui/shared";
import { askMultiChoice } from "./ui/multi-select";
import { askSingleChoice } from "./ui/single-select";
import { normalizeParams, validateQuestionnaire } from "./validate";

async function askText(ctx: ExtensionContext, question: NormalizedQuestion): Promise<AskAnswer | null> {
	const title = question.details ? `${question.question}\n\n${question.details}` : question.question;
	const answer = await ctx.ui.editor(title);
	if (answer === undefined) return null;
	const trimmed = answer.trim();
	return { kind: "text", label: trimmed, value: trimmed };
}

function toResult(question: NormalizedQuestion, answers: AskAnswer[] | null): QuestionResult {
	return {
		question: question.question,
		...(question.header ? { header: question.header } : {}),
		mode: question.mode,
		status: answers ? "answered" : "cancelled",
		answers: answers ?? [],
	};
}

/**
 * Render the ask_user_question dialog(s) and return a tool result. Shared by the
 * pi-ask-user extension (registry path) and pi-cursor-auth (MCP-bridge path).
 */
export async function runAskUser(ctx: ExtensionContext, raw: unknown, signal?: AbortSignal): Promise<AskToolResult> {
	const questions = normalizeParams(raw);
	const validation = validateQuestionnaire(questions);
	if (!validation.ok) return buildToolResult("invalid", [], validation.message);
	if (signal?.aborted) return buildToolResult("cancelled", [], "User cancelled the question.");
	if (!ctx.hasUI) return buildToolResult("unavailable", [], "ask_user_question requires interactive mode UI.");

	return withUILock(async () => {
		const results: QuestionResult[] = [];
		let cancelled = false;

		for (const question of questions) {
			if (signal?.aborted) {
				cancelled = true;
				break;
			}

			let answers: AskAnswer[] | null;
			if (question.mode === "text") {
				const answer = await askText(ctx, question);
				answers = answer ? [answer] : null;
			} else if (question.mode === "single-select") {
				const answer = await askSingleChoice(ctx, question);
				answers = answer ? [answer] : null;
			} else {
				answers = await askMultiChoice(ctx, question);
			}

			results.push(toResult(question, answers));
			if (!answers) {
				cancelled = true;
				break;
			}
		}

		return buildToolResult(cancelled ? "cancelled" : "answered", results);
	});
}
