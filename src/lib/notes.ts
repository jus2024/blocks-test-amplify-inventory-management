/**
 * Note CRUD 操作モジュール
 * AppSync + DynamoDB を使用した UserNote の管理
 * Requirements: 4.3, 4.4, 4.5, 4.6, 4.8, 5.5
 */

import { dataClient } from './data-client.js';

/**
 * タイムアウト付き Promise ラッパー
 * AppSync API 呼び出しが10秒以内に完了しない場合にエラーをスローする
 */
function withTimeout<T>(promise: Promise<T>, ms: number = 10000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('タイムアウト: 操作が10秒以内に完了しませんでした')), ms)
    ),
  ]);
}

/**
 * 新規メモを作成する
 * @param title メモタイトル（必須）
 * @param content メモ本文（任意）
 * @returns 作成されたメモレコード
 */
export async function createNote(title: string, content?: string) {
  const { data, errors } = await withTimeout(
    dataClient.models.UserNote.create({
      title,
      content: content ?? null,
    })
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }

  return data;
}

/**
 * 既存のメモを更新する
 * @param id 更新対象のメモID
 * @param title 新しいタイトル
 * @param content 新しい本文（任意）
 */
export async function updateNote(id: string, title: string, content?: string) {
  const { data, errors } = await withTimeout(
    dataClient.models.UserNote.update({
      id,
      title,
      content: content ?? null,
    })
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }

  return data;
}

/**
 * メモを削除する
 * @param id 削除対象のメモID
 */
export async function deleteNote(id: string) {
  const { data, errors } = await withTimeout(
    dataClient.models.UserNote.delete({ id })
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }

  return data;
}

/**
 * 全メモを updatedAt 降順で取得する
 * @returns メモ一覧（updatedAt 降順）
 */
export async function listNotes() {
  const { data, errors } = await withTimeout(
    dataClient.models.UserNote.list()
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }

  const notes = data ?? [];

  // updatedAt 降順でソート
  notes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return notes;
}

/**
 * IDでメモを1件取得する
 * @param id 取得対象のメモID
 * @returns メモレコード（存在しない場合は null）
 */
export async function getNote(id: string) {
  const { data, errors } = await withTimeout(
    dataClient.models.UserNote.get({ id })
  );

  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }

  return data;
}
