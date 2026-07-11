// aws-blocks/cognito-verifier.ts

import { CognitoJwtVerifier } from 'aws-jwt-verify';

interface CognitoVerifierConfig {
  userPoolId?: string;
  clientId?: string;
  region?: string;
}

export class CognitoVerifier {
  private verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

  constructor(private config: CognitoVerifierConfig) {
    if (config.userPoolId && config.clientId) {
      this.verifier = CognitoJwtVerifier.create({
        userPoolId: config.userPoolId,
        tokenUse: 'id',
        clientId: config.clientId,
      });
    }
  }

  async requireAuth(context: { headers?: Record<string, string> }): Promise<void> {
    // ローカル開発時 (env vars 未設定) は認証スキップ
    if (!this.verifier) return;

    const authHeader = context.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Error('Unauthorized: missing or invalid token');
    }

    const token = authHeader.slice(7);
    try {
      await this.verifier.verify(token);
    } catch (err) {
      throw new Error('Unauthorized: invalid token');
    }
  }
}
