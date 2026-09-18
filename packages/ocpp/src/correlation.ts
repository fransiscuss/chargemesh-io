export type PendingCall = { action: string; ts: number };

export class PendingCalls {
  private readonly entries = new Map<string, PendingCall>();
  constructor(private readonly now: () => number = Date.now) {}
  get size(): number {
    return this.entries.size;
  }
  add(id: string, action: string, ts: number = this.now()): void {
    this.entries.set(id, { action, ts });
  }
  resolve(id: string): PendingCall | undefined {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    return entry;
  }
  sweep(now: number = this.now(), maxAgeMs = 120_000): void {
    for (const [id, call] of this.entries) {
      if (now - call.ts > maxAgeMs) this.entries.delete(id);
    }
  }
}
