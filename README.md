# osa-mcp

MCP server that discovers scriptable macOS apps and generates tools from their scripting definitions (sdef).

Connects locally or remotely via SSH. No hardcoded app list. At startup it queries Launch Services, loads every sdef with XInclude resolution, parses commands/classes/enums/properties, and registers MCP tools dynamically.

## What it does

On a Mac with 31 scriptable apps installed, osa-mcp generates ~700 tools at startup in ~4 seconds:

- **Command tools** from sdef commands (e.g. `mail_send`, `finder_reveal`, `music_play`)
- **List tools** from sdef classes (e.g. `mail_list_messages`, `calendar_list_events`)
- **Get tools** from sdef classes (e.g. `finder_get_disk`, `notes_get_note`)
- **Application tools** for root properties (e.g. `mail_get_application` returns inbox, fetch interval, etc.)
- **Execute tool** for arbitrary JXA or AppleScript

Properties from different suites (Standard Suite + app-specific) are merged per class. Type mapping uses ScriptingBridge's intrinsics.sdef for canonical Apple type resolution. Synonym handling follows appscript's parsing rules.

## Usage

```sh
# local macOS
osa-mcp

# remote via SSH
osa-mcp --ssh user@host

# or via environment variable
OSA_SSH_HOST=user@host osa-mcp
```

### Claude Code

Add to your MCP settings:

```json
{
  "mcpServers": {
    "macbook": {
      "type": "stdio",
      "command": "osa-mcp",
      "args": ["--ssh", "user@host"]
    }
  }
}
```

### Docker

```sh
docker build -t osa-mcp .
docker run -i --rm osa-mcp --ssh user@host
```

## Install

Requires [Bun](https://bun.sh).

```sh
git clone https://github.com/MayCXC/osa-mcp.git
cd osa-mcp
bun install
bun link
```

## How it works

1. **Discovery**: A JXA script runs on the macOS host via `osascript`. It uses `NSMetadataQuery` to find all app bundles with scripting definitions, loads each sdef via `NSXMLDocument` with XInclude resolution, and loads `intrinsics.sdef` from the ScriptingBridge framework.

2. **Parsing**: Sdef XML is parsed with Zod validation acting as a runtime DTD. Handles synonyms, class-extensions, record-types, value-types, and command deduplication following appscript's rules. The application class is separated as root properties, not a collection.

3. **Generation**: Parsed sdef is converted into FastMCP tool registrations. Type mapping uses intrinsics for number/boolean/string/array resolution, enums become Zod enums, class references become described strings.

4. **Execution**: Calls the JXA dispatch script locally or via SSH. Child processes are tracked and cleaned up on disconnect.

5. **Dispatch**: Handles `command`, `list`, `get`, and `execute` operations. List/get support structured path resolution for navigating the object hierarchy. Execute supports both JXA and AppleScript.

## Architecture

```
MCP client <--stdio--> mcp.ts <--spawn/ssh--> osascript dispatch.js
                         |
                    sdef.ts (parse)
                    generator.ts (register tools)
                    executor.ts (process lifecycle)
```

## License

BSD 3-Clause. See [LICENSE](LICENSE).
