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

export function finalizeCursorStreamState(state: CursorStreamState): void {
	finalizeTextBlock(state);
	finalizeThinkingBlock(state);
}
