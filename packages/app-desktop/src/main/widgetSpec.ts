// Pure parsing of a complemento's `widget` manifest block and its `net:<domain>`
// permissions (notes/features/dashboard.md). No Electron imports: unit-tested,
// and used by both the scanner and the net layer.

export type WidgetSize = "s" | "m" | "l";
export const WIDGET_SIZES: WidgetSize[] = ["s", "m", "l"];

export type WidgetFieldType = "text" | "number" | "bool" | "list" | "secret";

export type WidgetField = {
  key: string;
  type: WidgetFieldType;
  title: string;
  description?: string;
  default?: string | number | boolean;
  required?: boolean;
  /** `list` only. */
  options?: { value: string; label: string }[];
  /** `secret` only: the one host this secret may be sent to, and how. */
  domain?: string;
  header?: string;
  /** Prepended to the secret in the header, e.g. "Bearer ". */
  prefix?: string;
};

export type WidgetRefresh = { defaultSeconds: number; minSeconds: number };

export type WidgetSpec = { defaultSize: WidgetSize; refresh: WidgetRefresh; fields: WidgetField[] };

/** 0 = only when the user presses refresh. */
export const REFRESH_OPTIONS = [900, 1800, 3600, 21600, 86400, 0];
const MIN_REFRESH_FLOOR = 900;
const DEFAULT_REFRESH = 3600;

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const FIELD_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/;
// Headers that would change where the request goes or how it is framed.
const FORBIDDEN_HEADERS = new Set(["host", "cookie", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "keep-alive", "proxy-authorization"]);

export function isPublicHostName(host: string): boolean {
  return HOST_RE.test(host) && !host.endsWith(".local") && !host.endsWith(".localhost") && !host.endsWith(".internal");
}

/** The exact hosts a manifest asks to reach ("net:api.github.com"). No wildcards. */
export function netDomains(permissions: readonly string[] | undefined): string[] {
  const out = (permissions ?? [])
    .filter((p) => p.startsWith("net:"))
    .map((p) => p.slice(4))
    .filter(isPublicHostName);
  return [...new Set(out)];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseField(key: string, raw: unknown, domains: string[]): WidgetField {
  const f = record(raw);
  const fail = (why: string): never => {
    throw new Error(`manifest.json: campo "${key}" de widget.configSchema ${why}`);
  };
  if (!FIELD_KEY_RE.test(key)) fail("tiene un nombre inválido");
  const declared = f.type;
  const hasOptions = Array.isArray(f.options) || Array.isArray(f.enum);
  const type: WidgetFieldType =
    declared === "secret"
      ? "secret"
      : declared === "list" || hasOptions
        ? "list"
        : declared === "number" || declared === "integer"
          ? "number"
          : declared === "boolean" || declared === "bool"
            ? "bool"
            : declared === "string" || declared === "text" || declared === undefined
              ? "text"
              : fail(`tiene un tipo desconocido "${String(declared)}"`);
  const field: WidgetField = {
    key,
    type,
    title: typeof f.title === "string" && f.title ? f.title : key,
    description: typeof f.description === "string" && f.description ? f.description : undefined,
    required: f.required === true || type === "secret",
  };
  if (type === "list") {
    const source = (Array.isArray(f.options) ? f.options : Array.isArray(f.enum) ? f.enum : []) as unknown[];
    field.options = source.flatMap((o) => {
      if (typeof o === "string") return [{ value: o, label: o }];
      const item = record(o);
      return typeof item.value === "string"
        ? [{ value: item.value, label: typeof item.label === "string" ? item.label : item.value }]
        : [];
    });
    if (field.options.length === 0) fail('es una lista sin "options"');
  }
  if (type === "secret") {
    const domain = typeof f.domain === "string" ? f.domain : "";
    if (!domains.includes(domain)) fail(`necesita un "domain" que esté en permissions como net:<dominio>`);
    const sendAs = record(f.sendAs);
    const header = typeof sendAs.header === "string" ? sendAs.header : "";
    if (!HEADER_RE.test(header) || FORBIDDEN_HEADERS.has(header.toLowerCase())) fail('necesita "sendAs.header" válido');
    field.domain = domain;
    field.header = header;
    const prefix = typeof sendAs.prefix === "string" ? sendAs.prefix : "";
    if (prefix && !/^[A-Za-z0-9 _-]{1,20}$/.test(prefix)) fail('tiene un "sendAs.prefix" inválido');
    field.prefix = prefix || undefined;
  } else if (typeof f.default === "string" || typeof f.default === "number" || typeof f.default === "boolean") {
    field.default = f.default;
  }
  return field;
}

/** Throws on an invalid block, so the complemento shows as broken with the reason. */
export function parseWidgetSpec(raw: unknown, permissions: readonly string[]): WidgetSpec {
  const w = record(raw);
  const domains = netDomains(permissions);
  const refresh = record(w.refresh);
  const seconds = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback);
  const minSeconds = Math.max(MIN_REFRESH_FLOOR, seconds(refresh.minSeconds, MIN_REFRESH_FLOOR));
  const wanted = seconds(refresh.defaultSeconds, DEFAULT_REFRESH);
  const properties = record(record(w.configSchema).properties);
  return {
    defaultSize: WIDGET_SIZES.includes(w.defaultSize as WidgetSize) ? (w.defaultSize as WidgetSize) : "m",
    refresh: { minSeconds, defaultSeconds: wanted === 0 ? 0 : Math.max(minSeconds, wanted) },
    fields: Object.entries(properties).map(([key, value]) => parseField(key, value, domains)),
  };
}

/** The interval choices offered for an instance (those faster than the manifest allows are hidden). */
export function refreshChoices(spec: WidgetSpec): number[] {
  return REFRESH_OPTIONS.filter((s) => s === 0 || s >= spec.refresh.minSeconds);
}

export function clampRefresh(seconds: number, spec: WidgetSpec): number {
  if (seconds === 0) return 0;
  return Number.isFinite(seconds) ? Math.max(spec.refresh.minSeconds, Math.round(seconds)) : spec.refresh.defaultSeconds;
}
