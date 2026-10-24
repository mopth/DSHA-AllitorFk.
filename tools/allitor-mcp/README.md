# allitor-mcp

AllitorFk agent tools as a stdio MCP server (own implementation, MIT). It talks to the AllitorFk Web
process over `/root/.dsh/allitor/agent.sock` with the 0600 token in `agent.token`; it has no network
listener. Tiers: `read` (no side effects), `request` (asks the user), `act` (works only while the user
has granted that scope in the AllitorFk console at `/__dsha/allitor`; the Web process enforces it).

Add to DSH as an MCP server: command `allitor-mcp`, no arguments.

Not included (browser toolset subset): JavaScript execution, POST forms, cookies/logins, screenshots,
downloads, private-network or loopback targets.
