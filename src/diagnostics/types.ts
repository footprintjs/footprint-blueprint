/** Pure diagnostic contracts. Logical labels are opaque and never rendered in findings. */
export type BoundaryErrorCategory = 'timeout' | 'rate-limited' | 'server' | 'network' | 'auth' | 'permanent' | 'unknown';
export type BoundaryOutcome = 'ok' | 'failed' | 'timeout' | 'aborted' | 'blocked';
export type AttemptDecision = { readonly next: 'retry' | 'done' | 'stop'; readonly reason: 'succeeded' | 'paused' | 'aborted' | 'exhausted' | 'declined' | 'no-time-left' | 'retryable' };
/** A deliberately small projection; raw messages, causes, headers and provider payloads are excluded. */
export interface BoundaryErrorFields {
  readonly name?: string;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
}
export interface BoundaryErrorOptions {
  /** Lower-case logical label, 1–48 characters. No provider-specific interpretation is built in. */
  readonly system: string;
  readonly operation: string;
  readonly effect: 'read' | 'write';
  /** Trusted adapter projection of metadata such as its provider's actual numeric HTTP status. */
  readonly httpStatus?: number;
  /** Trusted, synchronous adapter policy. The frozen fields contain no raw error object. */
  readonly classify?: (fields: Readonly<BoundaryErrorFields>) => BoundaryErrorCategory | undefined;
}
export type BoundaryNormalizationOptions = BoundaryErrorOptions;
export interface NormalizedBoundaryError {
  readonly category: BoundaryErrorCategory;
  /** An allowlisted neutral code; arbitrary upstream codes are never copied. */
  readonly code: string;
  readonly httpStatus?: number;
  readonly effect: 'none' | 'unknown';
}
export interface BoundaryEvidence {
  readonly id: string;
  readonly sequence: number;
  readonly runtimeStageId: string;
  readonly target: string;
  readonly operation: string;
  readonly outcome: BoundaryOutcome;
  readonly category: BoundaryErrorCategory | 'ok';
  readonly effect: 'none' | 'confirmed' | 'unknown';
  readonly code?: string;
  readonly httpStatus?: number;
  readonly causedBy?: string;
  /** Composite of genuine engine context: `${attempt.series}@${attempt.attempt}`. */
  readonly attemptId?: string;
  readonly decision?: AttemptDecision;
}
/** Structural slice of a genuine redacted FootprintJS snapshot; other JSON fields may exist. */
export interface FailureNativeAttempt extends AttemptDecision {
  readonly series: string;
  readonly attempt: number;
  readonly of?: number;
  readonly kind: 'stage' | 'call' | 'observed';
  readonly outcome: 'ok' | 'failed' | 'timeout' | 'aborted' | 'paused';
  readonly category?: BoundaryErrorCategory;
  readonly durationMs: number;
  readonly startedAt: number;
  readonly effect?: 'applied' | 'none' | 'unknown';
  readonly retryLoop?: { readonly id: string; readonly series: string; readonly attempt: number; readonly of: number; readonly phase: 'attempt' | 'reconcile' };
}
export interface FailureNativeNode {
  readonly runtimeStageId: string;
  readonly attempts?: readonly FailureNativeAttempt[];
  readonly attemptsDropped?: number;
  readonly attemptSummary?: { readonly count: number };
  readonly children?: readonly FailureNativeNode[];
  readonly next?: FailureNativeNode | null;
}
export interface FailureNativeSnapshot {
  readonly runId: string;
  readonly executionTree: FailureNativeNode;
  readonly commitLog: readonly unknown[];
  readonly subflowResults?: Readonly<Record<string, unknown>>;
}
export interface FailureRecording {
  readonly schemaVersion: 1;
  readonly storeId: string;
  /** The native engine run ID, never a substitute application or provider run ID. */
  readonly runId: string;
  readonly flowId: string;
  readonly nativeSnapshot: FailureNativeSnapshot | null;
  readonly boundaryEvidence: readonly BoundaryEvidence[];
  readonly diagnostics: { readonly persistence: 'stored' | 'failed'; readonly observer: 'ok' | 'failed'; readonly code?: string };
}
export interface FailureFinding {
  readonly code: string;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
}
export interface FailureDiagnosis {
  readonly status: 'ok' | 'recovered' | 'failed' | 'unknown';
  readonly summary: string;
  readonly causes: readonly FailureFinding[];
  readonly consequences: readonly FailureFinding[];
  readonly diagnosticFailures: readonly FailureFinding[];
  readonly recommendations: readonly string[];
  readonly unknowns: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly coverage: {
    readonly nativeRecording: 'present' | 'missing';
    readonly boundaryEvidence: 'recorded' | 'not-recorded';
    readonly nativeAttemptRecords: number | null;
    readonly attemptBinding: 'complete' | 'partial';
    readonly attemptsTruncated: boolean;
    readonly logicalRetryLinks: 'recorded' | 'not-recorded';
    readonly upstreamRootCause: 'unknown';
    readonly authenticity: 'local-import-unverified';
    readonly externalEffect: 'unknown' | 'host-confirmed' | 'none-recorded';
    readonly circuit: 'adapter-recorded' | 'not-recorded';
  };
}
