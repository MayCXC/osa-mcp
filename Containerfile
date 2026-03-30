# osa-mcp: MCP server for macOS scripting via OSA (AppleScript/JXA)
#
# Discovers scriptable apps via Launch Services, generates MCP tools
# from sdef files. Connects locally on macOS or remotely via SSH.
#
# Usage:
#   docker run -i --rm osa-mcp                       # local macOS
#   docker run -i --rm osa-mcp --ssh user@host       # remote

FROM oven/bun:slim AS base
WORKDIR /app

FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock* /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile 2>/dev/null || cd /temp/prod && bun install

FROM base
COPY --from=install /temp/prod/node_modules node_modules
COPY package.json src/ ./src/
USER bun
ENTRYPOINT ["bun", "run", "src/mcp.ts"]
