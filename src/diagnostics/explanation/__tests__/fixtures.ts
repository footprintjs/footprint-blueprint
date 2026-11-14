import { FlowChartBuilder, FlowChartExecutor } from 'footprintjs';
import { createBoundaryRecorder } from '../../runtime.js';
import type { FailureRecording } from '../../types.js';

const quiet = { info() {}, log() {}, warn() {}, error() {}, debug() {} };
export const privateError = 'PRIVATE_PERSON@example.invalid secret raw provider payload';

export async function recording({ status = 403, write = false, calls = 1, missing = false } = {}): Promise<FailureRecording> {
  const observer = createBoundaryRecorder();
  const chart = new FlowChartBuilder().start('Recorded operation', async scope => {
    for (let i = 0; i < calls; i++) {
      try {
        await observer.run(scope, { system: write ? 'payment' : 'database', operation: write ? 'charge' : 'read',
          target: write ? 'payment.charge' : 'database.read', effect: write ? 'write' : 'read' }, () => {
          if (status !== 200) throw Object.assign(new Error(privateError), { status });
          return 'private successful result';
        });
      } catch { /* Preserve genuine boundary failures while recording independent probes. */ }
    }
  }, 'operation').setLogger(quiet).build();
  const executor = new FlowChartExecutor(chart);
  executor.attachFlowRecorder(observer.flowRecorder);
  await executor.run();
  const snapshot = JSON.parse(JSON.stringify(executor.getSnapshot({ redact: true })));
  const observed = observer.snapshot();
  return { schemaVersion: 1, storeId: 'local-store', flowId: 'local-flow', runId: snapshot.runId,
    nativeSnapshot: missing ? null : snapshot, boundaryEvidence: observed.boundaryEvidence,
    ...(missing ? {} : { physicalEvidence: observed.physicalEvidence, coverage: observed.coverage }),
    diagnostics: { persistence: 'stored', ...observed.diagnostics } };
}
