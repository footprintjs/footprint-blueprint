import { decide } from 'footprintjs';
import type { PresentationScope } from '../types.js';
export function choosePresentation(scope: PresentationScope) {
  return decide(scope, [{ when: { configured: { eq: true } }, then: 'configured', label: 'One eligible static wording template' }],
    { branch: 'default', label: 'No unique eligible template; preserve canonical defaults' });
}
