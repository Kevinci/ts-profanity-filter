// temp-test.ts — local smoke test of the *built* package (Step 6).
// Run with: npm run build && node temp-test.ts
import { filterFWordsToSegments } from './dist/index.js';
import type { TextSegment, FilterOptions } from './dist/index.js';

const options: FilterOptions = { aggressive: true };
const result: TextSegment[] = filterFWordsToSegments('This is bullsh1t.', options);

console.log(result);

for (const seg of result) {
  if (seg.isProfane) {
    console.log('Blocked:', seg.text);
  }
}
