// Language server status, apart from service.ts so Settings can read it without loading Monaco.
export type LspStatus = {
  trusted: boolean;
  servers: Array<{ id: string; languages: string[]; status: "available" | "missing" | "needsTrust" | "notApplicable" | "running"; installHint?: string; error?: string }>;
};

export function fetchLspStatus(): Promise<LspStatus> {
  return window.yggdrasil.lsp.status() as Promise<LspStatus>;
}
