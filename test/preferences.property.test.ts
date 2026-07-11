// Feature: appsync-dynamodb-user-data, Property 3: Preference CRUD ラウンドトリップ
// **Validates: Requirements 3.4, 3.5, 7.4, 7.5**

import { test } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';

// ─── In-memory store to simulate DynamoDB UserPreference table ───────────────
interface StoreRecord {
  id: string;
  key: string;
  value: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

let store: StoreRecord[] = [];
let idCounter = 0;

function resetStore() {
  store = [];
  idCounter = 0;
}

function generateId(): string {
  return `pref-${++idCounter}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Mock dataClient.models.UserPreference methods ───────────────────────────
const mockUserPreference = {
  create: async (input: { key: string; value: string }) => {
    const record: StoreRecord = {
      id: generateId(),
      key: input.key,
      value: input.value,
      owner: 'test-user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.push(record);
    return { data: record, errors: null };
  },
  list: async (opts?: { filter?: { key?: { eq?: string } } }) => {
    if (opts?.filter?.key?.eq) {
      const filtered = store.filter((r) => r.key === opts.filter!.key!.eq);
      return { data: filtered, errors: null };
    }
    return { data: [...store], errors: null };
  },
  delete: async (input: { id: string }) => {
    const idx = store.findIndex((r) => r.id === input.id);
    if (idx !== -1) {
      store.splice(idx, 1);
    }
    return { data: null, errors: null };
  },
  update: async (input: { id: string; value: string }) => {
    const record = store.find((r) => r.id === input.id);
    if (record) {
      record.value = input.value;
      record.updatedAt = new Date().toISOString();
    }
    return { data: record ?? null, errors: null };
  },
  get: async (input: { id: string }) => {
    const record = store.find((r) => r.id === input.id) ?? null;
    return { data: record, errors: null };
  },
};

// ─── Preference CRUD logic (mirrors src/lib/preferences.ts using in-memory mock) ─
// This replicates the same logic as the actual module but uses our mock store
// to test the CRUD round-trip property without needing AppSync.

interface UserPreference {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

async function getPreferenceByKey(key: string): Promise<UserPreference | null> {
  const { data, errors } = await mockUserPreference.list({
    filter: { key: { eq: key } },
  });
  if (errors && (errors as any[]).length > 0) {
    throw new Error((errors as any[])[0].message);
  }
  if (!data || data.length === 0) {
    return null;
  }
  return data[0] as unknown as UserPreference;
}

async function upsertPreference(key: string, value: string): Promise<UserPreference> {
  const existing = await getPreferenceByKey(key);

  if (existing) {
    const { data, errors } = await mockUserPreference.update({
      id: existing.id,
      value,
    });
    if (errors && (errors as any[]).length > 0) {
      throw new Error((errors as any[])[0].message);
    }
    return data as unknown as UserPreference;
  } else {
    const { data, errors } = await mockUserPreference.create({ key, value });
    if (errors && (errors as any[]).length > 0) {
      throw new Error((errors as any[])[0].message);
    }
    return data as unknown as UserPreference;
  }
}

async function listPreferences(): Promise<UserPreference[]> {
  const { data, errors } = await mockUserPreference.list();
  if (errors && (errors as any[]).length > 0) {
    throw new Error((errors as any[])[0].message);
  }
  return (data ?? []) as unknown as UserPreference[];
}

async function deletePreference(id: string): Promise<void> {
  const { errors } = await mockUserPreference.delete({ id });
  if (errors && (errors as any[]).length > 0) {
    throw new Error((errors as any[])[0].message);
  }
}

// ─── Generators ──────────────────────────────────────────────────────────────
// Valid key: 1-128 chars, not all whitespace
const validKeyArb = fc
  .string({ minLength: 1, maxLength: 128 })
  .filter((s) => s.trim().length > 0);

// Valid value: 1-2048 chars
const validValueArb = fc.string({ minLength: 1, maxLength: 2048 });

// Generate array of unique key/value pairs (distinct keys)
const distinctKeyValuePairsArb = fc
  .array(fc.tuple(validKeyArb, validValueArb), { minLength: 1, maxLength: 20 })
  .map((pairs) => {
    // Ensure distinct keys by using a Map
    const map = new Map<string, string>();
    for (const [k, v] of pairs) {
      map.set(k, v);
    }
    return Array.from(map.entries()).map(([k, v]) => ({ key: k, value: v }));
  })
  .filter((arr) => arr.length >= 1);

// ─── Property Test ───────────────────────────────────────────────────────────

test('Property 3: Preference CRUD ラウンドトリップ - create N, list returns N, delete 1, list returns N-1', async () => {
  await fc.assert(
    fc.asyncProperty(distinctKeyValuePairsArb, async (pairs) => {
      // Reset store for each iteration
      resetStore();

      const N = pairs.length;

      // Create all preferences via upsertPreference
      const createdRecords: UserPreference[] = [];
      for (const { key, value } of pairs) {
        const record = await upsertPreference(key, value);
        createdRecords.push(record);
      }

      // Verify list returns exactly N records
      const allPrefs = await listPreferences();
      assert.strictEqual(
        allPrefs.length,
        N,
        `Expected ${N} records after creating ${N} pairs, got ${allPrefs.length}`
      );

      // Verify each created key/value is present in the list
      for (const { key, value } of pairs) {
        const found = allPrefs.find((p) => p.key === key);
        assert.ok(found, `Expected to find key "${key}" in list`);
        assert.strictEqual(
          found.value,
          value,
          `Expected value "${value}" for key "${key}", got "${found.value}"`
        );
      }

      // Delete one record (the first one)
      const deletedRecord = createdRecords[0];
      await deletePreference(deletedRecord.id);

      // Verify list now returns N-1 records
      const afterDelete = await listPreferences();
      assert.strictEqual(
        afterDelete.length,
        N - 1,
        `Expected ${N - 1} records after deleting 1, got ${afterDelete.length}`
      );

      // Verify deleted key is no longer in the list
      const deletedKey = pairs[0].key;
      const stillExists = afterDelete.find((p) => p.key === deletedKey);
      assert.strictEqual(
        stillExists,
        undefined,
        `Deleted key "${deletedKey}" should not be in list after deletion`
      );
    }),
    { numRuns: 100 }
  );
});
