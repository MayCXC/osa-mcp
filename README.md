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

osa-mcp serves every scriptable app on your Mac through two tools:

- **`search`** runs JavaScript over the scripting dictionaries of all the apps, which it reads from your Mac on every search, so apps you install, update or remove show up without a restart. Your AI writes an async arrow function over `apps`, where each app has the commands, classes, record types, value types and enumerations its dictionary defines.
- **`execute`** runs JXA or AppleScript on your Mac. A string result comes back as it is, and any other value as source text, so lists, records and object references stay whole.

Your AI reads only what its code selects, so osa-mcp stays light in its context however many apps you have. On a Mac with 33 scriptable apps, the two tools take 21 tokens when the client loads tool definitions on demand, as Claude Code does, and about 2,100 when it loads them all up front.

## Examples

A search for the Mail commands whose descriptions mention a mailbox:

```js
async () => apps.find(a => a.name === 'Mail').commands
  .filter(c => c.description.toLowerCase().includes('mailbox'))
  .map(c => c.name)
```

A JXA script for the names of the disks Finder sees:

```js
Application("Finder").disks.name()
```

## Install from source

```sh
git clone https://github.com/MayCXC/osa-mcp.git
cd osa-mcp
bun install
claude mcp add my-mac -- bun "$PWD/src/mcp.ts"
```

Requires [Bun](https://bun.sh).

## License

BSD 3-Clause. See [LICENSE](LICENSE).
