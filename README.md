# pi-cursor-auth

A [Pi coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that lets you use Cursor's AI models as a provider.

## What it does

- Authenticates with your Cursor account via OAuth
- Registers a `cursor-agent` provider with full bidirectional agent streaming
- Supports thinking models, max mode, and `.cursorrules` files

## Install

```
pi install git:github.com/carlosarraes/pi-cursor-auth
```

Requires `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` >= 0.49.0.

## Usage

```
/login cursor
```

Then select any Cursor model from the model picker.

## Credits

Based on [pi-cursor-agent](https://github.com/sudosubin/pi-frontier/tree/main/pi-cursor-agent). I ran into some issues with cursor-agent on my setup, so I forked the auth and streaming logic into this extension. Thanks for the original work!

## License

MIT
