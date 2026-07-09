import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	Key,
	matchesKey,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { AskAnswer, AskOption, NormalizedQuestion } from "../types";
import {
	addWrapped,
	createEditorTheme,
	renderPreview,
	renderQuestionHeading,
} from "./shared";

interface DisplayRow {
	kind: "option" | "other";
	label: string;
	value: string;
	description?: string;
	preview?: string;
	index?: number;
}

function buildRows(options: AskOption[]): DisplayRow[] {
	const rows: DisplayRow[] = options.map((option, i) => ({
		kind: "option",
		label: option.label,
		value: option.value,
		index: i + 1,
		...(option.description ? { description: option.description } : {}),
		...(option.preview ? { preview: option.preview } : {}),
	}));
	rows.push({ kind: "other", label: "Other", value: "__other__" });
	return rows;
}

export function askSingleChoice(
	ctx: ExtensionContext,
	question: NormalizedQuestion,
): Promise<AskAnswer | null> {
	const rows = buildRows(question.options);

	return ctx.ui.custom<AskAnswer | null>((tui, theme, _keybindings, done) => {
		let focusIndex = 0;
		let editMode = false;
		let cachedLines: string[] | undefined;
		const editor = new Editor(tui, createEditorTheme(theme));

		editor.onSubmit = (value: string) => {
			const trimmed = value.trim();
			if (!trimmed) return;
			done({ kind: "other", label: trimmed, value: trimmed });
		};

		const refresh = () => {
			cachedLines = undefined;
			tui.requestRender();
		};

		const handleInput = (data: string) => {
			if (editMode) {
				if (matchesKey(data, Key.escape)) {
					editMode = false;
					editor.setText("");
					refresh();
					return;
				}
				editor.handleInput(data);
				refresh();
				return;
			}

			if (matchesKey(data, Key.up)) {
				focusIndex = Math.max(0, focusIndex - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				focusIndex = Math.min(rows.length - 1, focusIndex + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				const selected = rows[focusIndex];
				if (!selected) return;
				if (selected.kind === "other") {
					editMode = true;
					editor.setText("");
					refresh();
					return;
				}
				done({
					kind: "option",
					label: selected.label,
					value: selected.value,
					index: selected.index ?? focusIndex + 1,
				});
				return;
			}
			if (matchesKey(data, Key.escape)) {
				done(null);
			}
		};

		const render = (width: number): string[] => {
			if (cachedLines) return cachedLines;

			const lines: string[] = [];
			const add = (text: string) => lines.push(truncateToWidth(text, width));

			add(theme.fg("accent", "─".repeat(width)));
			renderQuestionHeading(
				lines,
				question.question,
				question.header,
				question.details,
				width,
				theme,
			);
			lines.push("");

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				if (!row) continue;
				const focused = i === focusIndex;
				const prefix = focused ? theme.fg("accent", "> ") : "  ";
				const label =
					row.kind === "other" ? row.label : `${row.index}. ${row.label}`;
				add(
					`${prefix}${focused ? theme.fg("accent", label) : theme.fg("text", label)}`,
				);
				if (row.description)
					addWrapped(lines, theme.fg("muted", row.description), width, "     ");
			}

			const focusedRow = rows[focusIndex];
			if (!editMode && focusedRow?.kind === "option" && focusedRow.preview) {
				renderPreview(
					lines,
					{
						label: focusedRow.label,
						value: focusedRow.value,
						preview: focusedRow.preview,
					},
					width,
					theme,
				);
			}

			if (editMode) {
				lines.push("");
				add(theme.fg("muted", " Write your custom answer:"));
				for (const line of editor.render(Math.max(1, width - 2)))
					add(` ${line}`);
				lines.push("");
				add(theme.fg("dim", " Enter submit • Esc back"));
			} else {
				lines.push("");
				add(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
			}

			add(theme.fg("accent", "─".repeat(width)));
			cachedLines = lines;
			return lines;
		};

		return {
			render,
			invalidate: () => {
				cachedLines = undefined;
			},
			handleInput,
		};
	});
}
