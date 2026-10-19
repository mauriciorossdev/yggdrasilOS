import { defineTool } from "@yggdrasil/tools-sdk";

type WttrCurrentCondition = {
  temp_C: string;
  FeelsLikeC: string;
  humidity: string;
  windspeedKmph: string;
  weatherDesc: Array<{ value: string }>;
};

type WttrArea = {
  areaName: Array<{ value: string }>;
  country: Array<{ value: string }>;
};

type WttrResponse = {
  current_condition?: WttrCurrentCondition[];
  nearest_area?: WttrArea[];
};

export const getWeatherTool = defineTool({
  name: "get_weather",
  description:
    'Gets current real weather conditions for a location, via wttr.in (no API key, one HTTP request — much faster than browsing a weather website). Include country/region for ambiguous city names (e.g. "Santiago, Chile" not just "Santiago") — the response\'s resolvedLocation tells you what it actually matched, so you can catch and mention it if it resolved somewhere unexpected.',
  riskLevel: "safe",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: 'City name, optionally with country/region, e.g. "Santiago, Chile"',
      },
    },
    required: ["location"],
  },
  async execute(_ctx, args) {
    const location = String(args.location ?? "").trim();
    if (!location) throw new Error('"location" is required');

    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`);
    if (!res.ok) throw new Error(`wttr.in request failed: HTTP ${res.status}`);
    const data = (await res.json()) as WttrResponse;

    const area = data.nearest_area?.[0];
    const current = data.current_condition?.[0];
    if (!area || !current) throw new Error(`wttr.in returned no weather data for "${location}"`);

    return {
      resolvedLocation: [area.areaName?.[0]?.value, area.country?.[0]?.value].filter(Boolean).join(", "),
      temperatureC: Number(current.temp_C),
      feelsLikeC: Number(current.FeelsLikeC),
      condition: current.weatherDesc?.[0]?.value ?? "unknown",
      humidityPercent: Number(current.humidity),
      windKmph: Number(current.windspeedKmph),
    };
  },
});
