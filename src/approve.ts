import { setTimeout } from 'node:timers/promises';
import { Client, Connection } from '@temporalio/client';
import { databasePath, listRequests } from './database';

async function main(): Promise<void> {
  const workflowId = process.argv[2];
  if (!workflowId || process.argv.length !== 3) {
    throw new Error('Usage: npm run approve -- <workflow-id>');
  }

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233',
  });
  try {
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'timeskipping-test',
    });
    const execution = await client.workflow.getHandle(workflowId).describe();
    if (execution.status.name !== 'RUNNING') {
      throw new Error(`Workflow is ${execution.status.name}; start a new execution to test approval`);
    }

    // The request ID is the Run ID; do not signal a stale request from a previous run.
    const request = listRequests(workflowId).find(row => row.requestId === execution.runId);
    if (!request) {
      throw new Error(`Approval request is not ready in ${databasePath}; fast-forward the initial timer and wait for the first Activity`);
    }
    if (request.status === 'APPROVED') {
      console.log(`APPROVED: ${request.requestId}`);
      return;
    }
    if (request.status !== 'PENDING') {
      throw new Error(`Approval request is ${request.status}; no Signal sent`);
    }

    console.log(`Read pending approval: ${JSON.stringify(request)}`);
    await client.workflow.getHandle(workflowId, execution.runId).signal('proceed', {
      requestId: request.requestId,
    });
    console.log('Signal sent; waiting for the approval Activity to record APPROVED');

    const deadline = Date.now() + 30_000;
    while (true) {
      const updated = listRequests(workflowId).find(row => row.requestId === request.requestId);
      if (updated?.status === 'APPROVED') {
        console.log(`APPROVED: ${request.requestId}`);
        return;
      }
      if (updated?.status === 'TIMED_OUT') {
        throw new Error('The approval request timed out before approval was recorded');
      }
      if (Date.now() >= deadline) {
        throw new Error('Signal was sent, but approval is not recorded after 30s; check the Worker and database before resuming time skipping');
      }
      await setTimeout(200);
    }
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
