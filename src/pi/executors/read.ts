import { createReadTool } from "@mariozechner/pi-coding-agent";
import type {
	ReadArgs,
	ReadResult,
} from "../../__generated__/agent/v1/read_exec_pb";
import type { PiToolContext } from "../local-resource-provider/types";
import { buildReadRejected, buildReadResult } from "../protobuf-transforms";
import { GenericToolExecutor } from "./generic";

export function createReadExecutor(ctx: PiToolContext) {
	return new GenericToolExecutor<ReadArgs, ReadResult>({
		ctx,
		toolName: "read",
		toolFactory: createReadTool,
		extractArgs: (args) => ({ path: args.path }),
		transform: (args, result) => buildReadResult(args.path, result),
		buildRejected: (args) => buildReadRejected(args.path, "Tool not available"),
	});
}
