# pi-cursor-auth

A [Pi coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that lets you use Cursor's AI models as a provider.

## What it does

- Authenticates with your Cursor account via OAuth
- Registers a `cursor-agent` provider with full bidirectional agent streaming
- Refreshes Cursor's usable model list for the Pi model picker
- Supports thinking models, max mode, and `.cursorrules` files

## Cursor tool parity

This extension uses Cursor's agent protocol for native tools (`bash`, `read`, `write`, `delete`, `ls`, `grep`, `lsp`, `todo`). Tool activity is emitted as structured Pi events while streaming and persisted as compact text summaries after Cursor has executed the tools, preventing Pi from executing them a second time. Runtime custom MCP advertising is currently limited to `ask_user_question`, and only when interactive UI is available; other MCP/custom tools are intentionally hidden.

## Install

```
pi install git:github.com/carlosarraes/pi-cursor-auth
```

Requires the peer Pi packages (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui`) >= 0.78.0.

## Usage

```
/login cursor
```

Then select any Cursor model from the model picker.

## Credits

Based on [pi-cursor-agent](https://github.com/sudosubin/pi-frontier/tree/main/pi-cursor-agent). I ran into some issues with cursor-agent on my setup, so I forked the auth and streaming logic into this extension. Thanks for the original work!

## License

MIT
