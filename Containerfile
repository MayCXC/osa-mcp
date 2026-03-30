# osa-mcp: MCP server for macOS scripting via OSA (AppleScript/JXA)
#
# Discovers scriptable apps via Launch Services, generates MCP tools
# from sdef files. Connects locally on macOS or remotely via SSH.
#
# Usage:
#   docker run -i --rm osa-mcp                       # local macOS
#   docker run -i --rm osa-mcp --ssh user@host       # remote

FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY src/ src/
COPY package.json .

USER bun
ENTRYPOINT ["bun", "run", "src/mcp.ts"]
