import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { AskAnswer, AskOption, NormalizedQuestion } from "../types";
import { addWrapped, createEditorTheme, renderPreview, renderQuestionHeading } from "./shared";

interface MultiRow {
	id: string;
	kind: "option" | "other" | "submit";
	label: string;
	value: string;
	description?: string;
	preview?: string;
	index?: number;
}

function buildRows(options: AskOption[]): MultiRow[] {
	const rows: MultiRow[] = options.map((option, i) => ({
		id: `opt:${i}`,
		kind: "option",
		label: option.label,
		value: option.value,
		index: i + 1,
		...(option.description ? { description: option.description } : {}),
		...(option.preview ? { preview: option.preview } : {}),
	}));
	rows.push({ id: "other", kind: "other", label: "Other", value: "__other__" });
	rows.push({ id: "submit", kind: "submit", label: "Submit", value: "__submit__" });
	return rows;
}

export function askMultiChoice(ctx: ExtensionContext, question: NormalizedQuestion): Promise<AskAnswer[] | null> {
	const rows = buildRows(question.options);

	return ctx.ui.custom<AskAnswer[] | null>((tui, theme, _keybindings, done) => {
		let focusIndex = 0;
		let editMode = false;
		let cachedLines: string[] | undefined;
		const selected = new Map<string, AskAnswer>();
		const editor = new Editor(tui, createEditorTheme(theme));

		const refresh = () => {
			cachedLines = undefined;
			tui.requestRender();
		};

		editor.onSubmit = (value: string) => {
			const trimmed = value.trim();
			if (!trimmed) return;
			selected.set("other", { kind: "other", label: trimmed, value: trimmed });
			editMode = false;
			refresh();
		};

		const toggleOption = (row: MultiRow) => {
			if (selected.has(row.id)) {
				selected.delete(row.id);
			} else {
				selected.set(row.id, { kind: "option", label: row.label, value: row.value, index: row.index ?? 0 });
			}
			refresh();
		};

		const collect = (): AskAnswer[] => {
			const answers = Array.from(selected.values());
			answers.sort((a, b) => {
				const rank = (answer: AskAnswer) => (answer.kind === "option" ? (answer.index ?? 0) : Number.MAX_SAFE_INTEGER);
				return rank(a) - rank(b);
			});
			return answers;
		};

		const handleInput = (data: string) => {
			if (editMode) {
				if (matchesKey(data, Key.escape)) {
					editMode = false;
					editor.setText(selected.get("other")?.label ?? "");
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

			const current = rows[focusIndex];
			if (!current) return;

			if (matchesKey(data, Key.space)) {
				if (current.kind === "submit") return;
				if (current.kind === "other") {
					if (selected.has("other")) {
						selected.delete("other");
						refresh();
					} else {
						editMode = true;
						editor.setText("");
						refresh();
					}
					return;
				}
				toggleOption(current);
				return;
			}

			if (matchesKey(data, Key.enter)) {
				if (current.kind === "submit") {
					if (selected.size > 0) done(collect());
					return;
				}
				if (current.kind === "other") {
					editMode = true;
					editor.setText(selected.get("other")?.label ?? "");
					refresh();
					return;
				}
				toggleOption(current);
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
			renderQuestionHeading(lines, question.question, question.header, question.details, width, theme);
			lines.push("");

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				if (!row) continue;
				const focused = i === focusIndex;
				const prefix = focused ? theme.fg("accent", "> ") : "  ";

				if (row.kind === "submit") {
					const label = selected.size > 0 ? `✓ ${row.label} (${selected.size} selected)` : `○ ${row.label}`;
					add(`${prefix}${focused ? theme.fg("accent", label) : theme.fg(selected.size > 0 ? "success" : "dim", label)}`);
					continue;
				}
				if (row.kind === "other") {
					const other = selected.get("other");
					const marker = other ? "[x]" : "[ ]";
					const suffix = other ? ` — ${other.label}` : "";
					const label = `${marker} ${row.label}${suffix}`;
					add(`${prefix}${focused ? theme.fg("accent", label) : theme.fg(other ? "success" : "text", label)}`);
					continue;
				}

				const checked = selected.has(row.id);
				const label = `${checked ? "[x]" : "[ ]"} ${row.index}. ${row.label}`;
				add(`${prefix}${focused ? theme.fg("accent", label) : theme.fg(checked ? "success" : "text", label)}`);
				if (row.description) addWrapped(lines, theme.fg("muted", row.description), width, "     ");
			}

			const focusedRow = rows[focusIndex];
			if (!editMode && focusedRow?.kind === "option" && focusedRow.preview) {
				renderPreview(lines, { label: focusedRow.label, value: focusedRow.value, preview: focusedRow.preview }, width, theme);
			}

			if (editMode) {
				lines.push("");
				add(theme.fg("muted", " Write your custom answer:"));
				for (const line of editor.render(Math.max(1, width - 2))) add(` ${line}`);
				lines.push("");
				add(theme.fg("dim", " Enter save • Esc back"));
			} else {
				lines.push("");
				if (selected.size === 0) add(theme.fg("warning", " Select at least one answer before submitting."));
				add(theme.fg("dim", " ↑↓ navigate • Space toggle • Enter edit/submit • Esc cancel"));
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
