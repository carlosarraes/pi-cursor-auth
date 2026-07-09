import type {
	AssistantMessage,
	AssistantMessageEventStream,
	TextContent,
	ThinkingContent,
	ToolCall,
} from "@earendil-works/pi-ai";

export interface CursorStreamState {
	output: AssistantMessage;
	stream: AssistantMessageEventStream;
	firstTokenTime: number | undefined;
	now: () => number;
	currentTextBlock: TextContent | null;
	currentTextBlockIndex: number;
	currentThinkingBlock: ThinkingContent | null;
	currentThinkingBlockIndex: number;
	currentMcpToolCall: ToolCall | null;
	currentMcpToolCallIndex: number;
	currentMcpToolCallId: string | null;
	currentMcpArgsText: string;
	providerResolvedToolCallIds: Set<string>;
	providerResolvedToolCallEndIds: Set<string>;
}

export function createCursorStreamState(
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	now: () => number = Date.now,
): CursorStreamState {
	return {
		output,
		stream,
		firstTokenTime: undefined,
		now,
		currentTextBlock: null,
		currentTextBlockIndex: -1,
		currentThinkingBlock: null,
		currentThinkingBlockIndex: -1,
		currentMcpToolCall: null,
		currentMcpToolCallIndex: -1,
		currentMcpToolCallId: null,
		currentMcpArgsText: "",
		providerResolvedToolCallIds: new Set(),
		providerResolvedToolCallEndIds: new Set(),
	};
}

function markFirstOutput(state: CursorStreamState): void {
	state.firstTokenTime ??= state.now();
}

function finalizeTextBlock(state: CursorStreamState): void {
	if (!state.currentTextBlock) return;
	state.stream.push({
		type: "text_end",
		contentIndex: state.currentTextBlockIndex,
		content: state.currentTextBlock.text,
		partial: state.output,
	});
	state.currentTextBlock = null;
}

function finalizeThinkingBlock(state: CursorStreamState): void {
	if (!state.currentThinkingBlock) return;
	state.stream.push({
		type: "thinking_end",
		contentIndex: state.currentThinkingBlockIndex,
		content: state.currentThinkingBlock.thinking,
		partial: state.output,
	});
	state.currentThinkingBlock = null;
}

export function appendCursorTextDelta(
	state: CursorStreamState,
	delta: string,
): void {
	markFirstOutput(state);
	finalizeThinkingBlock(state);
	if (!state.currentTextBlock) {
		state.currentTextBlock = { type: "text", text: "" };
		state.output.content.push(state.currentTextBlock);
		state.currentTextBlockIndex = state.output.content.length - 1;
		state.stream.push({
			type: "text_start",
			contentIndex: state.currentTextBlockIndex,
			partial: state.output,
		});
	}
	state.currentTextBlock.text += delta;
	state.stream.push({
		type: "text_delta",
		contentIndex: state.currentTextBlockIndex,
		delta,
		partial: state.output,
	});
}

export function appendCursorThinkingDelta(
	state: CursorStreamState,
	delta: string,
): void {
	markFirstOutput(state);
	finalizeTextBlock(state);
	if (!state.currentThinkingBlock) {
		state.currentThinkingBlock = { type: "thinking", thinking: "" };
		state.output.content.push(state.currentThinkingBlock);
		state.currentThinkingBlockIndex = state.output.content.length - 1;
		state.stream.push({
			type: "thinking_start",
			contentIndex: state.currentThinkingBlockIndex,
			partial: state.output,
		});
	}
	state.currentThinkingBlock.thinking += delta;
	state.stream.push({
		type: "thinking_delta",
		contentIndex: state.currentThinkingBlockIndex,
		delta,
		partial: state.output,
	});
}

export function synthesizeCursorExecToolCall(
	state: CursorStreamState,
	toolCallId: string,
	toolName: string,
	args: Record<string, unknown>,
): void {
	if (state.providerResolvedToolCallIds.has(toolCallId)) return;
	state.providerResolvedToolCallIds.add(toolCallId);
	markFirstOutput(state);
	finalizeTextBlock(state);
	finalizeThinkingBlock(state);

	const toolCall: ToolCall = {
		type: "toolCall",
		id: toolCallId,
		name: toolName,
		arguments: args,
	};
	state.output.content.push(toolCall);
	const contentIndex = state.output.content.length - 1;
	state.stream.push({
		type: "toolcall_start",
		contentIndex,
		partial: state.output,
	});
}

