export type PostInboundOptions = {
  message: string;
  sessionKey: string;
  headers?: Record<string, string>;
  accept?: string;
};

export type PostInboundResult = {
  status: number;
  body: unknown;
  text: string;
  events?: Array<{ event: string; data: unknown }>;
};

export async function postInbound(
  baseUrl: string,
  options: PostInboundOptions,
): Promise<PostInboundResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (options.accept) {
    headers.Accept = options.accept;
  }

  const response = await fetch(`${baseUrl}/inbound`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message: options.message,
      sessionKey: options.sessionKey,
    }),
  });

  const text = await response.text();

  if (options.accept?.includes("text/event-stream")) {
    const events = parseSse(text);
    return { status: response.status, body: events, text, events };
  }

  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // keep raw text
  }

  return { status: response.status, body, text };
}

function parseSse(raw: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = raw.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    let event = "message";
    let dataLine = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) dataLine = line.slice(5).trim();
    }
    if (dataLine) {
      try {
        events.push({ event, data: JSON.parse(dataLine) as unknown });
      } catch {
        events.push({ event, data: dataLine });
      }
    }
  }
  return events;
}
