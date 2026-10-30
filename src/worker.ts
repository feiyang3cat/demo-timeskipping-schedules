import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';

async function main(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'timeskipping-test';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'timeskipping-schedules';
  const connection = await NativeConnection.connect({ address });
  try {
    const worker = await Worker.create({
      connection,
      namespace,
      taskQueue,
      workflowsPath: require.resolve('./workflows'),
      activities,
    });
    console.log(`Worker connected to ${address}; namespace=${namespace}; taskQueue=${taskQueue}`);
    await worker.run();
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