export function startCursorMcpToolCall(
	state: CursorStreamState,
	toolCallId: string,
	toolName: string,
): void {
	if (state.providerResolvedToolCallIds.has(toolCallId)) {
		if (
			state.currentMcpToolCallId === toolCallId ||
			state.providerResolvedToolCallEndIds.has(toolCallId)
		) {
			return;
		}
		const contentIndex = state.output.content.findIndex(
			(block) => block.type === "toolCall" && block.id === toolCallId,
		);
		const existingToolCall = state.output.content[contentIndex];
		if (existingToolCall?.type !== "toolCall") return;
		state.currentMcpToolCall = existingToolCall;
		state.currentMcpToolCallIndex = contentIndex;
		state.currentMcpToolCallId = toolCallId;
		state.currentMcpArgsText = "";
		return;
	}
	state.providerResolvedToolCallIds.add(toolCallId);
	markFirstOutput(state);
	finalizeTextBlock(state);
	finalizeThinkingBlock(state);

	const toolCall: ToolCall = {
		type: "toolCall",
		id: toolCallId,
		name: toolName,
		arguments: {},
	};
	state.output.content.push(toolCall);
	state.currentMcpToolCall = toolCall;
	state.currentMcpToolCallIndex = state.output.content.length - 1;
	state.currentMcpToolCallId = toolCallId;
	state.currentMcpArgsText = "";
	state.stream.push({
		type: "toolcall_start",
		contentIndex: state.currentMcpToolCallIndex,
		partial: state.output,
	});
}

export function appendCursorMcpArgsSnapshot(
	state: CursorStreamState,
	snapshot: string,
): void {
	if (!state.currentMcpToolCall) {
		throw new Error(
			"Cannot append Cursor MCP args without an active tool call",
		);
	}

	const delta = argsTextDelta(state.currentMcpArgsText, snapshot);
	state.currentMcpArgsText = snapshot;
	if (!delta) return;

	state.stream.push({
		type: "toolcall_delta",
		contentIndex: state.currentMcpToolCallIndex,
		delta,
		partial: state.output,
	});
}

export function completeCursorMcpToolCall(
	state: CursorStreamState,
	completionArgs: Record<string, unknown>,
): void {
	const toolCall = state.currentMcpToolCall;
	if (!toolCall) {
		throw new Error(
			"Cannot complete Cursor MCP tool call without an active call",
		);
	}

	toolCall.arguments = mergeCursorMcpToolCallArgs(
		state.currentMcpArgsText,
		completionArgs,
	);
	state.stream.push({
		type: "toolcall_end",
		contentIndex: state.currentMcpToolCallIndex,
		toolCall,
		partial: state.output,
	});
	state.providerResolvedToolCallEndIds.add(toolCall.id);
	state.currentMcpToolCall = null;
	state.currentMcpToolCallIndex = -1;
	state.currentMcpToolCallId = null;
	state.currentMcpArgsText = "";
}

function argsTextDelta(previous: string, snapshot: string): string {
	if (snapshot.startsWith(previous)) {
		return snapshot.slice(previous.length);
	}
	return snapshot;
}

function mergeCursorMcpToolCallArgs(
	streamedArgsText: string,
	completionArgs: Record<string, unknown>,
): Record<string, unknown> {
	const streamedArgs = parseCursorMcpArgsText(streamedArgsText);
	const merged = { ...streamedArgs };
	for (const [key, completionValue] of Object.entries(completionArgs)) {
		const streamedValue = streamedArgs[key];
		if (
			isStructuredValue(streamedValue) &&
			typeof completionValue === "string"
		) {
			continue;
		}
		merged[key] = completionValue;
	}
	return merged;
}

function isStructuredValue(value: unknown): boolean {
	return typeof value === "object" && value !== null;
}

function parseCursorMcpArgsText(argsText: string): Record<string, unknown> {
	if (!argsText.trim()) return {};

	try {
		return asRecord(JSON.parse(argsText));
	} catch {
		return {};
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

export function isCurrentCursorMcpToolCall(
	state: CursorStreamState,
	toolCallId: string,
): boolean {
	return state.currentMcpToolCallId === toolCallId;
}

const TOOL_ACTIVITY_SUMMARY_LIMIT = 512;

function summarizeToolActivity(
	toolName: string,
	args: Record<string, unknown>,
): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(args) ?? "{}";
	} catch {
		serialized = "[unserializable arguments]";
	}
	const summary = `[Cursor tool] ${toolName} ${serialized}`;
	if (summary.length <= TOOL_ACTIVITY_SUMMARY_LIMIT) return summary;
	return `${summary.slice(0, TOOL_ACTIVITY_SUMMARY_LIMIT - 1)}…`;
}

/**
 * Provider-side tools have already run. Replace their transient ToolCall blocks
 * before the final message reaches pi-agent-core, which executes every final
 * ToolCall it receives.
 */
export function finalizeCursorProviderToolCalls(
	state: CursorStreamState,
): void {
	if (state.currentMcpToolCall) {
		completeCursorMcpToolCall(state, {});
	}

	state.output.content = state.output.content.map((block, contentIndex) => {
		if (
			block.type !== "toolCall" ||
			!state.providerResolvedToolCallIds.has(block.id)
		) {
			return block;
		}
		if (!state.providerResolvedToolCallEndIds.has(block.id)) {
			state.stream.push({
				type: "toolcall_end",
				contentIndex,
				toolCall: block,
				partial: state.output,
			});
			state.providerResolvedToolCallEndIds.add(block.id);
		}
		return {
			type: "text" as const,
			text: summarizeToolActivity(block.name, block.arguments),
		};
	});
}

export function finalizeCursorStreamState(state: CursorStreamState): void {
	finalizeTextBlock(state);
	finalizeThinkingBlock(state);
}
