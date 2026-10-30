import type { ApprovalRequest } from './contracts';
import { withDatabase } from './database';

export async function recordStep(step: string): Promise<void> {
  console.log(`[Activity] ${step}; wall-clock time: ${new Date().toISOString()}`);
}

export async function createApprovalRequest(request: ApprovalRequest): Promise<ApprovalRequest> {
  return withDatabase((db) => {
    // A retry of this Activity returns the same request instead of inserting a duplicate.
    db.prepare(`INSERT INTO approval_requests
      (requestId, workflowId, status, signalTimeoutMs, postApprovalTimerMs)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(requestId) DO NOTHING`).run(
      request.requestId, request.workflowId, request.status,
      request.signalTimeoutMs, request.postApprovalTimerMs,
    );
    const row = db.prepare('SELECT * FROM approval_requests WHERE requestId = ?').get(request.requestId);
    console.log(`[Activity] Approval request ready to read: ${request.requestId}`);
    return row as unknown as ApprovalRequest;
  });
}

export async function recordApprovalDecision(requestId: string, status: 'APPROVED' | 'TIMED_OUT'): Promise<void> {
  withDatabase((db) => {
    const result = db.prepare('UPDATE approval_requests SET status = ? WHERE requestId = ?').run(status, requestId);
    if (result.changes !== 1) throw new Error(`Approval request not found: ${requestId}`);
  });
  console.log(`[Activity] Approval request ${requestId}: ${status}`);
}
