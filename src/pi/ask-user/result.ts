import type {
	AskAnswer,
	AskToolResult,
	QuestionnaireStatus,
	QuestionResult,
} from "./types";

export function formatAnswerForModel(answer: AskAnswer): string {
	switch (answer.kind) {
		case "text":
			return answer.label.length > 0 ? answer.label : "(empty response)";
		case "other":
			return `Other: ${answer.label}`;
		case "option":
			return answer.index !== undefined
				? `${answer.index}. ${answer.label}`
				: answer.label;
	}
}

function questionLine(result: QuestionResult): string {
	const head = result.header ? `[${result.header}] ` : "";
	if (result.status === "cancelled")
		return `${head}${result.question}\n  (cancelled)`;
	const first = result.answers[0];
	if (!first) return `${head}${result.question}\n  (no answer)`;
	if (result.mode === "multi-select") {
		const lines = result.answers
			.map((answer) => `  - ${formatAnswerForModel(answer)}`)
			.join("\n");
		return `${head}${result.question}\n${lines}`;
	}
	return `${head}${result.question}\n  ${formatAnswerForModel(first)}`;
}

export function buildToolResult(
	status: QuestionnaireStatus,
	questions: QuestionResult[],
	message?: string,
): AskToolResult {
	let text: string;
	if (status === "unavailable" || status === "invalid") {
		text = message ?? "ask_user_question could not run.";
	} else if (
		status === "cancelled" &&
		questions.every((question) => question.status === "cancelled")
	) {
		text = message ?? "User cancelled the question.";
	} else {
		text = questions.map(questionLine).join("\n\n");
	}
	return {
		content: [{ type: "text", text }],
		details: {
			status,
			questions,
			...(message ? { message } : {}),
		},
	};
}
