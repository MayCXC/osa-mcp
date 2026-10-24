# osa-mcp

*Give your AI access to every scriptable app on your Mac.*

osa-mcp is an MCP server that automatically discovers all scriptable macOS apps (Mail, Calendar, Finder, Music, Notes, Safari, &c.) and serves their scripting dictionaries to your AI. No configuration, no hardcoded app list. Just connect and go.

## What you do

### npx

```sh
claude mcp add my-mac -- npx -y osa-mcp
```

### bunx

```sh
claude mcp add my-mac -- bunx osa-mcp
```

### Homebrew

```sh
brew install MayCXC/osa-mcp/osa-mcp
claude mcp add my-mac -- osa-mcp
```

### Remote Mac via SSH

If your AI runs on a different machine, connect to your Mac over SSH. Enable [Remote Login in System Settings > General > Sharing](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac) first.

```sh
claude mcp add my-mac -- npx -y osa-mcp --ssh user@macbook.local
```

### JSON config

All of the above can also be added to your MCP settings file directly:

```json
{
  "mcpServers": {
    "my-mac": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "osa-mcp"]
    }
  }
}
```

For SSH, add `"--ssh", "user@macbook.local"` to the args.

## What you get

osa-mcp loads the scripting dictionary of every scriptable app in a few seconds and serves them all through five tools:

- **`dictionary`** browses the dictionaries. With no arguments it lists the apps; with an app, that app's suites, commands and classes, one line each; with an app and a term, the full definition of a command, class or record; with a query, the matching commands, classes and properties in every app.
- **`command`** runs a command: `{ "app": "Mail", "command": "check for new mail" }`.
- **`list`** reads the elements of a class with their properties: `{ "app": "Reminders", "class": "reminder" }`.
- **`get`** reads one element by index, name or id, or with no class, the application's own properties: `{ "app": "Music" }` returns the current track, player state, etc.
- **`execute`** runs any AppleScript or JXA.

Your AI looks up only the parts of a dictionary it needs, so osa-mcp stays light in its context however many apps you have. On a Mac with 33 scriptable apps, the tools and the server's instructions take about 350 tokens when the client loads tool definitions on demand, as Claude Code does, and about 2,300 when it loads them all up front.

## Navigating the object hierarchy

`list` and `get` accept a `parent` path for reaching into nested objects:

```jsonc
// Events in a specific calendar
{ "app": "Calendar", "class": "event", "parent": ["calendars", "byName", ["Work"]] }

// Messages in the inbox
{ "app": "Mail", "class": "message", "parent": ["inbox"] }

// Tabs of the first window
{ "app": "Safari", "class": "tab", "parent": ["windows", 0] }
```

Path steps: `"key"` accesses a property, `0` accesses by index, `[]` calls a method, `["arg"]` calls with arguments.

## Install from source

```sh
git clone https://github.com/MayCXC/osa-mcp.git
cd osa-mcp
bun install
bun link
claude mcp add my-mac -- osa-mcp
```

Requires [Bun](https://bun.sh).

## License

BSD 3-Clause. See [LICENSE](LICENSE).
