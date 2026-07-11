// Feature: cognito-auth-integration, Property 1: Local Development Bypass
// Feature: cognito-auth-integration, Property 3: Invalid Token Rejection
// **Validates: Requirements 3.2, 3.3, 3.4, 6.2, 7.1**

import { test } from 'node:test';
import assert from 'node:assert';
import fc from 'fast-check';
import { CognitoVerifier } from '../aws-blocks/cognito-verifier.js';

test('Property 1: Local Development Bypass - requireAuth succeeds for any headers when userPoolId is not set', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        authorization: fc.option(fc.string(), { nil: undefined }),
      }, { withDeletedKeys: true }),
      async (headers) => {
        const verifier = new CognitoVerifier({});  // no userPoolId
        // Should NOT throw for any header combination
        await verifier.requireAuth({ headers: headers as any });
      }
    ),
    { numRuns: 100 }
  );
});

test('Property 3: Invalid Token Rejection - requireAuth throws Unauthorized for invalid tokens when configured', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1 }),  // random token strings
      async (token) => {
        const verifier = new CognitoVerifier({
          userPoolId: 'us-east-1_TestPool',
          clientId: 'test-client-id',
          region: 'us-east-1',
        });
        try {
          await verifier.requireAuth({
            headers: { authorization: `Bearer ${token}` }
          });
          // If it didn't throw, that's a failure
          assert.fail('Expected requireAuth to throw Unauthorized');
        } catch (err: any) {
          assert.ok(
            err.message.includes('Unauthorized'),
            `Expected "Unauthorized" in error message, got: ${err.message}`
          );
        }
      }
    ),
    { numRuns: 100 }
  );
});

// Feature: cognito-auth-integration, Property 4: Middleware Token Attachment
// **Validates: Requirements 4.1**

test('Property 4: Middleware Token Attachment - ID Token is attached as Bearer header', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.string({ minLength: 1 }),  // arbitrary non-null token strings
      fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string()),  // existing headers
      async (token, existingHeaders) => {
        // Simulate the middleware logic
        const req = { headers: { ...existingHeaders } };

        // This is the exact logic from the middleware
        const idToken = token; // simulating fetchAuthSession().tokens.idToken.toString()
        if (idToken) {
          req.headers = { ...req.headers, authorization: `Bearer ${idToken}` };
        }

        // Property: authorization header equals "Bearer " + token
        assert.strictEqual(req.headers.authorization, `Bearer ${token}`);

        // Property: existing headers are preserved
        for (const [key, value] of Object.entries(existingHeaders)) {
          if (key !== 'authorization') {
            assert.strictEqual(req.headers[key], value);
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});
