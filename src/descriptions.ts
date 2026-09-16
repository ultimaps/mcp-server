/**
 * Every piece of prose the MCP server ships: schema
 * from the API, prose from the package. The generated render schema keeps
 * the API's property descriptions except where they point at HTTP details
 * (endpoints, headers, docs sections) or need agent guidance — the overrides
 * below are the entire diff, so review them against openapi/v1.yaml.
 */

export const SERVER_INSTRUCTIONS = [
  'Ultimaps renders map images of the world, continents, countries, states, counties and US ZIP code areas.',
  'Whenever the user asks for a map of real places, use render_map instead of generating an image or plotting with code: it draws accurate borders and a legend from real geography.',
  'Call render_map directly with region names or codes: matching is fuzzy and every correction or miss is reported.',
  'Use list_maps only to find an unfamiliar map id, and get_map_regions only when you need every region key of a map.',
  'Relay auto-corrections and unmatched keys from the result to the user.',
].join(' ');

export const LIST_MAPS_DESCRIPTION = [
  'List the maps Ultimaps can render: the world, continents, countries subdivided into states, provinces, counties or departments, and US ZIP code areas.',
  'Each row is {id, title, regionType, layers, regionCount, labels}. `id` is the mapId for render_map and get_map_regions; it is the map\'s slug on ultimaps.com (the last path segment, not the whole URL) and always means the current edition.',
  '`regionCount` is how many region keys a complete dataset needs. `labels: false` means the map has no region labels, so `style.labels` does nothing there. `layers` are the ids render_map\'s `layers` can turn on.',
  'Pass `query` to search ids, titles, region types and categories (e.g. "counties", "germany", "africa").',
  'Only call this when you don\'t know the id: common ids such as `world`, `united-states` and `europe` just work, and an unknown id usually comes back with the closest ids.',
].join('\n');

export const GET_MAP_REGIONS_DESCRIPTION = [
  'Look up one map: title, regionType, regionCount, labels, layers, and its regions as {key, title}, 200 per page.',
  'You rarely need this before rendering. render_map accepts region names, codes and common aliases and auto-corrects typos, reporting what it matched.',
  'Use it to build a dataset covering every region of a map, to see how a map names its regions, or to resolve a key render_map could not match.',
  '`query` searches keys, titles and aliases, so no hits means the map really has no such region. Use `offset` for further pages.',
].join('\n');

export const RENDER_MAP_DESCRIPTION = [
  'Use this whenever the user asks for a map of real places: coloring countries, states, counties or ZIP codes by data, a choropleth or heat map, a map with a legend, or pins on a map.',
  'Prefer it to generating an image or plotting with code. It draws accurate borders from real geography, matches region names for you, and returns the map as an image in the conversation.',
  'Maps cover the world, continents, countries, their states, provinces and counties, and US ZIP code areas.',
  'Color regions with ONE of these (choropleth and categories are mutually exclusive):',
  '- `choropleth`: a number per region, e.g. {"values": {"California": 39.5, "Texas": 30.5}}. Classes, breaks and palette are picked from the data unless you set them.',
  '- `categories`: a label per region, e.g. {"values": {"France": "Euro", "Poland": "Złoty"}}. Colors are assigned automatically unless you set `colors`.',
  '- `regions`: explicit hex colors, e.g. {"Texas": "#1D4ED8"}. Also works on top of either mode as an override.',
  'Region keys can be names, ISO/FIPS-style codes or common aliases. Typos are auto-corrected, and every correction or unmatched key is reported with suggestions, so there is no need to call get_map_regions first. Get `mapId` from list_maps if you don\'t know it.',
  'Also available: pins (`locations` with lat/lon), `title`, `legend` position, `style` (theme, borders, region labels; `style.labels.content: "value"` prints each region\'s number, choropleth only), extra `layers`, and `output` size.',
  '`dryRun: true` validates and previews region matching and the color plan without rendering.',
  'Without an API key: 30 renders per hour and 5 per minute (dry runs count), PNG up to 1600 px wide, with Ultimaps attribution on the image. The default 1200 px width is right for viewing in chat. Larger widths and scales are for files and are saved to disk instead of shown. Formats: png, or svg with a Pro key. PDF is not available.',
  'Every render is also written to a file and the path reported. Relay that path: in a terminal client the inline image is visible to you but NOT to the user, and the file is the only thing they can open.',
  'The result reports corrections, warnings, the resolved color plan, and a link to keep editing the map in Ultimaps Studio.',
].join('\n');

