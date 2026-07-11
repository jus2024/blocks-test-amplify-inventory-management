/**
 * Frontend — src/index.ts
 *
 * 資材在庫管理システム (Inventory Management System)
 * Navigation with sections: materials, warehouses, transactions, stock inquiry, alerts
 * Uses lit-html for declarative rendering with @event binding.
 */
import { api } from 'aws-blocks';
import { html, render } from 'lit-html';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import outputs from '../amplify_outputs.json';
import { createAuthUI, handleSignOut } from './auth-ui.js';
import { createNote, updateNote, deleteNote, listNotes } from './lib/notes.js';
import { upsertPreference, listPreferences as listPreferencesApi, deletePreference as deletePreferenceApi } from './lib/preferences.js';
import { validateNoteTitle, validatePreferenceKey, validatePreferenceValue } from './lib/validation.js';
import { handleAppSyncError } from './lib/error-handler.js';

// ─── Amplify Configuration (called once) ─────────────────────────────────────
Amplify.configure(outputs as any);
export const dataClient = generateClient<Schema>();

// ─── Amplify Auth Middleware ──────────────────────────────────────────────────
// When deployed with Amplify, automatically attaches Cognito ID token as Bearer header.
// In local development (no Cognito session), the middleware is a no-op.
try {
  const { fetchAuthSession } = await import('aws-amplify/auth');
  const { registerMiddleware } = await import('@aws-blocks/core/client');

  registerMiddleware({
    async onRequest(req) {
      try {
        const session = await fetchAuthSession();
        const idToken = session.tokens?.idToken?.toString();
        if (idToken) {
          req.headers = { ...req.headers, authorization: `Bearer ${idToken}` };
        }
      } catch {
        // Not authenticated via Cognito — continue without token
      }
      return req;
    },
  });
} catch {
  // aws-amplify not available or not configured — skip
}

// ─── App Initialization ──────────────────────────────────────────────────────
const appContainer = document.getElementById('app')!;
const hasAuth = !!(outputs as any)?.auth?.user_pool_id;

if (hasAuth) {
  // Production: show Cognito auth UI first
  createAuthUI(appContainer, () => renderApp());
} else {
  // Local development: skip auth, render app directly
  renderApp();
}

