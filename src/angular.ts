// src/angular.ts — import from 'ts-profanity-filter/angular'
//
// Deliberately imports nothing from @angular/core.
//
// An Angular class carrying a real `@Pipe()` / `@Injectable()` decorator has to
// be compiled by Angular's own compiler (ngtsc) to get its static definition.
// A library built with plain `tsc`, like this one, cannot produce that — an AOT
// build in the consuming app would fail on it.
//
// So this entry point ships the *logic* without decorators. You add the
// decorator in your own app, where ngtsc compiles it properly:
//
//   import { Pipe } from '@angular/core';
//   import { ProfanitySegmentsPipeBase } from 'ts-profanity-filter/angular';
//
//   @Pipe({ name: 'profanitySegments', standalone: true })
//   export class ProfanitySegmentsPipe extends ProfanitySegmentsPipeBase {}
//
//   <!-- template -->
//   <span *ngFor="let seg of body | profanitySegments:{ languages: ['en','de'] }"
//         [class.redacted]="seg.isProfane">{{ seg.text }}</span>
//
// The base class is structurally a `PipeTransform`, so the subclass satisfies
// the interface without this package depending on Angular at all.

import { filterFWordsToSegments, type FilterOptions, type TextSegment } from './filter.js';

function optionsKey(options: FilterOptions): string {
  return JSON.stringify([
    options.languages,
    options.customList,
    options.allowList,
    options.aggressive,
  ]);
}

/**
 * Base class for an Angular pipe. Extend it and add `@Pipe()` in your app.
 *
 * Pure pipes re-run whenever an argument changes by reference, and an options
 * object literal in a template is a fresh reference on every change-detection
 * cycle — so the last result is cached by value to keep that cheap.
 */
export class ProfanitySegmentsPipeBase {
  private lastText: string | null = null;
  private lastKey = '';
  private lastResult: TextSegment[] = [];

  transform(text: string, options: FilterOptions = {}): TextSegment[] {
    const key = optionsKey(options);
    if (text === this.lastText && key === this.lastKey) return this.lastResult;

    this.lastText = text;
    this.lastKey = key;
    this.lastResult = filterFWordsToSegments(text, options);
    return this.lastResult;
  }
}

/**
 * Base class for a `boolean` pipe — handy for `*ngIf` guards and form
 * validation. Extend it and add `@Pipe({ name: 'isProfane' })`.
 */
export class IsProfanePipeBase {
  private readonly segments = new ProfanitySegmentsPipeBase();

  transform(text: string, options: FilterOptions = {}): boolean {
    return this.segments.transform(text, options).some((s) => s.isProfane);
  }
}

/**
 * Plain service class — no `@Injectable()`, so provide it explicitly:
 *
 * ```ts
 * providers: [
 *   { provide: ProfanityFilter, useFactory: () => new ProfanityFilter({ languages: ['en', 'de'] }) },
 * ]
 * ```
 */
export class ProfanityFilter {
  constructor(private readonly defaults: FilterOptions = {}) {}

  segments(text: string, options: FilterOptions = {}): TextSegment[] {
    return filterFWordsToSegments(text, { ...this.defaults, ...options });
  }

  isProfane(text: string, options: FilterOptions = {}): boolean {
    return this.segments(text, options).some((s) => s.isProfane);
  }

  /** Replaces every flagged segment with `mask` repeated to the same length. */
  mask(text: string, mask = '*', options: FilterOptions = {}): string {
    return this.segments(text, options)
      .map((s) => (s.isProfane ? mask.repeat(s.text.length) : s.text))
      .join('');
  }
}

export { filterFWordsToSegments } from './filter.js';
export type { FilterOptions, TextSegment } from './filter.js';
export type { Language } from './registry.js';
