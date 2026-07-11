// Feature: appsync-dynamodb-user-data, Property 2: フィールドバリデーションの正確性
// **Validates: Requirements 3.2, 4.1, 4.7**

import { test } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import {
  validatePreferenceKey,
  validatePreferenceValue,
  validateNoteTitle,
  validateNoteContent,
} from '../src/lib/validation.js';

// Helper: generate a non-whitespace-only string of given length range
function nonWhitespaceString(minLength: number, maxLength: number) {
  return fc
    .string({ minLength, maxLength })
    .filter((s) => s.trim().length > 0);
}

test('Property 2.1: validatePreferenceKey accepts valid strings (1-128 chars, not all whitespace)', () => {
  fc.assert(
    fc.property(nonWhitespaceString(1, 128), (key) => {
      const result = validatePreferenceKey(key);
      assert.strictEqual(result.valid, true, `Expected valid for key "${key}" but got error: ${result.error}`);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.2: validatePreferenceKey rejects empty strings', () => {
  const result = validatePreferenceKey('');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error);
});

test('Property 2.3: validatePreferenceKey rejects strings longer than 128 chars', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 129, maxLength: 300 }), (key) => {
      const result = validatePreferenceKey(key);
      assert.strictEqual(result.valid, false, `Expected invalid for key of length ${key.length}`);
      assert.ok(result.error);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.4: validatePreferenceKey rejects whitespace-only strings', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 128 }).map((len) => ' '.repeat(len)),
      (key) => {
        const result = validatePreferenceKey(key);
        assert.strictEqual(result.valid, false, `Expected invalid for whitespace-only key "${key}"`);
        assert.ok(result.error);
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 2.5: validatePreferenceValue accepts valid strings (1-2048 chars)', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 2048 }), (value) => {
      const result = validatePreferenceValue(value);
      assert.strictEqual(result.valid, true, `Expected valid for value of length ${value.length} but got error: ${result.error}`);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.6: validatePreferenceValue rejects empty strings', () => {
  const result = validatePreferenceValue('');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error);
});

test('Property 2.7: validatePreferenceValue rejects strings longer than 2048 chars', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 2049, maxLength: 3000 }), (value) => {
      const result = validatePreferenceValue(value);
      assert.strictEqual(result.valid, false, `Expected invalid for value of length ${value.length}`);
      assert.ok(result.error);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.8: validateNoteTitle accepts valid strings (1-200 chars, not all whitespace)', () => {
  fc.assert(
    fc.property(nonWhitespaceString(1, 200), (title) => {
      const result = validateNoteTitle(title);
      assert.strictEqual(result.valid, true, `Expected valid for title "${title}" but got error: ${result.error}`);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.9: validateNoteTitle rejects empty strings', () => {
  const result = validateNoteTitle('');
  assert.strictEqual(result.valid, false);
  assert.ok(result.error);
});

test('Property 2.10: validateNoteTitle rejects strings longer than 200 chars', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 201, maxLength: 500 }), (title) => {
      const result = validateNoteTitle(title);
      assert.strictEqual(result.valid, false, `Expected invalid for title of length ${title.length}`);
      assert.ok(result.error);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.11: validateNoteTitle rejects whitespace-only strings', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 200 }).map((len) => ' '.repeat(len)),
      (title) => {
        const result = validateNoteTitle(title);
        assert.strictEqual(result.valid, false, `Expected invalid for whitespace-only title "${title}"`);
        assert.ok(result.error);
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 2.12: validateNoteContent accepts valid strings (0-10000 chars, including empty)', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 10000 }), (content) => {
      const result = validateNoteContent(content);
      assert.strictEqual(result.valid, true, `Expected valid for content of length ${content.length} but got error: ${result.error}`);
    }),
    { numRuns: 100 }
  );
});

test('Property 2.13: validateNoteContent rejects strings longer than 10000 chars', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 10001, maxLength: 12000 }), (content) => {
      const result = validateNoteContent(content);
      assert.strictEqual(result.valid, false, `Expected invalid for content of length ${content.length}`);
      assert.ok(result.error);
    }),
    { numRuns: 100 }
  );
});
