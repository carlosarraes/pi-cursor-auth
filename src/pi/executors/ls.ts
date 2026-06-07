import { createLsTool } from "@earendil-works/pi-coding-agent";
import type { LsArgs, LsResult } from "../../__generated__/agent/v1/ls_exec_pb";
import type { PiToolContext } from "../local-resource-provider/types";
import { buildLsRejected, buildLsResult } from "../protobuf-transforms";
import { GenericToolExecutor } from "./generic";

export function createLsExecutor(ctx: PiToolContext) {
	return new GenericToolExecutor<LsArgs, LsResult>({
		ctx,
		toolName: "ls",
		toolFactory: createLsTool,
		extractArgs: (args) => ({ path: args.path || "." }),
		transform: (args, result) => buildLsResult(args.path, result),
		buildRejected: (args) => buildLsRejected(args.path, "Tool not available"),
	});
}