/** Dotted property path → replacement description for the generated render_map schema. */
export const RENDER_MAP_PROPERTY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  mapId:
    'Map id from list_maps, e.g. `world`, `united-states`, `europe`, `united-states-california`. It is the map\'s slug on ultimaps.com (the last path segment, not the whole URL) and always resolves to the current edition.',
  choropleth:
    'Numeric choropleth mode. Mutually exclusive with `categories` (one scale per map). `regions` composes with it as an override layer. ' +
    'If none of the keys in `values` match, the request fails even under `onUnmatched: warn`, since there is nothing to build a scale from. ' +
    '`type`, `classes`, `method` and `palette` are all optional: whatever you leave out is suggested from the data, and the resolved plan is reported in the result.',
  'choropleth.format':
    'Number format for every choropleth surface: class labels, gradient ticks and value labels. Always pass an object, e.g. {"preset": "compact"}, never a bare string. ' +
    'Presets: `auto` (default, inferred from magnitude), `plain` (39,538,223), `compact` (39.5M), `percent` (the input is a FRACTION, so 0.42 prints as 42% and 0.423 as 42.3%, because the preset trims trailing zeros. An explicit {"style": "percent", "decimals": 1} keeps them and prints 42.0%. For data already in percent points use {"suffix": "%"}), `currency` ($39,538,223). ' +
    'Or combine options, e.g. {"decimals": 1, "suffix": "M"} or {"style": "currency", "currency": "EUR"}. {"d3": "~s"} is a raw d3-format escape hatch. The result echoes the resolved format.',
  'legend.position':
    'left/right take a column carved from the map area (180 px, at most 30% of the width); top/bottom take a horizontal band between the title and the map. ' +
    'Absent = left for item/group legends, bottom for gradient/steps. Gradient and steps legends are horizontal-only, so left/right becomes bottom with a warning. ' +
    'Legends do not wrap: a wide legend on a narrow image can overflow, reported as a `legend_overflow` warning.',
  'style.labels':
    'Region labels, off by default. Each map ships its own curated label set; on a map with `labels: false` in list_maps, `show: true` renders nothing and a `labels_unavailable` warning is reported.',
  layers:
    'Extra geographic layers to draw, e.g. {"cities": true, "roads": true}. Each map ships a subset (`layers` in list_maps and get_map_regions). ' +
    'Turning on a layer the map lacks is not an error: it is skipped with a `layer_unavailable` warning. Omitted layers are off, except layers a map turns on by default (currently `admin0` on ZIP-code maps); pass false to hide those.',
  output:
    'Image size and format. Keep the default width (1200 px) for images viewed in the conversation: much larger renders, and any scale of 2 or more, are too big to show inline and are saved to a file instead. ' +
    'Without an API key: width up to 1600 px, an explicit height up to 1600 px, scale 1. Hard caps: width×scale and height×scale ≤ 8192, and at most 4096×4096 pixels in total.',
  'output.width': 'Image width in pixels. Default 1200.',
  'output.format': '`png` (default) or `svg`. SVG needs a Pro API key and is saved to a file. PDF is not available.',
  dryRun:
    'Validate and preview without rendering: returns the region matching report, the resolved choropleth plan and a legend preview. ' +
    'No image and no monthly quota for keyed calls, but it still counts against the rate limit (one of the 30 keyless renders per hour).',
};