function renderApp() {
  // Clear the container
  appContainer.innerHTML = '';

  const container = document.createElement('div');
  appContainer.appendChild(container);

    type Section = 'materials' | 'warehouses' | 'transactions' | 'stock' | 'alerts' | 'notes' | 'settings';
    let currentSection: Section = 'materials';
    let errorMsg = '';

    // ─── Materials state ──────────────────────────────────────────
    type Material = { id: string; name: string; sku: string; unit: string; category: string; lowStockThreshold: number; createdAt: string; updatedAt: string };
    let materials: Material[] = [];
    let editingMaterial: Material | null = null;

    // ─── Warehouses state ─────────────────────────────────────────
    type Warehouse = { id: string; name: string; location: string; createdAt: string; updatedAt: string };
    let warehouses: Warehouse[] = [];
    let editingWarehouse: Warehouse | null = null;

    // ─── Stock inquiry state ──────────────────────────────────────
    type CurrentStockEntry = { materialId: string; materialName: string; materialSku: string; warehouseId: string; warehouseName: string; quantity: number };
    let stockEntries: CurrentStockEntry[] = [];
    let stockFilterMaterial = '';
    let stockFilterWarehouse = '';

    // ─── Alerts state ─────────────────────────────────────────────
    type StockAlert = { id: string; materialId: string; materialName: string; currentQuantity: number; threshold: number; acknowledged: boolean; acknowledgedAt: string | null; createdAt: string };
    let alerts: StockAlert[] = [];

    // ─── Notes state ──────────────────────────────────────────────
    type UserNoteView = { id: string; title: string; content: string | null; createdAt: string; updatedAt: string };
    let notes: UserNoteView[] = [];
    let editingNote: UserNoteView | null = null;
    let isLoadingNotes = false;

    // ─── Settings state ─────────────────────────────────────────
    type UserPreferenceView = { id: string; key: string; value: string; createdAt: string; updatedAt: string };
    let preferences: UserPreferenceView[] = [];
    let isLoadingPreferences = false;

    // ─── Shared helpers ───────────────────────────────────────────
    function setError(msg: string) { errorMsg = msg; redraw(); }
    function clearError() { errorMsg = ''; }

    function nav(section: Section) {
      currentSection = section;
      clearError();
      editingMaterial = null;
      editingWarehouse = null;
      editingNote = null;
      // Reset loading states
      isLoadingNotes = false;
      isLoadingPreferences = false;
      redraw();
      loadSection();
    }

    function loadSection() {
      if (currentSection === 'materials') loadMaterials();
      else if (currentSection === 'warehouses') loadWarehouses();
      else if (currentSection === 'transactions') loadTransactionDeps();
      else if (currentSection === 'stock') loadStock();
      else if (currentSection === 'alerts') loadAlerts();
      else if (currentSection === 'notes') loadNotes();
      else if (currentSection === 'settings') loadPreferences();
    }

    // ─── Materials ────────────────────────────────────────────────
    async function loadMaterials() {
      try {
        materials = await api.listMaterials();
        clearError();
        redraw();
      } catch (e: any) {
        setError(e.message || 'Failed to load materials');
      }
    }

    function renderMaterials() {
      return html`
        <h2>資材マスタ</h2>

        <!-- Create/Edit form -->
        <form @submit=${(e: Event) => { e.preventDefault(); submitMaterial(); }} style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px">
          <input id="mat-name" type="text" placeholder="品名 (1-100)" maxlength="100" .value=${editingMaterial?.name ?? ''} />
          <input id="mat-sku" type="text" placeholder="SKU (英数-)" maxlength="50" .value=${editingMaterial?.sku ?? ''} ?disabled=${!!editingMaterial} />
          <input id="mat-unit" type="text" placeholder="単位 (1-20)" maxlength="20" .value=${editingMaterial?.unit ?? ''} />
          <input id="mat-category" type="text" placeholder="カテゴリ (1-50)" maxlength="50" .value=${editingMaterial?.category ?? ''} />
          <input id="mat-threshold" type="number" placeholder="閾値 (0-999999)" min="0" max="999999" .value=${String(editingMaterial?.lowStockThreshold ?? 0)} />
          <button type="submit">${editingMaterial ? '更新' : '登録'}</button>
          ${editingMaterial ? html`<button type="button" @click=${cancelEditMaterial}>キャンセル</button>` : ''}
        </form>

        <!-- List -->
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid #ddd;text-align:left">
            <th>品名</th><th>SKU</th><th>単位</th><th>カテゴリ</th><th>閾値</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${materials.map(m => html`
              <tr style="border-bottom:1px solid #eee">
                <td>${m.name}</td>
                <td>${m.sku}</td>
                <td>${m.unit}</td>
                <td>${m.category}</td>
                <td>${m.lowStockThreshold}</td>
                <td>
                  <button @click=${() => startEditMaterial(m)}>編集</button>
                  <button @click=${() => deleteMaterial(m.id)}>削除</button>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      `;
    }

    function startEditMaterial(m: Material) { editingMaterial = m; redraw(); }
    function cancelEditMaterial() { editingMaterial = null; redraw(); }

    async function submitMaterial() {
      const name = (container.querySelector('#mat-name') as HTMLInputElement).value.trim();
      const sku = (container.querySelector('#mat-sku') as HTMLInputElement).value.trim();
      const unit = (container.querySelector('#mat-unit') as HTMLInputElement).value.trim();
      const category = (container.querySelector('#mat-category') as HTMLInputElement).value.trim();
      const threshold = parseInt((container.querySelector('#mat-threshold') as HTMLInputElement).value) || 0;

      try {
        if (editingMaterial) {
          await api.updateMaterial(editingMaterial.id, { name, unit, category, lowStockThreshold: threshold });
          editingMaterial = null;
        } else {
          await api.createMaterial({ name, sku, unit, category, lowStockThreshold: threshold });
        }
        clearError();
        await loadMaterials();
      } catch (e: any) {
        setError(e.message || 'Operation failed');
      }
    }

    async function deleteMaterial(id: string) {
      try {
        await api.deleteMaterial(id);
        clearError();
        await loadMaterials();
      } catch (e: any) {
        setError(e.message || 'Delete failed');
      }
    }

    // ─── Warehouses ───────────────────────────────────────────────
    async function loadWarehouses() {
      try {
        warehouses = await api.listWarehouses();
        clearError();
        redraw();
      } catch (e: any) {
        setError(e.message || 'Failed to load warehouses');
      }
    }

    function renderWarehouses() {
      return html`
        <h2>倉庫マスタ</h2>

        <!-- Create/Edit form -->
        <form @submit=${(e: Event) => { e.preventDefault(); submitWarehouse(); }} style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px">
          <input id="wh-name" type="text" placeholder="倉庫名 (1-100)" maxlength="100" .value=${editingWarehouse?.name ?? ''} />
          <input id="wh-location" type="text" placeholder="所在地 (1-200)" maxlength="200" .value=${editingWarehouse?.location ?? ''} />
          <button type="submit">${editingWarehouse ? '更新' : '登録'}</button>
          ${editingWarehouse ? html`<button type="button" @click=${cancelEditWarehouse}>キャンセル</button>` : ''}
        </form>

        <!-- List -->
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid #ddd;text-align:left">
            <th>倉庫名</th><th>所在地</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${warehouses.map(w => html`
              <tr style="border-bottom:1px solid #eee">
                <td>${w.name}</td>
                <td>${w.location}</td>
                <td>
                  <button @click=${() => startEditWarehouse(w)}>編集</button>
                  <button @click=${() => deleteWarehouse(w.id)}>削除</button>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      `;
    }

    function startEditWarehouse(w: Warehouse) { editingWarehouse = w; redraw(); }
    function cancelEditWarehouse() { editingWarehouse = null; redraw(); }

    async function submitWarehouse() {
      const name = (container.querySelector('#wh-name') as HTMLInputElement).value.trim();
      const location = (container.querySelector('#wh-location') as HTMLInputElement).value.trim();

      try {
        if (editingWarehouse) {
          await api.updateWarehouse(editingWarehouse.id, { name, location });
          editingWarehouse = null;
        } else {
          await api.createWarehouse({ name, location });
        }
        clearError();
        await loadWarehouses();
      } catch (e: any) {
        setError(e.message || 'Operation failed');
      }
    }

    async function deleteWarehouse(id: string) {
      try {
        await api.deleteWarehouse(id);
        clearError();
        await loadWarehouses();
      } catch (e: any) {
        setError(e.message || 'Delete failed');
      }
    }

    // ─── Transactions ─────────────────────────────────────────────
    async function loadTransactionDeps() {
      try {
        materials = await api.listMaterials();
        warehouses = await api.listWarehouses();
        clearError();
        redraw();
      } catch (e: any) {
        setError(e.message || 'Failed to load data');
      }
    }

    function renderTransactions() {
      return html`
        <h2>入出庫</h2>

        <form @submit=${(e: Event) => { e.preventDefault(); submitTransaction(); }} style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px">
          <select id="tx-type">
            <option value="in">入庫</option>
            <option value="out">出庫</option>
          </select>

          <select id="tx-material">
            <option value="">-- 資材を選択 --</option>
            ${materials.map(m => html`<option value=${m.id}>${m.name} (${m.sku})</option>`)}
          </select>

          <select id="tx-warehouse">
            <option value="">-- 倉庫を選択 --</option>
            ${warehouses.map(w => html`<option value=${w.id}>${w.name}</option>`)}
          </select>

          <input id="tx-quantity" type="number" placeholder="数量 (1-999999)" min="1" max="999999" />
          <input id="tx-note" type="text" placeholder="備考 (任意, 最大500)" maxlength="500" />
          <button type="submit">記録</button>
        </form>
      `;
    }

    async function submitTransaction() {
      const type = (container.querySelector('#tx-type') as HTMLSelectElement).value as 'in' | 'out';
      const materialId = (container.querySelector('#tx-material') as HTMLSelectElement).value;
      const warehouseId = (container.querySelector('#tx-warehouse') as HTMLSelectElement).value;
      const quantity = parseInt((container.querySelector('#tx-quantity') as HTMLInputElement).value) || 0;
      const note = (container.querySelector('#tx-note') as HTMLInputElement).value.trim() || undefined;

      if (!materialId || !warehouseId) {
        setError('資材と倉庫を選択してください');
        return;
      }

      try {
        await api.recordTransaction({ materialId, warehouseId, type, quantity, note });
        clearError();
        // Reset form
        (container.querySelector('#tx-quantity') as HTMLInputElement).value = '';
        (container.querySelector('#tx-note') as HTMLInputElement).value = '';
        redraw();
      } catch (e: any) {
        setError(e.message || 'Transaction failed');
      }
    }

    // ─── Stock Inquiry ────────────────────────────────────────────
    async function loadStock() {
      try {
        // Load materials and warehouses for filter dropdowns
        materials = await api.listMaterials();
        warehouses = await api.listWarehouses();
        const filter: { materialId?: string; warehouseId?: string } = {};
        if (stockFilterMaterial) filter.materialId = stockFilterMaterial;
        if (stockFilterWarehouse) filter.warehouseId = stockFilterWarehouse;
        stockEntries = await api.getCurrentStock(Object.keys(filter).length > 0 ? filter : undefined);
        clearError();
        redraw();
      } catch (e: any) {
        setError(e.message || 'Failed to load stock');
      }
    }

    function renderStock() {
      return html`
        <h2>在庫照会</h2>

        <!-- Filters -->
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <select id="stock-filter-material" @change=${(e: Event) => { stockFilterMaterial = (e.target as HTMLSelectElement).value; loadStock(); }}>
            <option value="">全資材</option>
            ${materials.map(m => html`<option value=${m.id} ?selected=${stockFilterMaterial === m.id}>${m.name}</option>`)}
          </select>

          <select id="stock-filter-warehouse" @change=${(e: Event) => { stockFilterWarehouse = (e.target as HTMLSelectElement).value; loadStock(); }}>
            <option value="">全倉庫</option>
            ${warehouses.map(w => html`<option value=${w.id} ?selected=${stockFilterWarehouse === w.id}>${w.name}</option>`)}
          </select>
        </div>

        <!-- Stock table -->
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid #ddd;text-align:left">
            <th>資材名</th><th>倉庫名</th><th>数量</th>
          </tr></thead>
          <tbody>
            ${stockEntries.map(s => html`
              <tr style="border-bottom:1px solid #eee">
                <td>${s.materialName}</td>
                <td>${s.warehouseName}</td>
                <td>${s.quantity}</td>
              </tr>
            `)}
            ${stockEntries.length === 0 ? html`<tr><td colspan="3" style="text-align:center;color:#888;padding:16px">データなし</td></tr>` : ''}
          </tbody>
        </table>
      `;
    }

    // ─── Alerts ───────────────────────────────────────────────────
    async function loadAlerts() {
      try {
        const result = await api.listAlerts();
        alerts = result.alerts.filter(a => !a.acknowledged);
        clearError();
        redraw();
      } catch (e: any) {
        setError(e.message || 'Failed to load alerts');
      }
    }

    function renderAlerts() {
      return html`
        <h2>アラート</h2>

        ${alerts.length === 0 ? html`<p style="color:#888">未確認のアラートはありません</p>` : ''}

        <table style="width:100%;border-collapse:collapse">
          ${alerts.length > 0 ? html`
            <thead><tr style="border-bottom:2px solid #ddd;text-align:left">
              <th>資材名</th><th>現在数量</th><th>閾値</th><th>操作</th>
            </tr></thead>
          ` : ''}
          <tbody>
            ${alerts.map(a => html`
              <tr style="border-bottom:1px solid #eee">
                <td>${a.materialName}</td>
                <td>${a.currentQuantity}</td>
                <td>${a.threshold}</td>
                <td><button @click=${() => acknowledgeAlert(a.id)}>確認</button></td>
              </tr>
            `)}
          </tbody>
        </table>
      `;
    }

    async function acknowledgeAlert(alertId: string) {
      try {
        await api.acknowledgeAlert(alertId);
        clearError();
        await loadAlerts();
      } catch (e: any) {
        setError(e.message || 'Acknowledge failed');
      }
    }

    // ─── Notes ────────────────────────────────────────────────────
    async function loadNotes() {
      isLoadingNotes = true;
      redraw();
      try {
        const result = await listNotes();
        notes = result as UserNoteView[];
        clearError();
      } catch (e: any) {
        setError(handleAppSyncError(e));
      } finally {
        isLoadingNotes = false;
        redraw();
      }
    }

    async function submitNote() {
      const title = (container.querySelector('#note-title') as HTMLInputElement).value.trim();
      const content = (container.querySelector('#note-content') as HTMLTextAreaElement).value;

      // Frontend validation
      const titleValidation = validateNoteTitle(title);
      if (!titleValidation.valid) {
        setError(titleValidation.error!);
        return;
      }

      try {
        if (editingNote) {
          await updateNote(editingNote.id, title, content || undefined);
          editingNote = null;
        } else {
          await createNote(title, content || undefined);
        }
        clearError();
        await loadNotes();
      } catch (e: any) {
        setError(handleAppSyncError(e));
      }
    }

    async function deleteNoteHandler(id: string) {
      try {
        await deleteNote(id);
        clearError();
        await loadNotes();
      } catch (e: any) {
        setError(handleAppSyncError(e));
      }
    }

    function startEditNote(n: UserNoteView) { editingNote = n; redraw(); }
    function cancelEditNote() { editingNote = null; redraw(); }

    function renderNotes() {
      if (isLoadingNotes) {
        return html`<h2>メモ</h2><p>読み込み中...</p>`;
      }

      return html`
        <h2>メモ</h2>

        <!-- Create/Edit form -->
        <form @submit=${(e: Event) => { e.preventDefault(); submitNote(); }} style="display:grid;gap:8px;margin-bottom:16px">
          <input id="note-title" type="text" placeholder="タイトル (1-200)" maxlength="200" .value=${editingNote?.title ?? ''} />
          <textarea id="note-content" placeholder="本文 (任意, 最大10000)" maxlength="10000" rows="4" .value=${editingNote?.content ?? ''}></textarea>
          <div style="display:flex;gap:8px">
            <button type="submit">${editingNote ? '更新' : '作成'}</button>
            ${editingNote ? html`<button type="button" @click=${cancelEditNote}>キャンセル</button>` : ''}
          </div>
        </form>

        <!-- List -->
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid #ddd;text-align:left">
            <th>タイトル</th><th>本文</th><th>更新日時</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${notes.map(n => html`
              <tr style="border-bottom:1px solid #eee">
                <td>${n.title}</td>
                <td>${n.content ? n.content.substring(0, 50) + (n.content.length > 50 ? '...' : '') : ''}</td>
                <td>${n.updatedAt}</td>
                <td>
                  <button @click=${() => startEditNote(n)}>編集</button>
                  <button @click=${() => deleteNoteHandler(n.id)}>削除</button>
                </td>
              </tr>
            `)}
            ${notes.length === 0 ? html`<tr><td colspan="4" style="text-align:center;color:#888;padding:16px">メモなし</td></tr>` : ''}
          </tbody>
        </table>
      `;
    }

    // ─── Settings ─────────────────────────────────────────────────
    async function loadPreferences() {
      isLoadingPreferences = true;
      redraw();
      try {
        const result = await listPreferencesApi();
        preferences = result as UserPreferenceView[];
        clearError();
      } catch (e: any) {
        setError(handleAppSyncError(e));
      } finally {
        isLoadingPreferences = false;
        redraw();
      }
    }

    async function submitPreference() {
      const key = (container.querySelector('#pref-key') as HTMLInputElement).value.trim();
      const value = (container.querySelector('#pref-value') as HTMLInputElement).value;

      // Frontend validation
      const keyValidation = validatePreferenceKey(key);
      if (!keyValidation.valid) {
        setError(keyValidation.error!);
        return;
      }
      const valueValidation = validatePreferenceValue(value);
      if (!valueValidation.valid) {
        setError(valueValidation.error!);
        return;
      }

      try {
        await upsertPreference(key, value);
        clearError();
        await loadPreferences();
      } catch (e: any) {
        setError(handleAppSyncError(e));
      }
    }

    async function deletePreferenceHandler(id: string) {
      try {
        await deletePreferenceApi(id);
        clearError();
        await loadPreferences();
      } catch (e: any) {
        setError(handleAppSyncError(e));
      }
    }

    function renderSettings() {
      if (isLoadingPreferences) {
        return html`<h2>設定</h2><p>読み込み中...</p>`;
      }

      return html`
        <h2>設定</h2>

        <!-- Key/Value input form -->
        <form @submit=${(e: Event) => { e.preventDefault(); submitPreference(); }} style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px">
          <input id="pref-key" type="text" placeholder="キー (1-128)" maxlength="128" />
          <input id="pref-value" type="text" placeholder="値 (1-2048)" maxlength="2048" />
          <button type="submit">保存</button>
        </form>

        <!-- Settings list -->
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="border-bottom:2px solid #ddd;text-align:left">
            <th>キー</th><th>値</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${preferences.map(p => html`
              <tr style="border-bottom:1px solid #eee">
                <td>${p.key}</td>
                <td>${p.value}</td>
                <td>
                  <button @click=${() => deletePreferenceHandler(p.id)}>削除</button>
                </td>
              </tr>
            `)}
            ${preferences.length === 0 ? html`<tr><td colspan="3" style="text-align:center;color:#888;padding:16px">設定なし</td></tr>` : ''}
          </tbody>
        </table>
      `;
    }

    // ─── Main render ──────────────────────────────────────────────
    function redraw() {
      render(html`
        <!-- Navigation -->
        <nav style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
          <button @click=${() => nav('materials')} style="font-weight:${currentSection === 'materials' ? 'bold' : 'normal'}">資材管理</button>
          <button @click=${() => nav('warehouses')} style="font-weight:${currentSection === 'warehouses' ? 'bold' : 'normal'}">倉庫管理</button>
          <button @click=${() => nav('transactions')} style="font-weight:${currentSection === 'transactions' ? 'bold' : 'normal'}">入出庫</button>
          <button @click=${() => nav('stock')} style="font-weight:${currentSection === 'stock' ? 'bold' : 'normal'}">在庫照会</button>
          <button @click=${() => nav('alerts')} style="font-weight:${currentSection === 'alerts' ? 'bold' : 'normal'}">アラート</button>
          <button @click=${() => nav('notes')} style="font-weight:${currentSection === 'notes' ? 'bold' : 'normal'}">メモ</button>
          <button @click=${() => nav('settings')} style="font-weight:${currentSection === 'settings' ? 'bold' : 'normal'}">設定</button>
          ${hasAuth ? html`<button @click=${() => handleSignOut()} style="margin-left:auto;background:#dc3545;color:white;border:none;border-radius:4px;padding:6px 12px;cursor:pointer">サインアウト</button>` : ''}
        </nav>

        <!-- Error display -->
        ${errorMsg ? html`<div style="color:red;margin-bottom:12px;padding:8px;background:#fff0f0;border-radius:4px">${errorMsg}</div>` : ''}

        <!-- Section content -->
        ${currentSection === 'materials' ? renderMaterials() : ''}
        ${currentSection === 'warehouses' ? renderWarehouses() : ''}
        ${currentSection === 'transactions' ? renderTransactions() : ''}
        ${currentSection === 'stock' ? renderStock() : ''}
        ${currentSection === 'alerts' ? renderAlerts() : ''}
        ${currentSection === 'notes' ? renderNotes() : ''}
        ${currentSection === 'settings' ? renderSettings() : ''}
      `, container);
    }

    loadSection();
}
