import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ApprovalRequest } from './contracts';

export const databasePath = resolve(process.env.DEMO_DB_PATH ?? 'data/approvals.sqlite');

export function withDatabase<T>(run: (db: DatabaseSync) => T): T {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS approval_requests (
        requestId TEXT PRIMARY KEY,
        workflowId TEXT NOT NULL,
        status TEXT NOT NULL,
        signalTimeoutMs INTEGER NOT NULL,
        postApprovalTimerMs INTEGER NOT NULL
      );
    `);
    return run(db);
  } finally {
    db.close();
  }
}

export function listRequests(workflowId?: string): ApprovalRequest[] {
  return withDatabase((db) => {
    const rows = workflowId
      ? db.prepare('SELECT * FROM approval_requests WHERE workflowId = ? ORDER BY rowid').all(workflowId)
      : db.prepare('SELECT * FROM approval_requests ORDER BY rowid').all();
    return rows as unknown as ApprovalRequest[];
  });
}
