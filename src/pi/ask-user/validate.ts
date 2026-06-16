import type { AskOption, NormalizedQuestion } from "./types";

export const MAX_QUESTIONS = 4;
/** When a question provides options at all, it needs at least this many. */
export const MIN_OPTIONS = 2;

/** Labels the UI reserves for the auto-appended custom-answer / submit rows. */
export const RESERVED_LABELS: ReadonlySet<string> = new Set([
	"other",
	"type something",
	"type something.",
	"chat about this",
	"submit",
]);

export interface ValidationFailure {
	ok: false;
	error: string;
	message: string;
}
export type ValidationResult = { ok: true } | ValidationFailure;

interface RawOption {
	label?: unknown;
	value?: unknown;
	description?: unknown;
	preview?: unknown;
}
interface RawQuestion {
	question?: unknown;
	header?: unknown;
	details?: unknown;
	options?: unknown;
	multiSelect?: unknown;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function normalizeOption(raw: RawOption): AskOption | null {
	const label = asString(raw.label)?.trim();
	if (!label) return null;
	const value = asString(raw.value)?.trim() || label;
	const description = asString(raw.description)?.trim();
	const preview = asString(raw.preview);
	return {
		label,
		value,
		...(description ? { description } : {}),
		...(preview && preview.trim().length > 0 ? { preview } : {}),
	};
}

export function normalizeOptions(raw: unknown): AskOption[] {
	if (!Array.isArray(raw)) return [];
	const out: AskOption[] = [];
	for (const item of raw) {
		if (item && typeof item === "object") {
			const option = normalizeOption(item as RawOption);
			if (option) out.push(option);
		}
	}
	return out;
}

function normalizeQuestion(raw: RawQuestion): NormalizedQuestion | null {
	const question = asString(raw.question)?.trim();
	if (!question) return null;
	const header = asString(raw.header)?.trim();
	const details = asString(raw.details)?.trim();
	const options = normalizeOptions(raw.options);
	const multiSelect = raw.multiSelect === true;
	const mode: AskMode = options.length === 0 ? "text" : multiSelect ? "multi-select" : "single-select";
	return {
		question,
		...(header ? { header } : {}),
		...(details ? { details } : {}),
		options,
		multiSelect,
		mode,
	};
}

type AskMode = NormalizedQuestion["mode"];

/**
 * Accept the canonical `{ questions: [...] }` shape, and tolerate a legacy
 * single-question `{ question, options, ... }` payload by wrapping it.
 */
export function normalizeParams(raw: unknown): NormalizedQuestion[] {
	const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	let rawQuestions: unknown[] = [];
	if (Array.isArray(obj["questions"])) {
		rawQuestions = obj["questions"];
	} else if (typeof obj["question"] === "string") {
		rawQuestions = [obj];
	}
	const out: NormalizedQuestion[] = [];
	for (const candidate of rawQuestions) {
		if (candidate && typeof candidate === "object") {
			const question = normalizeQuestion(candidate as RawQuestion);
			if (question) out.push(question);
		}
	}
	return out;
}

export function validateQuestionnaire(questions: NormalizedQuestion[]): ValidationResult {
	if (questions.length === 0) {
		return {
			ok: false,
			error: "no_questions",
			message: "ask_user_question needs at least one question with a non-empty 'question' string.",
		};
	}
	if (questions.length > MAX_QUESTIONS) {
		return {
			ok: false,
			error: "too_many_questions",
			message: `ask_user_question accepts at most ${MAX_QUESTIONS} questions per call (received ${questions.length}). Split them across multiple calls.`,
		};
	}

	const seenQuestions = new Set<string>();
	for (const question of questions) {
		const questionKey = question.question.toLowerCase();
		if (seenQuestions.has(questionKey)) {
			return {
				ok: false,
				error: "duplicate_question",
				message: `Duplicate question: "${question.question}". Each question must be unique.`,
			};
		}
		seenQuestions.add(questionKey);

		if (question.options.length === 1) {
			return {
				ok: false,
				error: "empty_options",
				message: `Question "${question.question}" has only one option. Provide at least ${MIN_OPTIONS} options, or none for a free-text answer.`,
			};
		}

		const seenLabels = new Set<string>();
		for (const option of question.options) {
			const labelKey = option.label.toLowerCase();
			if (RESERVED_LABELS.has(labelKey)) {
				return {
					ok: false,
					error: "reserved_label",
					message: `Option label "${option.label}" is reserved — a custom-answer/submit row is added automatically. Use a different label.`,
				};
			}
			if (seenLabels.has(labelKey)) {
				return {
					ok: false,
					error: "duplicate_option_label",
					message: `Question "${question.question}" has a duplicate option label "${option.label}". Labels must be unique within a question.`,
				};
			}
			seenLabels.add(labelKey);
		}
	}

	return { ok: true };
}
