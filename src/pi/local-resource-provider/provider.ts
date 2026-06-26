import type { McpToolDefinition } from "../../__generated__/agent/v1/mcp_pb";
import {
	backgroundShellResource,
	computerUseResource,
	deleteResource,
	diagnosticsResource,
	fetchResource,
	grepResource,
	hookExecutorResource,
	listMcpResourcesResource,
	lsResource,
	mcpResource,
	RegistryResourceAccessor,
	readMcpResourceResource,
	readResource,
	recordScreenResource,
	requestContextResource,
	shellResource,
	shellStreamResource,
	writeResource,
	writeShellStdinResource,
} from "../../vendor/agent-exec";
import {
	BackgroundShellManager,
	LocalBackgroundShellExecutor,
	LocalWriteShellStdinExecutor,
} from "../executors/background-shell";
import { LocalDeleteExecutor } from "../executors/delete";
import { createGrepExecutor } from "../executors/grep";
import { LocalHookExecutorImpl } from "../executors/hook";
import { createLsExecutor } from "../executors/ls";
import { LocalMcpExecutor } from "../executors/mcp";
import { createReadExecutor } from "../executors/read";
import { LocalRequestContextExecutor } from "../executors/request-context";
import { LocalShellExecutor } from "../executors/shell";
import { LocalShellStreamExecutor } from "../executors/shell-stream";
import {
	StubComputerUseExecutor,
	StubDiagnosticsExecutor,
	StubFetchExecutor,
	StubListMcpResourcesExecutor,
	StubReadMcpResourceExecutor,
	StubRecordScreenExecutor,
} from "../executors/stubs";
import { LocalWriteExecutor } from "../executors/write";
import type { PiToolContext } from "./types";

interface LocalResourceProviderOptions {
	ctx: PiToolContext;
	requestContextTools?: McpToolDefinition[];
	workspacePaths?: string[];
}

export class LocalResourceProvider extends RegistryResourceAccessor {
	constructor(options: LocalResourceProviderOptions) {
		super();
		const { ctx, requestContextTools = [], workspacePaths } = options;
		const resolvedWorkspacePaths = workspacePaths ?? [ctx.cwd];

		this.register(hookExecutorResource, new LocalHookExecutorImpl());

		this.register(
			requestContextResource,
			new LocalRequestContextExecutor(
				requestContextTools,
				resolvedWorkspacePaths,
			),
		);

		this.register(readResource, createReadExecutor(ctx));
		this.register(writeResource, new LocalWriteExecutor(ctx));
		this.register(deleteResource, new LocalDeleteExecutor(ctx));

		const shellExecutor = new LocalShellExecutor(ctx);
		const backgroundShellManager = new BackgroundShellManager();
		this.register(shellResource, shellExecutor);
		this.register(
			shellStreamResource,
			new LocalShellStreamExecutor(ctx, shellExecutor, backgroundShellManager),
		);

		this.register(grepResource, createGrepExecutor(ctx));
		this.register(lsResource, createLsExecutor(ctx));

		this.register(
			backgroundShellResource,
			new LocalBackgroundShellExecutor(ctx, backgroundShellManager),
		);
		this.register(
			writeShellStdinResource,
			new LocalWriteShellStdinExecutor(backgroundShellManager),
		);
		this.register(fetchResource, new StubFetchExecutor());
		this.register(diagnosticsResource, new StubDiagnosticsExecutor());
		this.register(mcpResource, new LocalMcpExecutor(ctx));
		this.register(listMcpResourcesResource, new StubListMcpResourcesExecutor());
		this.register(readMcpResourceResource, new StubReadMcpResourceExecutor());
		this.register(recordScreenResource, new StubRecordScreenExecutor());
		this.register(computerUseResource, new StubComputerUseExecutor());
	}
}
