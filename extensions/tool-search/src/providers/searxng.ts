export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export async function searxngSearch(query: string, count: number, baseUrl: string): Promise<SearchResult[]> {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");

  const res = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`SearXNG error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (data.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.content ?? "",
  }));
}
