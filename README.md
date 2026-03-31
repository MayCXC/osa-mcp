# osa-mcp

*Give your AI access to every scriptable app on your Mac.*

osa-mcp is an MCP server that automatically discovers all scriptable macOS apps (Mail, Calendar, Finder, Music, Notes, Safari, &c.) and generates tools for them. No configuration, no hardcoded app list. Just connect and go.

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

If your AI runs on a different machine, connect to your Mac over SSH. Enable Remote Login in System Settings > General > Sharing first.

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

On a typical Mac, osa-mcp generates ~700 tools in ~4 seconds. Every tool includes descriptions pulled from the app's scripting dictionary, so your AI knows what each tool does, what parameters it takes, and what values they accept.

**Commands** let your AI perform actions:
- `mail_send`, `mail_reply`, `mail_forward`
- `finder_reveal`, `finder_move`, `finder_duplicate`
- `music_play`, `music_pause`, `music_search`
- `calendar_show`, `reminders_show`, `notes_show`
- `safari_do_javascript`, `safari_search_the_web`
- `messages_send`, `terminal_do_script`

**Lists and gets** let your AI read data:
- `mail_list_messages`, `mail_get_message`
- `calendar_list_events`, `calendar_list_calendars`
- `finder_list_files`, `finder_list_disks`
- `notes_list_notes`, `reminders_list_reminders`
- `safari_list_tabs`, `safari_list_documents`

**Application properties** expose app settings:
- `mail_get_application` returns inbox, fetch interval, primary email, etc.
- `finder_get_application` returns desktop, trash, home, startup disk, etc.
- `music_get_application` returns current track, player state, etc.

**Execute** runs arbitrary JXA or AppleScript for anything the generated tools don't cover.

## Navigating the object hierarchy

Many tools accept a `parent` parameter for navigating into nested objects:

```jsonc
// List events in a specific calendar
{ "parent": ["calendars", "byName", ["Work"]] }

// List messages in the inbox
{ "parent": ["inbox"] }

// Get the first window's current tab
{ "parent": ["windows", 0] }
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
