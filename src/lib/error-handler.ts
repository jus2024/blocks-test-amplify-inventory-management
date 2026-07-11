/**
 * AppSync エラーハンドリングユーティリティ
 * エラーを分類し、ユーザー向けメッセージを返却する。
 * Requirements: 5.5
 */

export type ErrorType = 'unauthorized' | 'network' | 'validation' | 'unknown';

export interface AppSyncError {
  type: ErrorType;
  message: string;
  retryable: boolean;
}

/**
 * エラーを分類し、AppSyncError オブジェクトを返却する。
 * エラーメッセージのキーワードに基づいてエラー種別を判定する。
 */
export function classifyError(error: unknown): AppSyncError {
  const message = extractErrorMessage(error);

  if (isUnauthorizedError(message)) {
    return {
      type: 'unauthorized',
      message: 'ログインが必要です。再度ログインしてください',
      retryable: false,
    };
  }

  if (isNetworkError(message)) {
    return {
      type: 'network',
      message: 'ネットワークエラーが発生しました。再試行してください',
      retryable: true,
    };
  }

  if (isValidationError(message)) {
    return {
      type: 'validation',
      message: '入力内容に問題があります。確認してください',
      retryable: false,
    };
  }

  return {
    type: 'unknown',
    message: '予期しないエラーが発生しました',
    retryable: false,
  };
}

/**
 * エラーを分類し、ユーザー向けメッセージ文字列のみを返却するヘルパー。
 */
export function handleAppSyncError(error: unknown): string {
  return classifyError(error).message;
}

// ─── 内部ヘルパー ─────────────────────────────────────────────────────────────

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '';
}

function isUnauthorizedError(message: string): boolean {
  const keywords = ['Unauthorized', 'Not Authorized', 'token'];
  return keywords.some((keyword) => message.includes(keyword));
}

function isNetworkError(message: string): boolean {
  const keywords = ['timeout', 'タイムアウト', 'network', 'NetworkError', 'ECONNREFUSED'];
  return keywords.some((keyword) => message.includes(keyword));
}

function isValidationError(message: string): boolean {
  const keywords = ['validation', 'Validation'];
  return keywords.some((keyword) => message.includes(keyword));
}
