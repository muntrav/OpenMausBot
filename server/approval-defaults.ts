import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ApprovalDefaultAuditRow {
  at: string;
  actor: string;
  mode: "ask" | "edits" | "auto" | "full";
  applyToExisting: boolean;
  emergency?: boolean;
  botsUpdated: number;
  tasksUpdated: number;
  botsPreserved: number;
  tasksPreserved: number;
  reason?: string;
}

const FILE = "approval-defaults.ndjson";
const queues = new Map<string, Promise<void>>();

export function appendApprovalDefaultAudit(dataDir: string, row: Omit<ApprovalDefaultAuditRow, "at">): void {
  const previous = queues.get(dataDir) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(dataDir, { recursive: true });
    await appendFile(join(dataDir, FILE), JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n", { mode: 0o600 });
  }).catch(() => { /* auditing must never block a permission change */ });
  queues.set(dataDir, next);
  void next.finally(() => { if (queues.get(dataDir) === next) queues.delete(dataDir); });
}
