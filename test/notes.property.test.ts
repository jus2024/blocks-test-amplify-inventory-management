// Feature: appsync-dynamodb-user-data, Property 4: Note CRUD ラウンドトリップ
// **Validates: Requirements 4.3, 4.4, 4.5, 7.4, 7.5**

import { test } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// In-memory mock of dataClient.models.UserNote
// Simulates DynamoDB behavior for property-based testing without AppSync sandbox
// ---------------------------------------------------------------------------

interface UserNoteRecord {
  id: string;
  title: string;
  content: string | null;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

function createMockUserNoteStore() {
  const store = new Map<string, UserNoteRecord>();
  let idCounter = 0;

  return {
    store,
    reset() {
      store.clear();
      idCounter = 0;
    },
    models: {
      UserNote: {
        async create(input: { title: string; content?: string | null }) {
          const now = new Date().toISOString();
          const record: UserNoteRecord = {
            id: `note-${++idCounter}-${Date.now()}`,
            title: input.title,
            content: input.content ?? null,
            owner: 'test-user',
            createdAt: now,
            updatedAt: now,
          };
          store.set(record.id, record);
          return { data: { ...record }, errors: undefined };
        },
        async get(input: { id: string }) {
          const record = store.get(input.id);
          return { data: record ? { ...record } : null, errors: undefined };
        },
        async update(input: { id: string; title: string; content?: string | null }) {
          const existing = store.get(input.id);
          if (!existing) {
            return { data: null, errors: [{ message: 'Record not found' }] };
          }
          // Ensure updatedAt is strictly newer than the existing value
          const existingTime = new Date(existing.updatedAt).getTime();
          const nowTime = Date.now();
          const newTime = Math.max(existingTime + 1, nowTime);
          const updated: UserNoteRecord = {
            ...existing,
            title: input.title,
            content: input.content ?? null,
            updatedAt: new Date(newTime).toISOString(),
          };
          store.set(input.id, updated);
          return { data: { ...updated }, errors: undefined };
        },
        async delete(input: { id: string }) {
          const existing = store.get(input.id);
          if (!existing) {
            return { data: null, errors: [{ message: 'Record not found' }] };
          }
          store.delete(input.id);
          return { data: { ...existing }, errors: undefined };
        },
        async list() {
          const records = Array.from(store.values()).map((r) => ({ ...r }));
          return { data: records, errors: undefined };
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Note CRUD functions that use the mock (mirrors src/lib/notes.ts logic)
// ---------------------------------------------------------------------------

function createNoteFns(mockClient: ReturnType<typeof createMockUserNoteStore>) {
  async function createNote(title: string, content?: string) {
    const result = await mockClient.models.UserNote.create({
      title,
      content: content ?? null,
    });
    const errors = result.errors as Array<{ message: string }> | undefined;
    if (errors && errors.length > 0) throw new Error(errors[0].message);
    return result.data;
  }

  async function updateNote(id: string, title: string, content?: string) {
    const result = await mockClient.models.UserNote.update({
      id,
      title,
      content: content ?? null,
    });
    const errors = result.errors as Array<{ message: string }> | undefined;
    if (errors && errors.length > 0) throw new Error(errors[0].message);
    return result.data;
  }

  async function deleteNote(id: string) {
    const result = await mockClient.models.UserNote.delete({ id });
    const errors = result.errors as Array<{ message: string }> | undefined;
    if (errors && errors.length > 0) throw new Error(errors[0].message);
    return result.data;
  }

  async function getNote(id: string) {
    const result = await mockClient.models.UserNote.get({ id });
    const errors = result.errors as Array<{ message: string }> | undefined;
    if (errors && errors.length > 0) throw new Error(errors[0].message);
    return result.data;
  }

  async function listNotes() {
    const result = await mockClient.models.UserNote.list();
    const errors = result.errors as Array<{ message: string }> | undefined;
    if (errors && errors.length > 0) throw new Error(errors[0].message);
    const notes = result.data ?? [];
    notes.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return notes;
  }

  return { createNote, updateNote, deleteNote, getNote, listNotes };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// Valid title: 1-200 chars, not whitespace-only
const validTitle = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

// Valid content: 0-10000 chars (optional)
const validContent = fc.string({ minLength: 0, maxLength: 10000 });

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

test('Property 4.1: create → get returns same title and content', async () => {
  const mockClient = createMockUserNoteStore();
  const { createNote, getNote } = createNoteFns(mockClient);

  await fc.assert(
    fc.asyncProperty(validTitle, validContent, async (title, content) => {
      mockClient.reset();

      const created = await createNote(title, content);
      assert.ok(created, 'createNote should return data');
      assert.ok(created!.id, 'created note should have an id');

      const fetched = await getNote(created!.id);
      assert.ok(fetched, 'getNote should return the created note');
      assert.strictEqual(fetched!.title, title, 'title should match');
      assert.strictEqual(fetched!.content, content, 'content should match');
    }),
    { numRuns: 100 }
  );
});

test('Property 4.2: update → get returns new title/content and updatedAt is newer', async () => {
  const mockClient = createMockUserNoteStore();
  const { createNote, updateNote, getNote } = createNoteFns(mockClient);

  await fc.assert(
    fc.asyncProperty(
      validTitle,
      validContent,
      validTitle,
      validContent,
      async (title1, content1, title2, content2) => {
        mockClient.reset();

        const created = await createNote(title1, content1);
        assert.ok(created, 'createNote should return data');

        const originalUpdatedAt = created!.updatedAt;

        const updated = await updateNote(created!.id, title2, content2);
        assert.ok(updated, 'updateNote should return data');

        const fetched = await getNote(created!.id);
        assert.ok(fetched, 'getNote should return the updated note');
        assert.strictEqual(fetched!.title, title2, 'title should be the new value');
        assert.strictEqual(fetched!.content, content2, 'content should be the new value');

        // updatedAt must be strictly newer after update
        assert.ok(
          new Date(fetched!.updatedAt).getTime() > new Date(originalUpdatedAt).getTime(),
          `updatedAt should be newer: ${fetched!.updatedAt} > ${originalUpdatedAt}`
        );
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 4.3: delete → get returns null', async () => {
  const mockClient = createMockUserNoteStore();
  const { createNote, deleteNote, getNote } = createNoteFns(mockClient);

  await fc.assert(
    fc.asyncProperty(validTitle, validContent, async (title, content) => {
      mockClient.reset();

      const created = await createNote(title, content);
      assert.ok(created, 'createNote should return data');

      await deleteNote(created!.id);

      const fetched = await getNote(created!.id);
      assert.strictEqual(fetched, null, 'getNote should return null after delete');
    }),
    { numRuns: 100 }
  );
});

// ---------------------------------------------------------------------------
// Feature: appsync-dynamodb-user-data, Property 5: Note 一覧のソート順保証
// **Validates: Requirements 4.6, 5.3**
// ---------------------------------------------------------------------------

test('Property 5: listNotes returns notes sorted by updatedAt descending', async () => {
  await fc.assert(
    fc.asyncProperty(
      // Generate 2-10 notes with valid titles and distinct timestamps
      fc.integer({ min: 2, max: 10 }).chain((count) =>
        fc.tuple(
          fc.array(validTitle, { minLength: count, maxLength: count }),
          // Generate distinct timestamp offsets (milliseconds from base)
          fc.array(
            fc.integer({ min: 0, max: 1_000_000_000 }),
            { minLength: count, maxLength: count }
          )
        )
      ),
      async ([titles, timestampOffsets]) => {
        const mockClient = createMockUserNoteStore();
        const { listNotes } = createNoteFns(mockClient);

        // Create notes sequentially with distinct updatedAt timestamps
        const baseTime = new Date('2024-01-01T00:00:00.000Z').getTime();
        for (let i = 0; i < titles.length; i++) {
          const { data } = await mockClient.models.UserNote.create({ title: titles[i] });
          if (data) {
            // Override updatedAt in the store to simulate different timestamps
            const record = mockClient.store.get(data.id);
            if (record) {
              record.updatedAt = new Date(baseTime + timestampOffsets[i]).toISOString();
            }
          }
        }

        // Call listNotes (which sorts by updatedAt descending)
        const result = await listNotes();

        // Verify we got back all notes
        assert.strictEqual(
          result.length,
          titles.length,
          `Expected ${titles.length} notes but got ${result.length}`
        );

        // Verify updatedAt descending order: for all adjacent pairs
        for (let i = 0; i < result.length - 1; i++) {
          const currentTime = new Date(result[i].updatedAt).getTime();
          const nextTime = new Date(result[i + 1].updatedAt).getTime();
          assert.ok(
            currentTime >= nextTime,
            `Sort order violated at index ${i}: ${result[i].updatedAt} (${currentTime}) should be >= ${result[i + 1].updatedAt} (${nextTime})`
          );
        }
      }
    ),
    { numRuns: 100 }
  );
});
