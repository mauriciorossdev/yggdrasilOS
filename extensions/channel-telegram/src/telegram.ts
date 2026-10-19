export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: { id: number };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result: T;
  description?: string;
};

export async function telegramGetUpdates(
  botToken: string,
  offset: number,
  timeoutSec = 0,
): Promise<TelegramUpdate[]> {
  const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("timeout", String(timeoutSec));
  const res = await fetch(url);
  const data = (await res.json()) as TelegramApiResponse<TelegramUpdate[]>;
  if (!data.ok) {
    throw new Error(data.description ?? "Telegram getUpdates failed");
  }
  return data.result;
}

export async function telegramSendMessage(
  botToken: string,
  chatId: string | number,
  text: string,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096) }),
  });
  const data = (await res.json()) as TelegramApiResponse<unknown>;
  if (!data.ok) {
    throw new Error(data.description ?? "Telegram sendMessage failed");
  }
}

export function parseChatIdFromSessionKey(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts.length < 3 || parts[0] !== "telegram") return undefined;
  return parts.slice(2).join(":");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
