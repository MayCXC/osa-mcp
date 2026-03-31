FROM gcr.io/distroless/base-nossl-debian13
COPY osa-mcp /osa-mcp
ENTRYPOINT ["/osa-mcp"]
