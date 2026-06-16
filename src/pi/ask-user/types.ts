// Shared ask_user_question types. Kept in sync with the pi-ask-user extension
// (this is a self-contained copy so the cursor-agent provider can render the
// dialog itself — pi does not expose extension tools to providers for execution).

export interface AskOption {
	label: string;
	value: string;
	description?: string;
	preview?: string;
}

export type AskMode = "text" | "single-select" | "multi-select";

export interface NormalizedQuestion {
	question: string;
	header?: string;
	details?: string;
	options: AskOption[];
	multiSelect: boolean;
	mode: AskMode;
}

export type AskAnswerKind = "text" | "option" | "other";

export interface AskAnswer {
	kind: AskAnswerKind;
	label: string;
	value: string;
	/** 1-based position for option answers. */
	index?: number;
}

export type QuestionStatus = "answered" | "cancelled";

export interface QuestionResult {
	question: string;
	header?: string;
	mode: AskMode;
	status: QuestionStatus;
	answers: AskAnswer[];
}

export type QuestionnaireStatus = "answered" | "cancelled" | "unavailable" | "invalid";

export interface AskUserResultDetails {
	status: QuestionnaireStatus;
	questions: QuestionResult[];
	message?: string;
}

export interface AskToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: AskUserResultDetails;
}
