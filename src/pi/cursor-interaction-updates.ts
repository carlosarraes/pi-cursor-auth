import { Value } from "@bufbuild/protobuf";
import type { ToolCall as CursorProtocolToolCall } from "../__generated__/agent/v1/agent_pb";
import type { McpArgs } from "../__generated__/agent/v1/mcp_tool_pb";
import type { CoreInteractionUpdate } from "../vendor/agent-core";
import {
	appendCursorMcpArgsSnapshot,
	type CursorStreamState,
	completeCursorMcpToolCall,
	isCurrentCursorMcpToolCall,
	startCursorMcpToolCall,
} from "./cursor-stream-state";

function getMcpArgs(toolCall: unknown): McpArgs | undefined {
	const protocolToolCall = toolCall as CursorProtocolToolCall | undefined;
	if (protocolToolCall?.tool.case !== "mcpToolCall") return undefined;
	return protocolToolCall.tool.value.args;
}

function decodeArgValue(bytes: Uint8Array): unknown {
	try {
		return Value.fromBinary(bytes).toJson();
	} catch {
		const text = new TextDecoder().decode(bytes);
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
}

function decodeMcpArgs(
	args: Record<string, Uint8Array>,
): Record<string, unknown> {
	const decoded: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		decoded[key] = decodeArgValue(value);
	}
	return decoded;
}

function toolCallId(update: {
	callId: string;
	toolCall: unknown;
}): string | undefined {
	const args = getMcpArgs(update.toolCall);
	if (!args) return undefined;
	return args.toolCallId || update.callId;
}

/** Processes the MCP tool lifecycle updates emitted by Cursor's interaction stream. */
export function processCursorInteractionUpdate(
	state: CursorStreamState,
	update: CoreInteractionUpdate,
): boolean {
	switch (update.type) {
		case "tool-call-started": {
			const args = getMcpArgs(update.toolCall);
			if (!args) return false;
			startCursorMcpToolCall(
				state,
				args.toolCallId || update.callId,
				args.toolName || args.name,
			);
			return true;
		}

		case "partial-tool-call": {
			const id = toolCallId(update);
			if (!id) return false;
			if (!isCurrentCursorMcpToolCall(state, id)) return true;
			appendCursorMcpArgsSnapshot(state, update.argsTextDelta);
			return true;
		}

		case "tool-call-completed": {
			const args = getMcpArgs(update.toolCall);
			if (!args) return false;
			const id = args.toolCallId || update.callId;
			if (!isCurrentCursorMcpToolCall(state, id)) {
				startCursorMcpToolCall(state, id, args.toolName || args.name);
			}
			if (isCurrentCursorMcpToolCall(state, id)) {
				completeCursorMcpToolCall(state, decodeMcpArgs(args.args));
			}
			return true;
		}

		default:
			return false;
	}
}
