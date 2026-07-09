import {
	getSelectListTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type EditorTheme,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { AskOption } from "../types";

export function createEditorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (text: string) => theme.fg("accent", text),
		selectList: getSelectListTheme(),
	};
}

/** Wrap `text` to `width`, indenting continuation lines, pushing onto `lines`. */
export function addWrapped(
	lines: string[],
	text: string,
	width: number,
	indent = "",
): void {
	const contentWidth = Math.max(1, width - indent.length);
	for (const line of wrapTextWithAnsi(text, contentWidth)) {
		lines.push(truncateToWidth(`${indent}${line}`, width));
	}
}

/** Header chip + question, e.g. "[Auth method] How should we authenticate?". */
export function renderQuestionHeading(
	lines: string[],
	question: string,
	header: string | undefined,
	details: string | undefined,
	width: number,
	theme: Theme,
): void {
	const chip = header ? `${theme.fg("accent", `[${header}]`)} ` : "";
	addWrapped(lines, ` ${chip}${theme.fg("text", question)}`, width);
	if (details) {
		lines.push("");
		addWrapped(lines, theme.fg("muted", ` ${details}`), width, " ");
	}
}

/** Render the focused option's preview as a markdown-ish monospace box below the list. */
export function renderPreview(
	lines: string[],
	option: AskOption | undefined,
	width: number,
	theme: Theme,
): void {
	if (!option?.preview) return;
	lines.push(theme.fg("borderMuted", "─".repeat(width)));
	lines.push(theme.fg("dim", ` Preview — ${option.label}`));
	const previewLines = option.preview.replace(/\t/g, "  ").split("\n");
	for (const previewLine of previewLines) {
		if (previewLine.length === 0) {
			lines.push("");
			continue;
		}
		for (const wrapped of wrapTextWithAnsi(
			previewLine,
			Math.max(1, width - 2),
		)) {
			lines.push(
				truncateToWidth(` ${theme.fg("mdCodeBlock", wrapped)}`, width),
			);
		}
	}
}

// Serialize concurrent UI interactions — the overlay/editor host handles one at a time.
let uiLock: Promise<void> = Promise.resolve();

export function withUILock<T>(fn: () => Promise<T>): Promise<T> {
	const previous = uiLock;
	let release: () => void = () => {};
	uiLock = new Promise<void>((resolve) => {
		release = resolve;
	});
	return previous.then(fn).finally(() => release());
}
