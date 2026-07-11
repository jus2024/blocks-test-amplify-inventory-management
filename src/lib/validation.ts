/**
 * バリデーションユーティリティ
 * UserPreference と UserNote のフィールドバリデーション関数
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Preference key のバリデーション
 * - 1〜128文字
 * - 空白のみは不可
 */
export function validatePreferenceKey(key: string): ValidationResult {
  if (key.length === 0) {
    return { valid: false, error: '設定キーは必須です' };
  }
  if (key.trim().length === 0) {
    return { valid: false, error: '設定キーは空白のみにできません' };
  }
  if (key.length > 128) {
    return { valid: false, error: '設定キーは128文字以内で入力してください' };
  }
  return { valid: true };
}

/**
 * Preference value のバリデーション
 * - 1〜2048文字
 */
export function validatePreferenceValue(value: string): ValidationResult {
  if (value.length === 0) {
    return { valid: false, error: '設定値は必須です' };
  }
  if (value.length > 2048) {
    return { valid: false, error: '設定値は2048文字以内で入力してください' };
  }
  return { valid: true };
}

/**
 * Note title のバリデーション
 * - 1〜200文字
 * - 空白のみは不可
 */
export function validateNoteTitle(title: string): ValidationResult {
  if (title.length === 0) {
    return { valid: false, error: 'タイトルは必須です' };
  }
  if (title.trim().length === 0) {
    return { valid: false, error: 'タイトルは空白のみにできません' };
  }
  if (title.length > 200) {
    return { valid: false, error: 'タイトルは200文字以内で入力してください' };
  }
  return { valid: true };
}

/**
 * Note content のバリデーション
 * - 0〜10000文字（空文字許可）
 */
export function validateNoteContent(content: string): ValidationResult {
  if (content.length > 10000) {
    return { valid: false, error: '本文は10000文字以内で入力してください' };
  }
  return { valid: true };
}
