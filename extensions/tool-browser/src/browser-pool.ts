import { chromium, type Browser, type Page } from "playwright";

const pages = new Map<string, Page>();
let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

export async function getPage(sessionKey: string): Promise<Page> {
  const existing = pages.get(sessionKey);
  if (existing) return existing;
  const b = await getBrowser();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  pages.set(sessionKey, page);
  return page;
}

export async function closeAll(): Promise<void> {
  await browser?.close();
  browser = null;
  pages.clear();
}
