# mcp-carbon-intensity

UK National Grid Carbon Intensity MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 853+ live data sources.

## Tools

| Tool | Description |
|------|-------------|

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "carbon-intensity": {
      "url": "https://gateway.pipeworx.io/carbon-intensity/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 853+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Carbon Intensity data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
