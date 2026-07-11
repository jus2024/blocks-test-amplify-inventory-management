/**
 * UserPreference CRUD 操作モジュール
 * AppSync API を介して DynamoDB の UserPreference レコードを操作する。
 * 全操作に 10 秒タイムアウトを適用する。
 */
import { dataClient } from './data-client.js';

// ─── タイムアウトユーティリティ ───────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('タイムアウト: 操作が10秒以内に完了しませんでした')), ms)
    ),
  ]);
}

// ─── 型定義 ──────────────────────────────────────────────────────────────────
export interface UserPreference {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

// ─── CRUD 操作 ───────────────────────────────────────────────────────────────

/**
 * 設定を保存する（upsert）。
 * 同一 key のレコードが存在すれば value を更新し、存在しなければ新規作成する。
 */
export async function upsertPreference(key: string, value: string): Promise<UserPreference> {
  // 既存レコードを検索
  const existing = await getPreferenceByKey(key);

  if (existing) {
    // 既存レコードを更新
    const { data, errors } = await withTimeout(
      dataClient.models.UserPreference.update({
        id: existing.id,
        value,
      })
    );
    if (errors && errors.length > 0) {
      throw new Error(errors[0].message);
    }
    return data as unknown as UserPreference;
  } else {
    // 新規レコードを作成
    const { data, errors } = await withTimeout(
      dataClient.models.UserPreference.create({
        key,
        value,
      })
    );
    if (errors && errors.length > 0) {
      throw new Error(errors[0].message);
    }
    return data as unknown as UserPreference;
  }
}

/**
 * 全設定レコードを取得する。
 * owner 認可により、ログインユーザーのレコードのみが返却される。
 */
export async function listPreferences(): Promise<UserPreference[]> {
  const { data, errors } = await withTimeout(
    dataClient.models.UserPreference.list()
  );
  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }
  return (data ?? []) as unknown as UserPreference[];
}

/**
 * 指定 ID の設定レコードを削除する。
 */
export async function deletePreference(id: string): Promise<void> {
  const { errors } = await withTimeout(
    dataClient.models.UserPreference.delete({ id })
  );
  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }
}

/**
 * key で設定レコードを検索し、1件返却する。
 * 存在しない場合は null を返す。
 */
export async function getPreferenceByKey(key: string): Promise<UserPreference | null> {
  const { data, errors } = await withTimeout(
    dataClient.models.UserPreference.list({
      filter: { key: { eq: key } },
    })
  );
  if (errors && errors.length > 0) {
    throw new Error(errors[0].message);
  }
  if (!data || data.length === 0) {
    return null;
  }
  return data[0] as unknown as UserPreference;
}
