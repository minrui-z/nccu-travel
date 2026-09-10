import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createPublicExample } from '../lib/public-example.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/nccu-travel/';
const output = process.env.UI_QA_OUTPUT || 'qa-output/product-flow';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const failures = [], results = [], errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(new URL(base).origin)) external.push(request.url()); });
const check = async (name, action) => {
  try { await action(); results.push(name); console.log('PASS', name); }
  catch (error) { failures.push({ name, message: error.message }); console.log('FAIL', name, error.message); }
};
const field = (path) => page.locator(`[data-slot="tabs-content"]:not([hidden]) [data-field-path="${path}"]`).locator('input,textarea').first();
const go = (name) => page.getByRole('tab', { name: new RegExp('^' + name + '，') }).click();
const waitSaved = () => page.waitForFunction(() => document.querySelector('.draft-state')?.textContent?.includes('已儲存'));
const read = (key = 'active-draft', target = page) => target.evaluate(key => new Promise((resolve, reject) => {
  const r = indexedDB.open('nccu-travel-workbench', 1);
  r.onsuccess = () => { const db = r.result; const tx = db.transaction('local-records'); const q = tx.objectStore('local-records').get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); tx.oncomplete = () => db.close(); }; r.onerror = () => reject(r.error);
}), key);
const seed = async (draft) => {
  await page.goto(base); await waitSaved();
  await page.evaluate(value => new Promise((resolve, reject) => {
    const r = indexedDB.open('nccu-travel-workbench', 1);
    r.onsuccess = () => { const db = r.result; const tx = db.transaction('local-records', 'readwrite'); tx.objectStore('local-records').put(value, 'active-draft'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; r.onerror = () => reject(r.error);
  }), draft);
  await page.reload(); await waitSaved();
};
const menu = () => page.locator('.workspace-menu > summary').click();
const settle = async () => { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(180); };
const capture = async (name) => { if (process.env.CAPTURE_QA === '0') return; if (process.env.CAPTURE_MISSING === '1' && await stat(`${output}/${name}.png`).catch(() => null)) return; await settle(); await page.screenshot({ path: `${output}/${name}.png` }); };
const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page has horizontal overflow');
await page.goto(base); await waitSaved();
await check('New report starts without inline errors; required and optional labels are visible', async () => {
  assert.equal(await page.locator('[data-slot="tabs-content"]:not([hidden]) [aria-invalid="true"]').count(), 0);
  assert.match(await page.locator('[data-field-path="person.name"] label').innerText(), /必填/);
  assert.match(await page.locator('[data-field-path="voucherNumber"] label').innerText(), /選填/);
  await field('person.name').fill('填寫流程'); await field('person.identifier').focus(); await waitSaved();
  assert.equal((await read()).person.name, '填寫流程');
});
await check('Next and previous steps preserve input and reveal errors only after interaction', async () => {
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert.ok(await field('startDate').isVisible());
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  assert.equal(await field('person.name').inputValue(), '填寫流程');
  assert.equal(await field('person.identifier').getAttribute('aria-invalid'), 'true');
});
await check('Dates commit atomically, pending values survive navigation', async () => {
  await go('行程與生活費'); await field('startDate').fill('2026-09-01'); await field('endDate').fill('2026-09-04');
  assert.equal((await read()).startDate, '');
  await go('費用'); await go('行程與生活費'); assert.equal(await field('startDate').inputValue(), '2026-09-01');
  await page.getByRole('button', { name: '建立行程', exact: true }).click(); await waitSaved();
  const saved = await read(); assert.equal(saved.startDate, '2026-09-01'); assert.equal(saved.days.length, 4);
});
await seed(createPublicExample('student'));
await check('Capped claim is primary, amount difference remains distinct', async () => {
  const text = await page.locator('.editor-summary').innerText(); assert.match(text, /36,000/); assert.match(text, /計算旅費/); assert.match(text, /不向本案報支/);
});
await capture('basic-1440');
await check('Private day keeps its label and optional location without financial fields', async () => {
  await go('行程與生活費'); await page.getByRole('button', { name: /^編輯 09\/03/ }).click();
  assert.equal(await field('days.2.location').inputValue(), '波士頓');
  assert.equal(await page.locator('[data-slot="tabs-content"]:not([hidden]) [data-field-path="days.2.usdRate"]').count(), 0);
  assert.match(await page.locator('.daily-panel').innerText(), /個人行程/);
  await field('days.2.location').fill(''); await waitSaved(); assert.equal((await read()).days[2].usdRate, '');
});
await check('Shortening dates can cancel, then preserves affected expenses on apply', async () => {
  const before = await read(); await field('startDate').fill('2026-09-02'); await page.locator('.editor').getByRole('button', { name: '套用日期', exact: true }).click();
  const dialog = page.getByRole('alertdialog'); assert.match(await dialog.innerText(), /3 筆費用/);
  await dialog.getByRole('button', { name: '保留目前內容', exact: true }).click(); await dialog.waitFor({state:'hidden'}); assert.equal(await field('startDate').inputValue(), before.startDate);
  await field('startDate').fill('2026-09-02'); await page.locator('.editor').getByRole('button', { name: '套用日期', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '套用日期', exact: true }).click(); await waitSaved();
  const saved = await read(); assert.equal(saved.days.length, 3); assert.deepEqual(saved.expenses.map(e => [e.id, e.date, e.amount]), before.expenses.map(e => [e.id, e.date, e.amount]));
});
const mergeDraft = createPublicExample('general');
mergeDraft.days[0] = { ...mergeDraft.days[1], id: mergeDraft.days[0].id, date: mergeDraft.days[0].date };
mergeDraft.days[1] = { ...mergeDraft.days[0], id: mergeDraft.days[1].id, date: mergeDraft.days[1].date };
await seed(mergeDraft);
await check('Merge mode is separate, merged edits stay together, undo preserves edits', async () => {
  await go('行程與生活費'); assert.equal(await page.locator('.date-groups input[type="checkbox"]').count(), 0);
  await page.getByRole('button', { name: '合併日期', exact: true }).click();
  await page.locator('.date-groups input[type="checkbox"]').nth(0).check(); await page.locator('.date-groups input[type="checkbox"]').nth(1).check();
  await page.getByRole('button', { name: '合併選取', exact: true }).click(); await waitSaved();
  assert.equal((await read()).groups.length, 3); assert.equal(await page.locator('.date-groups input[type="checkbox"]').count(), 0);
  await field('days.0.work').fill('共同發表'); await waitSaved();
  const saved = await read(); assert.equal(saved.days[1].work, '共同發表'); assert.equal(saved.groups.length, 3);
  await page.getByRole('button', { name: '復原分欄', exact: true }).click(); await waitSaved();
  assert.equal((await read()).groups.length, 4); assert.equal((await read()).days[1].work, '共同發表');
});
await capture('trip-1440');
await seed(createPublicExample('student'));
await check('Expense list opens only one editor and preserves independent exchange rates', async () => {
  await go('費用'); assert.equal(await page.locator('.expense-editor').count(), 1);
  await page.locator('.expense-row-toggle').nth(1).click(); assert.equal(await page.locator('.expense-editor').count(), 1);
  assert.match(await page.locator('.expense-fx-summary').innerText(), /31.2/);
  await page.locator('.expense-fx-summary').getByRole('button').click(); await field('expenses.1.fxRate').fill('30.8'); await waitSaved();
  await go('基本資料'); await go('費用'); assert.equal(await field('expenses.1.fxRate').inputValue(), '30.8');
  const saved = await read(); assert.equal(saved.fx.rate, '31.5'); assert.equal(saved.expenses[2].fxRate, '31.7');
});
await capture('expenses-1440');
await check('Expense addition asks category first and accepts blank receipt number', async () => {
  await page.getByRole('button', { name: '新增一筆費用', exact: true }).click();
  const before = (await read()).expenses.length;
  await page.locator('.expense-category-picker').getByRole('button', { name: '大眾陸運工具', exact: true }).click(); await waitSaved();
  assert.equal((await read()).expenses.length, before + 1);
  const index = before; await field(`expenses.${index}.amount`).fill('100'); await field(`expenses.${index}.description`).fill('接駁'); await waitSaved();
  assert.equal((await read()).expenses[index].receipt, '');
});
await check('Export validation opens the precise collapsed expense input', async () => {
  await field('expenses.3.amount').fill(''); await page.locator('.expense-row-toggle').nth(0).click();
  await page.getByRole('button', { name: '下載報帳表', exact: true }).click();
  const issue = page.locator('.review-blocking .issue-item').filter({ hasText: '金額' }).first();
  await issue.getByRole('button', { name: '前往欄位', exact: true }).click();
  assert.equal(await field('expenses.3.amount').evaluate(el => el === document.activeElement), true);
  await field('expenses.3.amount').fill('100'); await waitSaved();
});
await check('Report download is native XLS with blank receipt identifiers', async () => {
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下載報帳表', exact: true }).click();
  const file = await download; assert.match(file.suggestedFilename(), /\.xls$/); await file.saveAs(`${output}/product-download.xls`);
  const { readFile } = await import('node:fs/promises'); const bytes = await readFile(`${output}/product-download.xls`); assert.equal(bytes.subarray(0,8).toString('hex'), 'd0cf11e0a1b11ae1');
});
await go('檢查與下載'); await page.getByText('必填資料已完成，可下載報表。', {exact:true}).waitFor(); await page.evaluate(() => window.scrollTo(0,0)); await capture('review-1440');
await check('Read-only examples never access draft storage, edit, or download', async () => {
  await waitSaved(); const before = await read();
  const examplePage = await context.newPage();
  examplePage.on('pageerror', error => errors.push(error.message));
  await examplePage.addInitScript(() => { window.__idbCalls = 0; const original = indexedDB.open.bind(indexedDB); indexedDB.open = (...args) => { window.__idbCalls++; return original(...args); }; });
  await examplePage.goto(base + '?example=student'); await examplePage.getByRole('heading', { name: '填寫範例', exact: true }).waitFor();
  await examplePage.getByRole('button', { name: '一般版', exact: true }).click();
  await examplePage.getByRole('tab', { name: '計算說明', exact: true }).click();
  assert.equal(await examplePage.locator('input,textarea').count(), 0); assert.equal(await examplePage.getByRole('button', { name: /下載/ }).count(), 0);
  assert.equal(await examplePage.evaluate(() => window.__idbCalls), 0);
  if(process.env.CAPTURE_QA !== '0') { await examplePage.evaluate(() => document.fonts.ready); await examplePage.screenshot({ path: `${output}/example-1440.png` }); }
  await examplePage.close(); assert.deepEqual(await read(), before);
});
await check('Reset saves a previous draft, including across reload, and restore returns it', async () => {
  const before = await read(); await menu(); await page.getByRole('button', { name: '重新填寫', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '重新填寫', exact: true }).click(); await waitSaved();
  assert.equal((await read()).person.name, ''); assert.deepEqual(await read('previous-draft'), before);
  await page.reload(); await waitSaved(); await menu(); await page.getByRole('button', { name: '恢復上一份草稿', exact: true }).click();
  await page.evaluate(() => {
    window.__originalGet = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'get').value;
    IDBObjectStore.prototype.get = function(key) {
      const request = window.__originalGet.call(this, key);
      if (key !== 'previous-draft') return request;
      return new Proxy(request, {
        get(target, prop) { const value = Reflect.get(target, prop, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, prop, value) { if (prop === 'onsuccess') target.onsuccess = event => setTimeout(() => value.call(target, event), 450); else Reflect.set(target, prop, value, target); return true; },
      });
    };
  });
  await page.getByRole('alertdialog').getByRole('button', { name: '恢復草稿', exact: true }).click();
  assert.equal(await page.locator('.editor').getAttribute('inert'), '');
  await waitSaved(); await page.evaluate(() => { IDBObjectStore.prototype.get = window.__originalGet; });
  assert.deepEqual(await read(), before);
});
await check('Failed backup preserves the current draft and does not show success', async () => {
  const before = await read();
  await page.evaluate(() => { window.__put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put').value; IDBObjectStore.prototype.put = function(value,key) { if(key === 'previous-draft') throw new DOMException('Quota', 'QuotaExceededError'); return window.__put.call(this,value,key); }; });
  await menu(); await page.getByRole('button', { name: '重新填寫', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: '重新填寫', exact: true }).click();
  await page.getByText('未更動目前內容。請確認草稿提示後重試。', { exact: true }).waitFor();
  assert.equal(await field('person.name').inputValue(), before.person.name); assert.deepEqual(await read(), before);
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
});
await page.reload(); await waitSaved();
await check('Whole-page preview and controls fit 1280x800 and 1440x900', async () => {
  for (const [width,height] of [[1280,800],[1440,900]]) {
    await page.setViewportSize({ width,height }); await page.evaluate(() => window.scrollTo(0,0)); await settle(); await noOverflow();
    const pane = await page.locator('.workspace > .preview-pane').boundingBox(); assert.ok(pane && pane.y + pane.height <= height + 1, `Preview exceeds viewport: ${JSON.stringify(pane)}`);
    const svg = await page.locator('.workspace > .preview-pane .report-svg').boundingBox(); assert.ok(svg && svg.y >= pane.y && svg.y + svg.height <= pane.y + pane.height + 1);
    await capture(`whole-page-${width}`);
  }
});
await check('Long editing keeps navigation, claim amount, and download available', async () => {
  await go('費用'); await page.evaluate(() => window.scrollTo(0, 600)); await settle();
  for (const selector of ['.app-header', '.section-tabs', '.editor-summary']) {
    const bounds = await page.locator(selector).first().boundingBox(); assert.ok(bounds && bounds.y >= -1 && bounds.y + bounds.height <= 901, `${selector} outside view ${JSON.stringify(bounds)}`);
  }
});
await check('Preview enlargement supports Escape and restores focus', async () => {
  const opener = page.locator('.workspace > .preview-pane .preview-toolbar').getByRole('button', { name: /放大/ });
  await opener.click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); assert.equal(await opener.evaluate(el => el === document.activeElement), true);
});
await check('200% equivalent viewport uses one column with a preview switch', async () => {
  await page.setViewportSize({ width:720,height:450 }); await page.evaluate(() => window.scrollTo(0,0)); await settle(); await noOverflow();
  await page.getByRole('button', { name: '查看報表預覽', exact: true }).click(); await settle(); await noOverflow();
  assert.equal(await page.locator('.workspace > .preview-pane').isVisible(), true); assert.equal(await page.locator('.workspace > .editor').isVisible(), false);
  await capture('zoom-200-preview'); await page.getByRole('button', { name: '返回填寫', exact: true }).click();
  await capture('zoom-200-form');
});
await check('Visible pages contain no developer jargon and request no backend', async () => {
  await page.setViewportSize({ width:1440,height:900 });
  for (const name of ['基本資料','行程與生活費','費用','檢查與下載']) { await go(name); const text = await page.locator('body').innerText(); assert.doesNotMatch(text, /匿名測試|暫行口徑|模板版本|BIFF|ExtSST|DBCell|Unicode|本版依提供|資料檢查通過，可下載 XLS/); }
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
});
await writeFile(`${output}/results.json`, JSON.stringify({ results, failures, errors, external }, null, 2));
await browser.close();
if (failures.length || errors.length) process.exitCode = 1;
