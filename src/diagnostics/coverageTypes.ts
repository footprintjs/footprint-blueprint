import type { LogAddress, RequirementResult } from 'foottrace';
import type { Gap } from 'foottrace/cause';
import type { RecordedCauseSource } from './cause.js';

/** Trusted build-time metadata, never proof of execution or of a successful business outcome. */
export interface CoverageStepDeclaration {
  readonly ref: string;
  /** Exact, fully prefixed CommitBundle.stageId; names and local IDs are not sufficient. */
  readonly stageId: string;
  readonly label: string;
  readonly description?: string;
}
export interface CoverageScopeDeclaration {
  readonly ref: string;
  /** Exact authorized log address, including the per-execution mount drill path. */
  readonly address: LogAddress;
  readonly steps: readonly CoverageStepDeclaration[];
}
export interface CoverageDeclaration {
  readonly version: 1;
  readonly runId: string;
  readonly definitionRef: string;
  readonly label: string;
  readonly description?: string;
  /** Completeness of this declared inventory only; it says nothing about runtime/cause coverage. */
  readonly complete: boolean;
  readonly scopes: readonly CoverageScopeDeclaration[];
}
export interface CoverageRow {
  readonly ref: string;
  readonly requirementRef: string;
  readonly scopeIndex?: number;
  readonly label: string;
  readonly description?: string;
  /** Observed means a retained commit exists, not that execution or an external effect succeeded. */
  readonly state: 'observed' | 'not-observed' | 'unknown';
  readonly result: RequirementResult;
}
export interface RecordedCoverage {
  readonly version: 1;
  readonly declaration?: CoverageDeclaration;
  readonly rows: readonly CoverageRow[];
  readonly results: readonly RequirementResult[];
  readonly gaps: readonly Gap[];
}
export interface RecordedCoverageInput {
  readonly source: RecordedCauseSource;
  readonly declaration?: CoverageDeclaration;
  readonly findingRef: string;
  readonly windowRef: string;
}
