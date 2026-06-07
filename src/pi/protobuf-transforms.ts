import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
	DeleteError,
	DeleteRejected,
	type DeleteResult,
	DeleteResult as DeleteResultClass,
	DeleteSuccess,
} from "../__generated__/agent/v1/delete_exec_pb";
import {
	GrepContentMatch,
	GrepContentResult,
	GrepCountResult,
	GrepError,
	GrepFileCount,
	GrepFileMatch,
	GrepFilesResult,
	type GrepResult,
	GrepResult as GrepResultClass,
	GrepSuccess,
	GrepUnionResult,
} from "../__generated__/agent/v1/grep_exec_pb";
import {
	LsError,
	LsRejected,
	type LsResult,
	LsResult as LsResultClass,
	LsSuccess,
} from "../__generated__/agent/v1/ls_exec_pb";
import {
	ReadError,
	ReadRejected,
	type ReadResult,
	ReadResult as ReadResultClass,
	ReadSuccess,
} from "../__generated__/agent/v1/read_exec_pb";
import {
	LsDirectoryTreeNode,
	LsDirectoryTreeNode_File,
} from "../__generated__/agent/v1/selected_context_pb";
import {
	ShellFailure,
	ShellRejected,
	type ShellResult,
	ShellResult as ShellResultClass,
	ShellSuccess,
} from "../__generated__/agent/v1/shell_exec_pb";
import {
	WriteError,
	WriteRejected,
	type WriteResult,
	WriteResult as WriteResultClass,
	WriteSuccess,
} from "../__generated__/agent/v1/write_exec_pb";
import {
	toolResultDetailBoolean,
	toolResultToText,
	toolResultWasTruncated,
} from "./utils/tool-result";

// ── Read ────────────────────────────────────────────────────────────────

export function buildReadResult(
	path: string,
	result: ToolResultMessage,
): ReadResult {
	const text = toolResultToText(result);
	if (result.isError) {
		return new ReadResultClass({
			result: {
				case: "error",
				value: new ReadError({ path, error: text || "Read failed" }),
			},
		});
	}
	const totalLines = text ? text.split("\n").length : 0;
	return new ReadResultClass({
		result: {
			case: "success",
			value: new ReadSuccess({
				path,
				totalLines,
				fileSize: BigInt(Buffer.byteLength(text, "utf-8")),
				truncated: toolResultWasTruncated(result),
				output: { case: "content", value: text },
			}),
		},
	});
}

export function buildReadRejected(path: string, reason: string): ReadResult {
	return new ReadResultClass({
		result: { case: "rejected", value: new ReadRejected({ path, reason }) },
	});
}

// ── Write ───────────────────────────────────────────────────────────────

export function buildWriteResult(
	args: {
		path: string;
		fileText?: string;
		fileBytes?: Uint8Array;
		returnFileContentAfterWrite?: boolean;
	},
	result: ToolResultMessage,
): WriteResult {
	const text = toolResultToText(result);
	if (result.isError) {
		return new WriteResultClass({
			result: {
				case: "error",
				value: new WriteError({
					path: args.path,
					error: text || "Write failed",
				}),
			},
		});
	}
	const fileText = args.fileText ?? "";
	const fileSize =
		args.fileBytes?.length ?? Buffer.byteLength(fileText, "utf-8");
	const linesCreated = fileText ? fileText.split("\n").length : 0;
	return new WriteResultClass({
		result: {
			case: "success",
			value: new WriteSuccess({
				path: args.path,
				linesCreated,
				fileSize,
				...(args.returnFileContentAfterWrite
					? { fileContentAfterWrite: fileText }
					: {}),
			}),
		},
	});
}

export function buildWriteRejected(path: string, reason: string): WriteResult {
	return new WriteResultClass({
		result: { case: "rejected", value: new WriteRejected({ path, reason }) },
	});
}

// ── Delete ──────────────────────────────────────────────────────────────

export function buildDeleteResult(
	path: string,
	result: ToolResultMessage,
): DeleteResult {
	const text = toolResultToText(result);
	if (result.isError) {
		return new DeleteResultClass({
			result: {
				case: "error",
				value: new DeleteError({ path, error: text || "Delete failed" }),
			},
		});
	}
	return new DeleteResultClass({
		result: {
			case: "success",
			value: new DeleteSuccess({
				path,
				deletedFile: path,
				fileSize: BigInt(0),
				prevContent: "",
			}),
		},
	});
}

