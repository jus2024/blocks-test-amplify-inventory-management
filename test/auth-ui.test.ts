// Unit tests for src/auth-ui.ts state transitions
// **Validates: Requirements 1.2, 1.3, 1.5**

import { test, mock, beforeEach, describe } from 'node:test';
import assert from 'node:assert';

// --- Mock aws-amplify/auth ---
const mockSignIn = mock.fn<(...args: any[]) => Promise<any>>();
const mockSignUp = mock.fn<(...args: any[]) => Promise<any>>();
const mockSignOut = mock.fn<(...args: any[]) => Promise<any>>();
const mockConfirmSignUp = mock.fn<(...args: any[]) => Promise<any>>();
const mockGetCurrentUser = mock.fn<(...args: any[]) => Promise<any>>();

mock.module('aws-amplify/auth', {
  namedExports: {
    signIn: mockSignIn,
    signUp: mockSignUp,
    signOut: mockSignOut,
    confirmSignUp: mockConfirmSignUp,
    getCurrentUser: mockGetCurrentUser,
  },
});

// --- Mock lit-html ---
const renderCalls: Array<{ template: any; container: any }> = [];
mock.module('lit-html', {
  namedExports: {
    html: (strings: TemplateStringsArray, ...values: any[]) => ({ strings, values }),
    render: (template: any, container: any) => {
      renderCalls.push({ template, container });
    },
  },
});

// Import the module under test AFTER mocks are set up
const { createAuthUI, handleSignOut } = await import('../src/auth-ui.js');

describe('auth-ui state transitions', () => {
  beforeEach(() => {
    mockSignIn.mock.resetCalls();
    mockSignUp.mock.resetCalls();
    mockSignOut.mock.resetCalls();
    mockConfirmSignUp.mock.resetCalls();
    mockGetCurrentUser.mock.resetCalls();
    renderCalls.length = 0;
  });

  test('createAuthUI calls onAuthenticated when user is already signed in', async () => {
    // getCurrentUser resolves → user is already authenticated
    mockGetCurrentUser.mock.mockImplementation(async () => ({
      userId: 'user-123',
      username: 'test@example.com',
    }));

    const container = {} as any;
    let authenticated = false;
    createAuthUI(container, () => {
      authenticated = true;
    });

    // Wait for the async getCurrentUser promise to resolve
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(authenticated, true, 'onAuthenticated should be called when user is already signed in');
  });

  test('createAuthUI renders sign-in form when user is not authenticated', async () => {
    // getCurrentUser rejects → user needs to sign in
    mockGetCurrentUser.mock.mockImplementation(async () => {
      throw new Error('UserUnAuthenticatedException');
    });

    const container = {} as any;
    let authenticated = false;
    createAuthUI(container, () => {
      authenticated = true;
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(authenticated, false, 'onAuthenticated should NOT be called');
    assert.ok(renderCalls.length > 0, 'Should have rendered the auth form');
  });

  test('handleSignOut calls signOut and re-renders sign-in form', async () => {
    // Set up: user is not authenticated (to initialize internal state)
    mockGetCurrentUser.mock.mockImplementation(async () => {
      throw new Error('UserUnAuthenticatedException');
    });
    mockSignOut.mock.mockImplementation(async () => {});

    const container = {} as any;
    createAuthUI(container, () => {});
    await new Promise((r) => setTimeout(r, 50));

    // Clear render calls after initial setup
    renderCalls.length = 0;

    await handleSignOut();

    assert.strictEqual(mockSignOut.mock.callCount(), 1, 'signOut should be called once');
    assert.ok(renderCalls.length > 0, 'Should have re-rendered after sign out');
  });
});
