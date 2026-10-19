export type TurnLogEntry = {
  sessionKey: string;
  harnessId?: string;
  agentId?: string;
  classification?: string;
  durationMs?: number;
  timestamp: number;
};

const MAX_ENTRIES = 50;
const entries: TurnLogEntry[] = [];

export function pushTurnLog(entry: TurnLogEntry): void {
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
}

export function getTurnLogSnapshot(): TurnLogEntry[] {
  return [...entries];
}

export function clearTurnLog(): void {
  entries.length = 0;
}
