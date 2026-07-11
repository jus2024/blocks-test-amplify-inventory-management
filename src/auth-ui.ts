/**
 * Cognito Auth UI — src/auth-ui.ts
 *
 * lit-html ベースの認証 UI。aws-amplify/auth の関数を使って
 * サインイン / サインアップ / 確認コード入力 / サインアウトを提供する。
 */
import { signIn, signUp, signOut, confirmSignUp, getCurrentUser } from 'aws-amplify/auth';
import { html, render } from 'lit-html';

type AuthView = 'signIn' | 'signUp' | 'confirmSignUp';

let currentView: AuthView = 'signIn';
let errorMessage = '';
let signUpEmail = '';
let container: HTMLElement;
let onAuthenticatedCallback: () => void;

/**
 * 認証 UI を初期化する。すでに認証済みなら onAuthenticated を呼ぶ。
 */
export function createAuthUI(el: HTMLElement, onAuthenticated: () => void): void {
  container = el;
  onAuthenticatedCallback = onAuthenticated;

  // すでに認証済みか確認
  getCurrentUser()
    .then(() => onAuthenticated())
    .catch(() => renderAuthView());
}

/**
 * サインアウトして signIn 画面に戻す。
 */
export async function handleSignOut(): Promise<void> {
  await signOut();
  currentView = 'signIn';
  errorMessage = '';
  renderAuthView();
}

// ─── 内部レンダリング ────────────────────────────────────────────────────────

function renderAuthView() {
  const template =
    currentView === 'signIn'
      ? renderSignInForm()
      : currentView === 'signUp'
        ? renderSignUpForm()
        : renderConfirmSignUpForm();

  render(template, container);
}

function renderSignInForm() {
  return html`
    <div style="max-width:400px;margin:40px auto;padding:24px">
      <h2>サインイン</h2>
      ${errorMessage ? html`<div style="color:red;margin-bottom:12px;padding:8px;background:#fff0f0;border-radius:4px">${errorMessage}</div>` : ''}
      <form @submit=${handleSignIn} style="display:grid;gap:12px">
        <input id="auth-email" type="email" placeholder="メールアドレス" required style="padding:8px;border:1px solid #ccc;border-radius:4px" />
        <input id="auth-password" type="password" placeholder="パスワード" required style="padding:8px;border:1px solid #ccc;border-radius:4px" />
        <button type="submit" style="padding:10px;background:#0073bb;color:white;border:none;border-radius:4px;cursor:pointer">サインイン</button>
      </form>
      <p style="margin-top:12px;text-align:center">
        アカウントをお持ちでない方
        <a href="#" @click=${(e: Event) => { e.preventDefault(); switchTo('signUp'); }} style="color:#0073bb">サインアップ</a>
      </p>
    </div>
  `;
}

function renderSignUpForm() {
  return html`
    <div style="max-width:400px;margin:40px auto;padding:24px">
      <h2>サインアップ</h2>
      ${errorMessage ? html`<div style="color:red;margin-bottom:12px;padding:8px;background:#fff0f0;border-radius:4px">${errorMessage}</div>` : ''}
      <form @submit=${handleSignUp} style="display:grid;gap:12px">
        <input id="auth-email" type="email" placeholder="メールアドレス" required style="padding:8px;border:1px solid #ccc;border-radius:4px" />
        <input id="auth-password" type="password" placeholder="パスワード" required style="padding:8px;border:1px solid #ccc;border-radius:4px" />
        <input id="auth-password-confirm" type="password" placeholder="パスワード（確認）" required style="padding:8px;border:1px solid #ccc;border-radius:4px" />
        <button type="submit" style="padding:10px;background:#0073bb;color:white;border:none;border-radius:4px;cursor:pointer">サインアップ</button>
      </form>
      <p style="margin-top:12px;text-align:center">
        すでにアカウントをお持ちの方
        <a href="#" @click=${(e: Event) => { e.preventDefault(); switchTo('signIn'); }} style="color:#0073bb">サインイン</a>
      </p>
    </div>
  `;
}

function renderConfirmSignUpForm() {
  return html`
    <div style="max-width:400px;margin:40px auto;padding:24px">
      <h2>メール確認</h2>
      <p style="margin-bottom:12px;color:#555">${signUpEmail} に確認コードを送信しました。</p>
      ${errorMessage ? html`<div style="color:red;margin-bottom:12px;padding:8px;background:#fff0f0;border-radius:4px">${errorMessage}</div>` : ''}
      <form @submit=${handleConfirmSignUp} style="display:grid;gap:12px">
        <input id="auth-code" type="text" placeholder="確認コード" required style="padding:8px;border:1px solid #ccc;border-radius:4px" />
        <button type="submit" style="padding:10px;background:#0073bb;color:white;border:none;border-radius:4px;cursor:pointer">確認</button>
      </form>
      <p style="margin-top:12px;text-align:center">
        <a href="#" @click=${(e: Event) => { e.preventDefault(); switchTo('signIn'); }} style="color:#0073bb">サインインに戻る</a>
      </p>
    </div>
  `;
}

// ─── ビュー切り替え ──────────────────────────────────────────────────────────

function switchTo(view: AuthView) {
  currentView = view;
  errorMessage = '';
  renderAuthView();
}

// ─── 認証ハンドラ ────────────────────────────────────────────────────────────

async function handleSignIn(e: Event) {
  e.preventDefault();
  errorMessage = '';

  const email = (container.querySelector('#auth-email') as HTMLInputElement).value.trim();
  const password = (container.querySelector('#auth-password') as HTMLInputElement).value;

  try {
    const result = await signIn({ username: email, password });
    if (result.isSignedIn) {
      onAuthenticatedCallback();
    } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
      signUpEmail = email;
      switchTo('confirmSignUp');
    }
  } catch (err: any) {
    if (err.name === 'UserNotConfirmedException') {
      signUpEmail = email;
      switchTo('confirmSignUp');
    } else {
      errorMessage = err.message || '認証に失敗しました';
      renderAuthView();
    }
  }
}

async function handleSignUp(e: Event) {
  e.preventDefault();
  errorMessage = '';

  const email = (container.querySelector('#auth-email') as HTMLInputElement).value.trim();
  const password = (container.querySelector('#auth-password') as HTMLInputElement).value;
  const passwordConfirm = (container.querySelector('#auth-password-confirm') as HTMLInputElement).value;

  if (password !== passwordConfirm) {
    errorMessage = 'パスワードが一致しません';
    renderAuthView();
    return;
  }

  try {
    await signUp({ username: email, password });
    signUpEmail = email;
    switchTo('confirmSignUp');
  } catch (err: any) {
    errorMessage = err.message || 'サインアップに失敗しました';
    renderAuthView();
  }
}

async function handleConfirmSignUp(e: Event) {
  e.preventDefault();
  errorMessage = '';

  const code = (container.querySelector('#auth-code') as HTMLInputElement).value.trim();

  try {
    await confirmSignUp({ username: signUpEmail, confirmationCode: code });
    switchTo('signIn');
  } catch (err: any) {
    errorMessage = err.message || '確認に失敗しました';
    renderAuthView();
  }
}
