# @ultimaps/mcp

An [MCP](https://modelcontextprotocol.io) server for [Ultimaps](https://ultimaps.com). Ask Claude, Codex or any MCP client for a map and get the image back in the conversation. It covers choropleths from pasted numbers, category maps and pinned locations, for countries, states, provinces, counties, continents and the world.

> "Map US states by population." · "Color the EU members by currency." · "Show France's regions with these unemployment rates: …" · "Pin our five offices on a map of Europe."

No account needed. Without an API key the server uses the keyless tier; set `ULTIMAPS_API_KEY` for plan quotas and larger or unbranded output.

## Tools

| Tool | What it does |
|------|--------------|
| `render_map` | Renders a map as an image (PNG, or SVG with a Pro key), shown inline when it is small enough. Choropleth (numbers), categories (labels) or explicit colors, plus pins, title, legend, theme, labels and extra layers. Region names are matched fuzzily, and every correction or miss is reported with suggestions. `dryRun: true` previews matching and the color plan without rendering. |
| `list_maps` | The map catalog: `{id, title, regionType, layers, regionCount, labels}`, searchable with `query`. |
| `get_map_regions` | One map's region keys and titles, 200 per page, searchable by key, title or alias. |

All three are read-only. Agents rarely need the discovery tools: `render_map` accepts region names, codes and aliases directly.

## Install

Requires Node.js 20 or newer.

### Claude Code

```sh
claude mcp add ultimaps -- npx -y @ultimaps/mcp
# with a key:
claude mcp add ultimaps --env ULTIMAPS_API_KEY=um_live_… -- npx -y @ultimaps/mcp
```

### Codex

```sh
codex mcp add ultimaps -- npx -y @ultimaps/mcp
# with a key:
codex mcp add ultimaps --env ULTIMAPS_API_KEY=um_live_… -- npx -y @ultimaps/mcp
```

Codex writes TOML, not the JSON below. The equivalent entry in `~/.codex/config.toml` (or `.codex/config.toml` in a trusted project):

```toml
[mcp_servers.ultimaps]
command = "npx"
args = ["-y", "@ultimaps/mcp"]
```

### Claude Desktop

Download `ultimaps-<version>.mcpb` from the [latest release](https://github.com/ultimaps/mcp-server/releases/latest) and open it: Claude Desktop installs it in one click and asks for the optional API key. Or add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ultimaps": {
      "command": "npx",
      "args": ["-y", "@ultimaps/mcp"],
      "env": { "ULTIMAPS_API_KEY": "" }
    }
  }
}
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "ultimaps": { "command": "npx", "args": ["-y", "@ultimaps/mcp"] }
  }
}
```

### VS Code

`.vscode/mcp.json`:

```json
{
  "servers": {
    "ultimaps": { "type": "stdio", "command": "npx", "args": ["-y", "@ultimaps/mcp"] }
  }
}
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ULTIMAPS_API_KEY` | none (keyless) | API key from [Studio → Workspace → API](https://studio.ultimaps.com/account/workspace/api). An invalid key is an error and never falls back to keyless. |
| `ULTIMAPS_API_URL` | `https://api.ultimaps.com` | Point at a local API during development (`http://localhost:3001`). Plain http is only accepted for localhost. |

## Limits

| | Keyless | Free key | Pro key |
|---|---|---|---|
| Renders | 30/hour, 5/minute | 500/month, 50/day, 10/minute | 5,000/month, 1,000/day, 30/minute |
| Output | PNG up to 1600 px, attribution | PNG up to 1600 px at scale 2 (a 3200 px raster), attribution | PNG up to 4000 px at scale 4, SVG, no attribution |

All keys in a workspace share the monthly quota. The daily and per-minute caps are per key, so a free key stops at 50 renders a day long before the month runs out.

Dry runs skip the monthly quota but still count against rate limits. When five or fewer keyless renders remain in the hour, the result says so.

## What a render returns

- **The image**, inline, when it is small enough (781 KB for PNG, 98 KB for SVG). The default 1200 px width usually fits. Every render is also written to `<tmpdir>/ultimaps-mcp/` and the path is in the result, so in a terminal client the file is the thing you can actually open. Nothing is re-rendered or resampled on your behalf.
- **A text report**: auto-corrected and unmatched region keys with suggestions, the resolved choropleth plan, warnings (such as `layer_unavailable`), a link to open the map in Ultimaps Studio for editing, and the render id for support.
- **An embeddable image URL** for keyless PNG renders whose whole spec fits a ~2,000-character URL, so small datasets only. The URL carries the spec, not the image, and renders keyless, so it is not offered when a key is set.
- **`structuredContent`** with the same report as data, described by the tool's `outputSchema`.

## Privacy Policy

This server runs on your machine, has no telemetry of its own and talks only to the Ultimaps API (`https://api.ultimaps.com`, or the `ULTIMAPS_API_URL` you set). The full Ultimaps privacy policy is at [ultimaps.com/privacy-policy](https://ultimaps.com/privacy-policy/).

**What is sent to Ultimaps.** Tool calls are ordinary HTTPS requests to the Ultimaps API, so they arrive from your IP address with an `ultimaps-mcp/<version>` user agent. `render_map` sends the whole map request: region keys and values, pins, title and styling. If you set `ULTIMAPS_API_KEY`, it is sent with render requests only.

**What Ultimaps keeps.** Each render request is logged: the request content, the map and outcome, timing, your IP address and user agent, and for keyed requests which key and workspace made it. This lets support look up a render id, lets the "Open in Studio" link rebuild your map, and counts usage. The request content is kept for 30 days and the IP address and user agent for 90 days; what remains is a usage record, tied to your workspace when a key was used. Ultimaps uses a third-party error-monitoring service that may receive details of a failed request. Ultimaps does not sell this data or use it for advertising.

**What stays on your machine.** Every rendered image is written to `<tmpdir>/ultimaps-mcp/` and this server never deletes it. What your MCP client keeps, including tool results in your conversation, is governed by its own privacy policy.

**Shareable links.** The embeddable image URL offered for small keyless renders contains the full map request; anyone with the link can read it.

Questions or deletion requests: [support@ultimaps.com](mailto:support@ultimaps.com), quoting the render id.

## Development

```sh
npm install
npm run typecheck
npm test           # unit + in-process protocol tests
npm run build      # → dist/
```

End-to-end over stdio against a real API (spends render units from your tier):

```sh
npm run build
node scripts/smoke.mjs
```

`src/generated/render-request.schema.json` is generated from the Ultimaps API contract; do not edit it by hand. Tool and property descriptions live in `src/descriptions.ts`. Arguments are never validated locally: the API is additive-only, and its 400 responses carry suggestions.

Issues and pull requests are welcome. Releases are cut by the Ultimaps team, and accepted changes ship with the next release.

The package publishes a `bin` and nothing else. `import '@ultimaps/mcp'` is not
supported and fails by name, because `dist/index.js` starts a stdio server when
it loads.

## License

MIT © Ultimaps. See [LICENSE](./LICENSE).
