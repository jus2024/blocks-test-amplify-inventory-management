import { BlocksBackend } from '@aws-blocks/blocks/cdk';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initBlocks(backend: any) {
  const blocksStack = backend.createStack('blocks');

  const blocksBackend = await BlocksBackend.create(blocksStack, 'inventory', {
    backendHandlerPath: path.resolve(__dirname, '../aws-blocks/index.handler.ts'),
    backendCDKPath: path.resolve(__dirname, '../aws-blocks/index.ts'),
  });

  // Inject Cognito env vars into the Blocks Lambda
  const userPool = backend.auth.resources.userPool;
  const userPoolClient = backend.auth.resources.userPoolClient;

  blocksBackend.handler.addEnvironment('COGNITO_USER_POOL_ID', userPool.userPoolId);
  blocksBackend.handler.addEnvironment('COGNITO_CLIENT_ID', userPoolClient.userPoolClientId);
  blocksBackend.handler.addEnvironment('COGNITO_REGION', blocksStack.region);

  // CORS: Allow local dev frontend to call the sandbox API
  blocksBackend.handler.addEnvironment('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:3000');
  blocksBackend.handler.addEnvironment('BLOCKS_SANDBOX', 'true');

  // Output Blocks API URL
  backend.addOutput({
    custom: {
      blocks_api_url: blocksBackend.apiUrl,
    },
  });
}
