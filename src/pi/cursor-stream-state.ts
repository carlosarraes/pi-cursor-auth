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
	currentMcpArgsText: string;
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
		currentMcpArgsText: "",
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
	state.stream.push({
		type: "toolcall_end",
		contentIndex,
		toolCall,
		partial: state.output,
	});
}

export function startCursorMcpToolCall(
	state: CursorStreamState,
	toolCallId: string,
	toolName: string,
): void {
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
	state.currentMcpToolCall = null;
	state.currentMcpToolCallIndex = -1;
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
	return {
		...parseCursorMcpArgsText(streamedArgsText),
		...completionArgs,
	};
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

export function finalizeCursorStreamState(state: CursorStreamState): void {
	finalizeTextBlock(state);
	finalizeThinkingBlock(state);
}
