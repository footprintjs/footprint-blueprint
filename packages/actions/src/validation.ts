import { Ajv, type ValidateFunction } from 'ajv';
import addFormats, { type FormatsPlugin } from 'ajv-formats';
import { immutableValue } from '@footprint/features';
import type { ActionDefinition } from './types.js';

export class ActionInputError extends Error {
  readonly code = 'ACTION_INPUT_INVALID';
  readonly status = 400;
  constructor(readonly issues: readonly { path: string; keyword: string }[]) { super('Action input does not match its declared schema'); }
}
export class ActionAccessError extends Error {
  constructor(readonly code: string, message: string, readonly status = 403) { super(message); }
}
export const freezeData = immutableValue;
export function inputSchemaForAction(action: ActionDefinition): Readonly<Record<string, unknown>> {
  return action.inputSchema ?? { type: 'object', properties: Object.fromEntries(action.parameters.map(parameter => [parameter.name, { ...parameter.schema, type: parameter.type, description: parameter.description }])), required: action.parameters.filter(parameter => parameter.required).map(parameter => parameter.name), additionalProperties: false };
}
const ajv = new Ajv({ strict: true, addUsedSchema: false, allErrors: true, ownProperties: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
(addFormats as unknown as FormatsPlugin)(ajv);
const validators = new WeakMap<ActionDefinition, ValidateFunction>();
export function compileActionInput(action: ActionDefinition): ValidateFunction {
  let validate = validators.get(action);
  if (!validate) {
    const schema = inputSchemaForAction(action);
    if (schema.type !== 'object') throw new Error(`Action "${action.id}" input schema must have type object`);
    validate = ajv.compile(schema); validators.set(action, validate);
  }
  return validate;
}
/** Pure schema check; errors contain locations, never submitted values. */
export function validateActionInput(action: ActionDefinition, input: unknown): void {
  const validate = compileActionInput(action);
  if (!validate(input)) throw new ActionInputError(Object.freeze((validate.errors || []).map(error => Object.freeze({ path: error.instancePath, keyword: error.keyword }))));
}
