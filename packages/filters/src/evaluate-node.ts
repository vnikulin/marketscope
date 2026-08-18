import {
  evaluateWithRegex,
  type FilterDefinition,
  type FilterableListing,
} from './evaluate.js';
import { evaluateRegex } from './regex.js';

export function evaluate(
  listing: FilterableListing,
  definition: FilterDefinition,
) {
  return evaluateWithRegex(listing, definition, evaluateRegex);
}