export function buildDeleteRejected(
	path: string,
	reason: string,
): DeleteResult {
	return new DeleteResultClass({
		result: { case: "rejected", value: new DeleteRejected({ path, reason }) },
	});
}

// ── Shell ───────────────────────────────────────────────────────────────

export function buildShellResult(
	args: { command: string; workingDirectory: string },
	result: ToolResultMessage,
): ShellResult {
	const output = toolResultToText(result);
	if (result.isError) {
		return new ShellResultClass({
			result: {
				case: "failure",
				value: new ShellFailure({
					command: args.command,
					workingDirectory: args.workingDirectory,
					exitCode: 1,
					signal: "",
					stdout: "",
					stderr: output || "Shell failed",
					executionTime: 0,
					aborted: false,
				}),
			},
		});
	}
	return new ShellResultClass({
		result: {
			case: "success",
			value: new ShellSuccess({
				command: args.command,
				workingDirectory: args.workingDirectory,
				exitCode: 0,
				signal: "",
				stdout: output,
				stderr: "",
				executionTime: 0,
			}),
		},
	});
}

export function buildShellRejected(
	command: string,
	workingDirectory: string,
	reason: string,
): ShellResult {
	return new ShellResultClass({
		result: {
			case: "rejected",
			value: new ShellRejected({
				command,
				workingDirectory,
				reason,
				isReadonly: false,
			}),
		},
	});
}

// ── Ls ──────────────────────────────────────────────────────────────────

export function buildLsResult(
	path: string,
	result: ToolResultMessage,
): LsResult {
	const text = toolResultToText(result);
	if (result.isError) {
		return new LsResultClass({
			result: {
				case: "error",
				value: new LsError({ path, error: text || "Ls failed" }),
			},
		});
	}

	const rootPath = path || ".";
	const entries = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("["));

	const childrenDirs: LsDirectoryTreeNode[] = [];
	const childrenFiles: LsDirectoryTreeNode_File[] = [];

	for (const entry of entries) {
		const name = entry.split(" (")[0];
		if (name?.endsWith("/")) {
			const dirName = name.slice(0, -1);
			childrenDirs.push(
				new LsDirectoryTreeNode({
					absPath: `${rootPath.replace(/\/$/, "")}/${dirName}`,
					childrenDirs: [],
					childrenFiles: [],
					childrenWereProcessed: false,
					fullSubtreeExtensionCounts: {},
					numFiles: 0,
				}),
			);
		} else {
			childrenFiles.push(
				new LsDirectoryTreeNode_File(name ? { name } : undefined),
			);
		}
	}

	const root = new LsDirectoryTreeNode({
		absPath: rootPath,
		childrenDirs,
		childrenFiles,
		childrenWereProcessed: true,
		fullSubtreeExtensionCounts: {},
		numFiles: childrenFiles.length,
	});

	return new LsResultClass({
		result: {
			case: "success",
			value: new LsSuccess({ directoryTreeRoot: root }),
		},
	});
}

export function buildLsRejected(path: string, reason: string): LsResult {
	return new LsResultClass({
		result: { case: "rejected", value: new LsRejected({ path, reason }) },
	});
}

// ── Grep ────────────────────────────────────────────────────────────────

function extractGrepFileFromLine(line: string): string | null {
	const matchLine = line.match(/^(.+?):\d+:/);
	if (matchLine) return matchLine[1] ?? null;
	const contextLine = line.match(/^(.+?)-\d+-/);
	if (contextLine) return contextLine[1] ?? null;
	return null;
}

