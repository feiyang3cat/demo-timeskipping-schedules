export interface ApprovalRequest {
  requestId: string;
  workflowId: string;
  status: 'PENDING' | 'APPROVED' | 'TIMED_OUT';
  signalTimeoutMs: number;
  postApprovalTimerMs: number;
}
