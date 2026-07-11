/**
 * 共有 Amplify Data クライアント
 * 循環依存を避けるため、src/index.ts とは別にクライアントインスタンスを生成する。
 * generateClient は Amplify.configure() 呼び出し後にグローバル設定を参照するため、
 * モジュール間で複数回呼び出しても同一設定で動作する。
 */
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';

export const dataClient = generateClient<Schema>();
export type { Schema };
