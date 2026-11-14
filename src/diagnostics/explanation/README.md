# Evidence-constrained explanation wording

Pure presentation helpers admit a host-owned `FailureDiagnosis`, select at most one eligible static template, and retain its canonical observations, uncertainty, coverage and evidence references. They do not authenticate imported diagnoses, discover a business-rule cause, or execute a recommendation.

`admission.ts` owns diagnosis shape checks. `config.ts` owns bounded immutable template admission and placeholder names. `matching.ts` owns exact matching, conservative ambiguity, interpolation eligibility and unknown-effect advice suppression. `rendering.ts` owns the three fixed sections and mandatory canonical facts. Each section's `configuredText` is supplementary authored wording; its `text` is always retained. Arbitrary authored prose cannot be verified by a template engine.

The public facade is `../explanation.ts`. `chart.ts` only wires the optional recording path through the small stages. Raw records, diagnoses and authored words stay in request-local closures; the presentation chart records only its fixed configured/default choice. Tests sit beside this capability and each stage.
