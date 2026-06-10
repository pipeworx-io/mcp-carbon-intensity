interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * UK National Grid Carbon Intensity MCP.
 *
 * Live GB electricity grid carbon-intensity (gCO2/kWh) and generation-mix data
 * from the official National Grid ESO Carbon Intensity API
 * (api.carbonintensity.org.uk). National + regional (14 GB DNO regions, by
 * postcode outcode), current + half-hourly time ranges. Keyless.
 */


const BASE = 'https://api.carbonintensity.org.uk';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';
const HEADERS = { Accept: 'application/json', 'User-Agent': UA };

interface IntensityBlock {
  from?: string;
  to?: string;
  intensity?: { forecast?: number | null; actual?: number | null; index?: string };
}

interface GenMixEntry {
  fuel?: string;
  perc?: number;
}

/** Map an intensity block → { from, to, forecast, actual, index }. */
function mapIntensity(b: IntensityBlock | undefined) {
  return {
    from: b?.from ?? null,
    to: b?.to ?? null,
    forecast: b?.intensity?.forecast ?? null,
    actual: b?.intensity?.actual ?? null,
    index: b?.intensity?.index ?? null,
  };
}

/** Map a generationmix array → sorted [{ fuel, percent }] (desc by percent). */
function mapGenMix(mix: GenMixEntry[] | undefined) {
  const list = Array.isArray(mix) ? mix : [];
  return list
    .map((m) => ({ fuel: m.fuel ?? null, percent: m.perc ?? null }))
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
}

const tools: McpToolExport['tools'] = [
  {
    name: 'current_intensity',
    description:
      'Get the current GB electricity grid carbon intensity (gCO2/kWh) for the present half-hour settlement period: forecast, actual (null for future periods), and the qualitative index (very low → very high). National (GB-wide) figure from the National Grid ESO Carbon Intensity API. Keyless.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'generation_mix',
    description:
      'Get the current GB electricity generation mix — the percentage share of each fuel (gas, coal, biomass, nuclear, hydro, wind, solar, imports, other) for the present half-hour, sorted by share descending. Keyless.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'intensity_range',
    description:
      'Get half-hourly GB carbon intensity (forecast + actual + index) over a time range, up to a 14-day span. Returns the first 96 half-hour periods (48h); flags periods_truncated if the range yields more. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Range start, ISO8601, e.g. "2026-06-01T00:00Z". Required.',
        },
        to: {
          type: 'string',
          description: 'Range end, ISO8601, e.g. "2026-06-02T00:00Z". Required. Max 14 days after "from".',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'regional_intensity',
    description:
      'Get GB regional carbon intensity + generation mix. With an outcode (UK postcode prefix like "RG41" or "SW1"), returns that region\'s forecast, index, and top-5 fuel mix. Without one, returns all 14 GB DNO regions with forecast + index. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        outcode: {
          type: 'string',
          description:
            'UK postcode outcode (first part of a postcode), e.g. "RG41", "SW1". If omitted, returns all 14 GB regions.',
        },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'current_intensity':
        return currentIntensity();
      case 'generation_mix':
        return generationMix();
      case 'intensity_range':
        return intensityRange(args);
      case 'regional_intensity':
        return regionalIntensity(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchJson(path: string): Promise<Record<string, unknown> | { error: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
  if (!res.ok) return { error: `carbon-intensity: ${res.status} ${(await res.text()).slice(0, 200)}` };
  return (await res.json()) as Record<string, unknown>;
}

async function currentIntensity(): Promise<unknown> {
  const json = await fetchJson('/intensity');
  if ('error' in json) return json;
  const block = (json.data as IntensityBlock[] | undefined)?.[0];
  if (!block) return { error: 'no intensity data returned' };
  return mapIntensity(block);
}

async function generationMix(): Promise<unknown> {
  const json = await fetchJson('/generation');
  if ('error' in json) return json;
  const data = json.data as { from?: string; to?: string; generationmix?: GenMixEntry[] } | undefined;
  if (!data) return { error: 'no generation data returned' };
  return {
    from: data.from ?? null,
    to: data.to ?? null,
    mix: mapGenMix(data.generationmix),
  };
}

async function intensityRange(args: Record<string, unknown>): Promise<unknown> {
  const from = typeof args.from === 'string' ? args.from.trim() : '';
  const to = typeof args.to === 'string' ? args.to.trim() : '';
  if (!from || !to) return { error: 'provide both "from" and "to" (ISO8601)', from: args.from ?? null, to: args.to ?? null };

  const json = await fetchJson(`/intensity/${encodeURIComponent(from)}/${encodeURIComponent(to)}`);
  if ('error' in json) return json;
  const blocks = (json.data as IntensityBlock[] | undefined) ?? [];
  const truncated = blocks.length > 96;
  const periods = blocks.slice(0, 96).map(mapIntensity);
  return {
    from,
    to,
    count: periods.length,
    ...(truncated ? { periods_truncated: true } : {}),
    periods,
  };
}

async function regionalIntensity(args: Record<string, unknown>): Promise<unknown> {
  const outcode = typeof args.outcode === 'string' ? args.outcode.trim() : '';

  if (outcode) {
    const json = await fetchJson(`/regional/postcode/${encodeURIComponent(outcode)}`);
    if ('error' in json) return json;
    const region = (json.data as Array<Record<string, unknown>> | undefined)?.[0];
    if (!region) return { error: 'no region data returned', outcode };
    const intensity = region.intensity as IntensityBlock['intensity'];
    return {
      postcode: region.postcode ?? outcode,
      region: region.shortname ?? null,
      forecast: intensity?.forecast ?? null,
      index: intensity?.index ?? null,
      mix: mapGenMix(region.generationmix as GenMixEntry[] | undefined).slice(0, 5),
    };
  }

  const json = await fetchJson('/regional');
  if ('error' in json) return json;
  const regions = (json.data as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    count: regions.length,
    regions: regions.map((r) => {
      const intensity = r.intensity as IntensityBlock['intensity'];
      return {
        regionid: r.regionid ?? null,
        shortname: r.dnoregion ?? r.shortname ?? null,
        forecast: intensity?.forecast ?? null,
        index: intensity?.index ?? null,
      };
    }),
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
