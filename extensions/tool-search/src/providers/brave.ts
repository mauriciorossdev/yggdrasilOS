export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export async function braveSearch(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const res = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) {
    throw new Error(`Brave Search API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }));
}
