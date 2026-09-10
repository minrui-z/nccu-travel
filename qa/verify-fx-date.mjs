import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createPublicExample } from '../lib/public-example.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173/nccu-travel/';
const output = process.env.UI_QA_OUTPUT || 'qa-output/fx-date';
const origin = new URL(base).origin;
const results = [], failures = [], errors = [], external = [], quoteRequests = [];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
// A fresh context never reads or modifies a user's existing browser profile.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
context.on('page', (target) => target.on('pageerror', (error) => errors.push(error.message)));
context.on('request', (request) => {
  const url = new URL(request.url());
  if (url.protocol.startsWith('http') && url.origin !== origin) external.push(url.href);
  const date = url.pathname.match(/\/data\/fx\/(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
  if (date) quoteRequests.push(date);
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const field = (path) => page.locator(`[data-slot="tabs-content"]:not([hidden]) [data-field-path="${path}"]`).locator('input,textarea').first();
const go = (name) => page.getByRole('tab', { name: new RegExp('^' + name + '，') }).click();
const waitSaved = () => page.waitForFunction(() => document.querySelector('.draft-state')?.textContent?.includes('已儲存'));
const read = () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('nccu-travel-workbench', 1);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction('local-records');
    const get = transaction.objectStore('local-records').get('active-draft');
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
    transaction.oncomplete = () => db.close();
  };
  request.onerror = () => reject(request.error);
}));
const waitStored = async (expected) => {
  await page.waitForFunction(async (pairs) => {
    const draft = await new Promise((resolve, reject) => {
      const request = indexedDB.open('nccu-travel-workbench', 1);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('local-records');
        const get = transaction.objectStore('local-records').get('active-draft');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
        transaction.oncomplete = () => db.close();
      };
      request.onerror = () => reject(request.error);
    });
    return pairs.every(([path, value]) => path.split('.').reduce((current, key) => current?.[key], draft) === value);
  }, Object.entries(expected));
  await waitSaved();
};
const seedDraft = async (draft) => {
  await page.evaluate((value) => new Promise((resolve, reject) => {
    const request = indexedDB.open('nccu-travel-workbench', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('local-records', 'readwrite');
      transaction.objectStore('local-records').put(value, 'active-draft');
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }), draft);
  await page.reload();
  await waitSaved();
};
const openExpenseFx = async () => {
  await go('費用');
  const toggle = page.locator('.expense-row-toggle').nth(1);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  if (!(await field('expenses.1.fxDate').isVisible())) {
    await page.locator('.expense-fx-summary').getByRole('button', { name: '修改匯率', exact: true }).click();
  }
  await field('expenses.1.fxDate').waitFor({ state: 'visible' });
};
const openLivingFx = async () => {
  await go('行程與生活費');
  if (!(await field('fx.rateDate').isVisible())) await page.locator('.fx-panel > summary').click();
  await field('fx.rateDate').waitFor({ state: 'visible' });
};
const check = async (name, action) => {
  try { await action(); results.push(name); console.log('PASS', name); }
  catch (error) { failures.push({ name, message: error.message }); console.log('FAIL', name, error.message); }
};

try {
  const chosenDate = '2026-08-28';
  const referenceDate = '2026-08-31';
  const missingDate = '2024-01-02';
  const quoteResponse = await context.request.get(new URL(`data/fx/${chosenDate}.json`, base).href);
  assert.ok(quoteResponse.ok(), 'The selected-date fixture must exist on the tested website');
  const quote = await quoteResponse.json();
  assert.equal(quote.quotationDate, chosenDate);
  const expectedRate = quote.currencyRates.USD.cashSelling;
  const draft = createPublicExample('general');
  Object.assign(draft.expenses[1], {
    fxSource: 'bot-cash', fxProvenance: 'automatic', fxDate: referenceDate,
    fxRate: '', fxProofNote: '',
  });
  await page.goto(base);
  await waitSaved();
  await seedDraft(draft);
  await openExpenseFx();
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-field-path="expenses.1.fxRate"] input');
    return Boolean(input?.value);
  });
  await waitSaved();
  const untouched = await read();

  await check('Bank expense quotation date is editable and changing it clears the previous rate and proof', async () => {
    assert.equal(await field('expenses.1.fxDate').isEditable(), true);
    assert.equal(await field('expenses.1.fxDate').inputValue(), referenceDate);
    await field('expenses.1.fxDate').fill(chosenDate);
    await waitStored({ 'expenses.1.fxDate': chosenDate, 'expenses.1.fxRate': '', 'expenses.1.fxProofNote': '', 'expenses.1.fxProvenance': 'manual' });
    assert.equal(await field('expenses.1.fxDate').inputValue(), chosenDate);
  });

  await check('Chosen expense date survives tab changes and reload without returning to the departure reference', async () => {
    await go('基本資料'); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), chosenDate);
    await page.reload(); await waitSaved(); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), chosenDate);
    assert.equal((await read()).expenses[1].fxRate, '');
  });

  await check('Clearing an expense date stays blank across tab changes and reload', async () => {
    await field('expenses.1.fxDate').fill('');
    await waitStored({ 'expenses.1.fxDate': '', 'expenses.1.fxRate': '', 'expenses.1.fxProvenance': 'manual' });
    await go('基本資料'); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), '');
    await page.reload(); await waitSaved(); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), '');
  });

  await check('Expense refresh reads the chosen day and preserves it after successful lookup and reload', async () => {
    await field('expenses.1.fxDate').fill(chosenDate);
    await waitStored({ 'expenses.1.fxDate': chosenDate });
    const previousRequestCount = quoteRequests.length;
    await page.getByRole('button', { name: '重新讀取匯率', exact: true }).click();
    await waitStored({ 'expenses.1.fxDate': chosenDate, 'expenses.1.fxRate': expectedRate, 'expenses.1.fxProvenance': 'manual' });
    assert.ok(quoteRequests.slice(previousRequestCount).includes(chosenDate));
    assert.ok(!quoteRequests.slice(previousRequestCount).includes(referenceDate));
    await go('基本資料'); await page.reload(); await waitSaved(); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), chosenDate);
    assert.equal(await field('expenses.1.fxRate').inputValue(), expectedRate);
  });

  await check('Missing expense quotation data keeps the chosen date and empty amount after failure and reload', async () => {
    await field('expenses.1.fxDate').fill(missingDate);
    await waitStored({ 'expenses.1.fxDate': missingDate, 'expenses.1.fxRate': '' });
    await page.getByRole('button', { name: '重新讀取匯率', exact: true }).click();
    await page.locator('.expense-editor [role="status"]').filter({ hasText: `尚未取得 ${missingDate}` }).waitFor();
    await waitStored({ 'expenses.1.fxDate': missingDate, 'expenses.1.fxRate': '', 'expenses.1.fxProvenance': 'manual' });
    await page.reload(); await waitSaved(); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), missingDate);
    const current = await read();
    assert.deepEqual(current.expenses[2], untouched.expenses[2]);
    assert.deepEqual(current.fx, untouched.fx);
  });

  await check('Living allowance lookup respects its chosen date without changing either expense', async () => {
    const before = await read();
    await openLivingFx();
    await field('fx.rateDate').fill(chosenDate);
    await waitStored({ 'fx.rateDate': chosenDate, 'fx.rate': '' });
    await page.getByRole('button', { name: '查詢並填入銀行匯率', exact: true }).click();
    await waitStored({ 'fx.rateDate': chosenDate, 'fx.rate': expectedRate, 'fx.provenance': 'manual' });
    assert.deepEqual((await read()).expenses, before.expenses);
    await go('費用'); await page.reload(); await waitSaved(); await openLivingFx();
    assert.equal(await field('fx.rateDate').inputValue(), chosenDate);
    assert.equal(await field('fx.rate').inputValue(), expectedRate);
  });

  await check('Expense and living date changes remain independent, with no page errors or external requests', async () => {
    const before = await read();
    await openExpenseFx(); await field('expenses.1.fxDate').fill('2026-08-27');
    await waitStored({ 'expenses.1.fxDate': '2026-08-27', 'expenses.1.fxRate': '' });
    const current = await read();
    assert.deepEqual(current.fx, before.fx);
    assert.deepEqual(current.expenses[2], untouched.expenses[2]);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
  });

  await check('An imported bank quote can change date and refresh without losing the chosen date after reload', async () => {
    const imported = createPublicExample('general');
    Object.assign(imported.expenses[1], {
      fxSource: 'bot-cash', fxProvenance: 'imported', fxDate: '2026-08-27',
      fxRate: '31.8', fxProofNote: '臺銀匯率檔：測試匯入資料',
    });
    await seedDraft(imported); await openExpenseFx();
    assert.equal((await read()).expenses[1].fxProvenance, 'imported');
    assert.equal(await field('expenses.1.fxDate').isEditable(), true);
    await field('expenses.1.fxDate').fill(chosenDate);
    await waitStored({ 'expenses.1.fxDate': chosenDate, 'expenses.1.fxRate': '', 'expenses.1.fxProofNote': '', 'expenses.1.fxProvenance': 'manual' });
    await page.getByRole('button', { name: '重新讀取匯率', exact: true }).click();
    await waitStored({ 'expenses.1.fxDate': chosenDate, 'expenses.1.fxRate': expectedRate, 'expenses.1.fxProvenance': 'manual' });
    await page.reload(); await waitSaved(); await openExpenseFx();
    assert.equal(await field('expenses.1.fxDate').inputValue(), chosenDate);
    assert.equal(await field('expenses.1.fxRate').inputValue(), expectedRate);
    const current = await read();
    assert.equal(current.expenses[1].fxProvenance, 'manual');
    assert.deepEqual(current.expenses[2], imported.expenses[2]);
    assert.deepEqual(current.fx, imported.fx);
  });
} catch (error) {
  failures.push({ name: 'QA setup or navigation', message: error.message });
  console.error('FAIL QA setup or navigation', error.message);
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify({ results, failures, errors, external }, null, 2));
  await browser.close();
}
if (failures.length || errors.length || external.length) process.exitCode = 1;
