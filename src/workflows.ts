import {
  ApplicationFailure, condition, defineSignal, log, proxyActivities, setHandler, sleep, workflowInfo,
} from '@temporalio/workflow';
import type * as activities from './activities';

const { recordStep, createApprovalRequest, recordApprovalDecision } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 minute',
});

export interface TimerInput {
  /** Duration of each user timer, in milliseconds. Defaults to one hour. */
  timerMs?: number;
}

export interface ApprovalInput extends TimerInput {
  /** Business timeout for the external Signal. Defaults to 24 hours. */
  signalTimeoutMs?: number;
}

export const proceedSignal = defineSignal<[{ requestId: string }]>('proceed');

/** User timer -> Activity -> user timer. */
export async function workflowWithActivityAndTimer({ timerMs = 3_600_000 }: TimerInput = {}): Promise<string> {
  log.info('Waiting for the first user timer');
  await sleep(timerMs);
  await recordStep('workflowWithActivityAndTimer: first timer fired');
  log.info('Waiting for the final user timer');
  await sleep(timerMs);
  return 'Both user timers and the Activity completed';
}

/** User timer -> Activity writes a request -> Signal OR timeout -> Activity -> user timer. */
export async function workflowWaitOnSignalAndTimer({
  timerMs = 3_600_000,
  signalTimeoutMs = 86_400_000,
}: ApprovalInput = {}): Promise<string> {
  const { workflowId, runId: requestId } = workflowInfo();
  let signalReceived = false;
  setHandler(proceedSignal, (input) => {
    if (input?.requestId !== requestId) {
      log.warn('Ignoring proceed Signal with a missing or mismatched requestId');
      return;
    }
    signalReceived = true;
  });

  log.info('Waiting for the first user timer before creating an approval request');
  await sleep(timerMs);

  // The external user reads this Activity's durable database record before signaling.
  const request = await createApprovalRequest({
    requestId, workflowId, status: 'PENDING', signalTimeoutMs, postApprovalTimerMs: timerMs,
  });
  log.info('Waiting for proceed Signal or the business timeout', { requestId });
  const approved = await condition(() => signalReceived, request.signalTimeoutMs);
  if (!approved) {
    await recordApprovalDecision(request.requestId, 'TIMED_OUT');
    throw ApplicationFailure.nonRetryable('Approval Signal timed out', 'ApprovalTimedOut');
  }

  await recordApprovalDecision(request.requestId, 'APPROVED');
  log.info('Approval recorded; waiting for the final user timer');
  await sleep(request.postApprovalTimerMs);
  return `Approval ${request.requestId} recorded and final timer completed`;
}
