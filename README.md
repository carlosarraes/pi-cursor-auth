# pi-cursor-auth

A [Pi coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that lets you use Cursor's AI models as a provider.

## What it does

- Authenticates with your Cursor account via OAuth
- Registers a `cursor-agent` provider with full bidirectional agent streaming
- Refreshes Cursor's usable model list for the Pi model picker
- Supports thinking models, max mode, and `.cursorrules` files

## Cursor tool parity

This extension uses Cursor's agent protocol for native tools (`bash`, `read`, `write`, `delete`, `ls`, `grep`, `lsp`, `todo`) and emits structured Pi tool-call blocks so tool usage is visible in transcripts. Non-native MCP/custom tools are advertised only when the extension can execute them; unsupported tools are intentionally hidden instead of being advertised and failing at runtime.

## Install

```
pi install git:github.com/carlosarraes/pi-cursor-auth
```

Requires `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` >= 0.49.0.

## Usage

```
/login cursor
```

Then select any Cursor model from the model picker.

## Credits

Based on [pi-cursor-agent](https://github.com/sudosubin/pi-frontier/tree/main/pi-cursor-agent). I ran into some issues with cursor-agent on my setup, so I forked the auth and streaming logic into this extension. Thanks for the original work!

## License

MIT
