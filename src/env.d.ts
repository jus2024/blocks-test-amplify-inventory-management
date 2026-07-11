// Type declarations for optional modules used in production deployment.
// These modules may not be installed during local development.

declare module 'aws-amplify/auth' {
  export function fetchAuthSession(): Promise<{
    tokens?: {
      idToken?: { toString(): string };
      accessToken?: { toString(): string };
    };
  }>;

  export function signIn(input: { username: string; password: string }): Promise<{
    isSignedIn: boolean;
    nextStep?: { signInStep: string };
  }>;

  export function signUp(input: { username: string; password: string }): Promise<{
    isSignUpComplete: boolean;
    nextStep?: { signUpStep: string };
  }>;

  export function signOut(): Promise<void>;

  export function confirmSignUp(input: { username: string; confirmationCode: string }): Promise<{
    isSignUpComplete: boolean;
  }>;

  export function getCurrentUser(): Promise<{ userId: string; username: string }>;
}

declare module 'aws-blocks/client' {
  import type { BlocksMiddleware } from '@aws-blocks/core/client';
  export function registerMiddleware(middleware: BlocksMiddleware | ((request: any) => any | Promise<any>)): void;
}