export function buildGrepResult(
	args: { pattern: string; path?: string; outputMode?: string },
	result: ToolResultMessage,
): GrepResult {
	const text = toolResultToText(result);
	if (result.isError) {
		return buildGrepError(text || "Grep failed");
	}

	const outputMode = args.outputMode || "content";
	const clientTruncated = toolResultDetailBoolean(result, "truncated");
	const lines = text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter(
			(line) =>
				line.length > 0 &&
				!line.startsWith("[") &&
				!line.toLowerCase().startsWith("no matches"),
		);

	const workspaceKey = args.path || ".";
	let unionResult: GrepUnionResult;

	if (outputMode === "files_with_matches") {
		const fileSet = new Set<string>();
		for (const line of lines) {
			const file = extractGrepFileFromLine(line) ?? line;
			if (file) fileSet.add(file);
		}
		const files = Array.from(fileSet.values());
		unionResult = new GrepUnionResult({
			result: {
				case: "files",
				value: new GrepFilesResult({
					files,
					totalFiles: files.length,
					clientTruncated,
					ripgrepTruncated: false,
				}),
			},
		});
	} else if (outputMode === "count") {
		const counts = new Map<string, number>();
		let parsedCountLines = false;

		for (const line of lines) {
			const countMatch = line.match(/^(.+?):(\d+)$/);
			if (countMatch) {
				parsedCountLines = true;
				const file = countMatch[1];
				const countValue = Number.parseInt(countMatch[2] ?? "0", 10);
				if (!Number.isNaN(countValue)) {
					counts.set(file ?? "", countValue);
				}
				continue;
			}
			const matchLine = line.match(/^(.+?):(\d+):\s?(.*)$/);
			const contextLine = line.match(/^(.+?)-(\d+)-\s?(.*)$/);
			if (matchLine && !contextLine) {
				const file = matchLine[1] ?? "";
				counts.set(file, (counts.get(file) ?? 0) + 1);
			}
		}

		if (!parsedCountLines && counts.size === 0 && lines.length > 0) {
			for (const line of lines) {
				const file = extractGrepFileFromLine(line);
				if (file) counts.set(file, (counts.get(file) ?? 0) + 1);
			}
		}

		const countEntries = Array.from(counts.entries()).map(
			([file, count]) => new GrepFileCount({ file, count }),
		);
		const totalMatches = countEntries.reduce(
			(sum, entry) => sum + entry.count,
			0,
		);

		unionResult = new GrepUnionResult({
			result: {
				case: "count",
				value: new GrepCountResult({
					counts: countEntries,
					totalFiles: countEntries.length,
					totalMatches,
					clientTruncated,
					ripgrepTruncated: false,
				}),
			},
		});
	} else {
		const matchMap = new Map<
			string,
			Array<{ line: number; content: string; isContextLine: boolean }>
		>();
		let totalMatchedLines = 0;

		for (const line of lines) {
			const matchLine = line.match(/^(.+?):(\d+):\s?(.*)$/);
			const contextLine = line.match(/^(.+?)-(\d+)-\s?(.*)$/);
			const match = matchLine ?? contextLine;
			if (!match) continue;
			const file = match[1];
			const lineNumber = match[2];
			const content = match[3] ?? "";
			const isContextLine = Boolean(contextLine);
			const list = matchMap.get(file ?? "") ?? [];
			list.push({ line: Number(lineNumber), content, isContextLine });
			matchMap.set(file ?? "", list);
			if (!isContextLine) totalMatchedLines += 1;
		}

		const matches = Array.from(matchMap.entries()).map(
			([file, fileMatches]) =>
				new GrepFileMatch({
					file,
					matches: fileMatches.map(
						(entry) =>
							new GrepContentMatch({
								lineNumber: entry.line,
								content: entry.content,
								contentTruncated: false,
								isContextLine: entry.isContextLine,
							}),
					),
				}),
		);
		const totalLines = matches.reduce(
			(sum, entry) => sum + entry.matches.length,
			0,
		);
		unionResult = new GrepUnionResult({
			result: {
				case: "content",
				value: new GrepContentResult({
					matches,
					totalLines,
					totalMatchedLines,
					clientTruncated,
					ripgrepTruncated: false,
				}),
			},
		});
	}

	return new GrepResultClass({
		result: {
			case: "success",
			value: new GrepSuccess({
				pattern: args.pattern,
				path: args.path || "",
				outputMode,
				workspaceResults: { [workspaceKey]: unionResult },
			}),
		},
	});
}

export function buildGrepError(error: string): GrepResult {
	return new GrepResultClass({
		result: { case: "error", value: new GrepError({ error }) },
	});
}
