import type { FailureExplanationOptions, FailureExplanationTemplate } from './types.js';
import { code, inertCopy, invalid, keys, limit, status, text } from './inert.js';

export const explanationSlots = ['status', 'findingCode', 'recordedCause', 'nativeAttemptCount', 'logicalCallCount', 'transportAttemptCount'] as const;
export type ExplanationSlot = typeof explanationSlots[number];
export function placeholders(value: string): readonly ExplanationSlot[] {
  const slots: ExplanationSlot[] = [];
  const remaining = value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_, key: string) => {
    if (!explanationSlots.includes(key as ExplanationSlot)) invalid(); slots.push(key as ExplanationSlot); return '';
  });
  if (remaining.includes('{{') || remaining.includes('}}')) invalid();
  if (slots.length > 8) limit();
  return slots;
}
export function readTemplates(options?: FailureExplanationOptions): readonly FailureExplanationTemplate[] {
  if (options === undefined) return Object.freeze([]);
  const value = inertCopy(options);
  keys(value, [], ['templates']);
  if (value.templates === undefined) return Object.freeze([]);
  if (!Array.isArray(value.templates)) invalid();
  if (value.templates.length > 32) limit();
  const ids = new Set<string>();
  for (const row of value.templates) {
    keys(row, ['id', 'when'], ['problem', 'recordedCause', 'suggestedNextStep']);
    if (typeof row.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id) || ids.has(row.id)) invalid();
    ids.add(row.id); keys(row.when, [], ['status', 'findingCode']);
    if (row.when.status === undefined && row.when.findingCode === undefined) invalid();
    if (row.when.status !== undefined && !status(row.when.status) || row.when.findingCode !== undefined && !code(row.when.findingCode)) invalid();
    if (['problem', 'recordedCause', 'suggestedNextStep'].every(field => row[field] === undefined)) invalid();
    for (const field of ['problem', 'recordedCause', 'suggestedNextStep']) if (row[field] !== undefined) {
      if (!text(row[field], 1000)) limit(); placeholders(row[field] as string);
    }
  }
  return value.templates as readonly FailureExplanationTemplate[];
}
