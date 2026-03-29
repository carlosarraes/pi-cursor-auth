import { createGrepTool } from "@mariozechner/pi-coding-agent";
import type {
	GrepArgs,
	GrepResult,
} from "../../__generated__/agent/v1/grep_exec_pb";
import type { PiToolContext } from "../local-resource-provider/types";
import { buildGrepError, buildGrepResult } from "../protobuf-transforms";
import { GenericToolExecutor } from "./generic";

export function createGrepExecutor(ctx: PiToolContext) {
	return new GenericToolExecutor<GrepArgs, GrepResult>({
		ctx,
		toolName: "grep",
		toolFactory: createGrepTool,
		extractArgs: (args) => ({
			pattern: args.pattern,
			...(args.path ? { path: args.path } : {}),
			...(args.glob ? { glob: args.glob } : {}),
			...(args.caseInsensitive ? { ignoreCase: true } : {}),
			...((args.context ?? args.contextBefore ?? args.contextAfter) != null
				? {
						context:
							args.context ?? args.contextBefore ?? args.contextAfter ?? 0,
					}
				: {}),
			...(args.headLimit != null ? { limit: args.headLimit } : {}),
		}),
		transform: (args, result) =>
			buildGrepResult(
				{
					pattern: args.pattern,
					...(args.path ? { path: args.path } : {}),
					...(args.outputMode ? { outputMode: args.outputMode } : {}),
				},
				result,
			),
		buildRejected: () => buildGrepError("Tool not available"),
	});
}
