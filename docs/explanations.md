# Optional human-readable failure explanations

An owner needs to understand the problem, what the recording actually establishes, and a useful next step. The optional presentation API keeps these separate. It needs no model call and makes no business, retry, storage or provider request.

```ts
import { diagnoseFailureRecording, formatFailureExplanation } from 'footprint-blueprint/diagnostics';
import type { FailureExplanationTemplate } from 'footprint-blueprint/diagnostics';

const templates: readonly FailureExplanationTemplate[] = [{
  id: 'access-review',
  when: { findingCode: 'AUTH_REJECTION_RECORDED' },
  problem: 'This operation needs an access review.',
  recordedCause: 'Recorded classification: {{findingCode}}.',
  suggestedNextStep: 'Ask an administrator to check the configured access.',
}];

// The host admits its redacted stored recording before presentation.
const diagnosis = diagnoseFailureRecording(storedRecording);
const view = formatFailureExplanation(diagnosis, { templates });
// view.problem / view.recordedCause / view.suggestedNextStep
```

`formatFailureExplanation()` is a synchronous plain-data formatter for a host-admitted `FailureDiagnosis`. It validates and detaches the DTO but does not authenticate its producer. To combine the strict existing recording reader with a recorded local presentation decision, use `await createFailureExplanation(storedRecording, {templates})`. That optional facade runs a small FootPrint chart. Raw recordings, diagnoses and configured copy stay in request-local closures; its native scope contains only the configured/default choice. Neither API loads a stored file or executes a repair.

## Canonical facts stay visible

Each section has a fixed `title`, canonical `text`, optional supplementary `configuredText`, `wordingSource` and original `evidenceRefs`. The output also retains the original status, coverage, evidence references and verbatim unknowns. Render canonical text and mandatory uncertainty even when configured copy is present. Label `configuredText` as configured explanation. Authored prose is trusted configuration, not mechanically verified evidence; it must not be presented as a proved root or a verified repair.

For example, an authentication rejection is an observed boundary classification. It does not establish a provider outage. `coverage.upstreamRootCause` remains `unknown`. No template can provide replacement confidence, root, effect, coverage, evidence references, permission or executable action fields.

When `coverage.externalEffect` is `unknown`, the canonical next step is pinned reconciliation guidance. Configured next-step copy is completely withheld so it cannot contradict that guard by advising another write. A withheld-only template does not count as applied. Missing capture cannot acquire configured cause text. Unknown inputs do not become empty facts.

## Exact, conservative selection

Each template has a unique lower-case ID, a `when` object with an exact status and/or finding code, and at least one text field. Status is `ok`, `recovered`, `failed` or `unknown`. A finding code can match a cause, consequence or diagnostic failure, so a storage problem can receive useful advice without becoming the business root cause.

Configured cause copy requires exactly one matching evidence-backed **cause**. A consequence or diagnostic failure alone cannot authorize it. One uniquely cited consequence, such as physical recovery, may customize the problem and advisory next step while every earlier cause remains canonical and no cause is selected. Multiple matching templates or multiple findings with the selected code use defaults with an explicit ambiguity reason. Status-only templates also use defaults when there are competing causes. There is no first-array-item preference. The result's `template` identifies `configured` versus `default`, with its ID only when applied and an explicit reason such as `no-match`, `unavailable-facts` or `ambiguous-findings`.

No templates, or no eligible template, gives canonical defaults. Missing facts needed by a placeholder make that template ineligible. No original finding or unknown is removed merely to fit a template.

## Safe interpolation and bounds

Only these renderer-owned fields can be interpolated: `{{status}}`, `{{findingCode}}`, `{{recordedCause}}`, `{{nativeAttemptCount}}`, `{{logicalCallCount}}` and `{{transportAttemptCount}}`. Unknown counts remain unavailable. Logical run/operation names, values, raw errors, stacks, nested property paths, functions, expressions and provider payloads are not substitution inputs. Text is plain text, never HTML or executable markup.

At most 32 templates are accepted. Each text field is at most 1,000 UTF-8 bytes and has at most eight placeholders. IDs are at most 64 characters. Input must be bounded inert plain data: getters, functions, custom prototypes, cycles, symbols, prototype keys and sparse arrays are refused. The shared inert boundary limits depth to 48, visits to 50,000 and cumulative characters to 2 MiB. A returned presentation is capped at 256 KiB of string bytes and refused whole rather than silently trimming a guard, observation or citation. These are admission limits, not CPU or peak-memory promises. JavaScript proxy traps and trusted host code are not sandboxed.

Refusal uses `FailureExplanationError` with `EXPLANATION_INVALID` or `EXPLANATION_LIMIT`, fixed safe wording and a corrective instruction. Caller data and returned views are detached and deeply frozen.

## Ownership and scope

Blueprint owns the generic contract, exact selection and deterministic presentation. A domain package may supply reviewed static presets; a UI renders the resolved sections; the host owns any separately authorized action. Current generic boundary finding codes do not establish a shipping-rule code or a canonical Foottrace source. This API does not manufacture either. Business-rule templates need their own admitted stable rule-code contract.
