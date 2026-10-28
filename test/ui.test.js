// 画面テスト（Playwright）。node --test test/ui.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('./serve.js');

const SHOTS = path.join(__dirname, 'screenshots');
let server, browser, url;

test.before(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  server = await start(0);
  url = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch();
});
test.after(async () => { await browser.close(); server.close(); });

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, colorScheme: 'light', ...opts });
  // Webフォントは読めなくても崩れないことの確認も兼ねて遮断する
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  page.errors = errors;
  return page;
}
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const add = async (page, name, price, note = '') => {
  await page.fill('#name', name); await page.fill('#price', String(price)); await page.fill('#note', note);
  await page.click('#add-form button[type=submit]');
};
// 隠れた効用（名前の末尾の数字）が大きい方を選び続ける
async function answerAll(page) {
  let n = 0;
  while (await page.locator('.opt').count()) {
    const names = await page.locator('.opt .oname').allTextContents();
    const tags = await page.locator('.opt .tag').allTextContents();
    const u = names.map(s => Number(s.replace(/\D/g, '')));
    const winner = u[0] > u[1] ? 0 : 1;
    await page.locator('.opt').nth(winner).click();
    assert.ok(tags.length === 2 && ++n < 100);
  }
  return n;
}

test('T-1 初回はサンプル表示。追加するとサンプルが消える', async () => {
  const page = await open();
  assert.equal(await page.locator('#sample-banner').isHidden(), false);
  assert.ok(await page.locator('#list .item').count() >= 1);
  await page.fill('#budget', '5000000');
  await add(page, '新しいもの1', 1000);
  assert.equal(await page.locator('#sample-banner').isHidden(), true);
  assert.deepEqual(await page.locator('#list .item .name').allTextContents(), ['新しいもの1']);
  assert.deepEqual(page.errors, []);
});

test('FR-1 予算の桁区切りと再読み込み', async () => {
  const page = await open();
  await page.fill('#budget', '5000000');
  await page.locator('#budget').blur();
  assert.equal(await page.inputValue('#budget'), '5.000.000');
  await page.reload();
  assert.equal(await page.inputValue('#budget'), '5.000.000');
  assert.match(await page.locator('#meter').innerText(), /Rp 5\.000\.000/);
});

test('FR-2 入力エラーと17件目の拒否', async () => {
  const page = await open();
  await page.fill('#budget', '100000000');
  await page.fill('#name', 'x'); await page.fill('#price', '0');
  await page.click('#add-form button[type=submit]');
  assert.match(await page.locator('#form-msg').innerText(), /値段/);
  for (let i = 1; i <= 16; i++) await add(page, '品' + i, 1000 * i);
  assert.equal(await page.locator('#list .item').count(), 16);
  await add(page, '17件目', 1000);
  assert.match(await page.locator('#form-msg').innerText(), /16件/);
  assert.equal(await page.locator('#list .item').count(), 16);
  assert.equal(await noHScroll(page), true);
});

test('通し: 登録→比較→結果→買った→再読み込みで状態が戻る', async () => {
  const page = await open();
  await page.fill('#budget', '10000');
  const prices = { 1: 3000, 2: 4000, 3: 5000, 4: 2000, 5: 6000 };
  for (const i of [1, 2, 3, 4, 5]) await add(page, '品' + i, prices[i]);
  await page.click('#next-btn');
  assert.equal(await page.locator('#v-compare').isVisible(), true);
  // 左右の入れ替え: 同じ新アイテムが交互に左右へ来る
  const asked = await answerAll(page);
  assert.ok(asked >= 4 && asked <= 8, '5件で ' + asked + ' 問');
  await page.click('#question [data-go=result]');
  assert.equal(await page.locator('#v-result').isVisible(), true);
  const bigBefore = await page.locator('.verdict .big').innerText();
  assert.match(bigBefore, /^Rp /);
  // 買ったを押すと予算が減る
  const before = await page.locator('#result .pick').first().locator('.price').innerText();
  await page.locator('#result [data-action=buy]').first().click();
  assert.equal(await page.locator('#stash').innerText().then(t => t.includes('購入済み')), true);
  await page.reload();
  await page.click('#steps [data-go=register]');
  assert.match(await page.locator('#stash').innerText(), /購入済み/);
  assert.ok(before.startsWith('Rp '));
  // 購入の取り消しで予算が戻る
  await page.click('[data-action=unbuy]');
  assert.equal(await page.inputValue('#budget'), '10.000');
});

test('矢印キーとひとつ戻る・どちらでもいい', async () => {
  const page = await open();
  await page.fill('#budget', '100000');
  for (let i = 1; i <= 4; i++) await add(page, '品' + i, 1000 * i);
  await page.click('#next-btn');
  const first = await page.locator('.opt .oname').allTextContents();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#p-text').innerText(), '1 問回答済み');
  await page.click('[data-action=undo]');
  assert.equal(await page.locator('#p-text').innerText(), '0 問回答済み');
  assert.deepEqual(await page.locator('.opt .oname').allTextContents(), first);
  await page.click('[data-action=tie]');
  assert.equal(await page.locator('#p-text').innerText(), '1 問回答済み');
});

test('T-9 削除は2回押して確定', async () => {
  const page = await open();
  await page.fill('#budget', '100000');
  await add(page, '消すもの', 1000); await add(page, '残るもの', 2000);
  const del = page.locator('#list .item').first().locator('.del');
  await del.click();
  assert.equal(await page.locator('#list .item').count(), 2);
  await del.click();
  assert.equal(await page.locator('#list .item').count(), 1);
  assert.deepEqual(await page.locator('#list .item .name').allTextContents(), ['残るもの']);
});

test('保存できない環境でもエラーにならず動く', async () => {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 800 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(url);
  await page.fill('#budget', '5000');
  await add(page, 'a', 1000);
  assert.equal(await page.locator('#list .item').count(), 1);
  assert.deepEqual(errors, []);
});

for (const scheme of ['light', 'dark']) {
  for (const [label, width, height] of [['mobile', 400, 900], ['desktop', 1280, 900]]) {
    test(`見た目: ${scheme} ${label} で横スクロールなし・スクリーンショット`, async () => {
      const page = await open({ colorScheme: scheme, viewport: { width, height } });
      await page.fill('#budget', '5000000');
      const long = '長い名前のアイテム'.repeat(3);
      await page.click('[data-action=clear-sample]');
      const names = [['ワイヤレスイヤホン', 1800000, '通勤電車が静かになる'], ['電動歯ブラシ', 950000, '歯医者の仕上がりに近づく'], ['冬用ブーツ', 1450000, '雪の日でも滑らない'], [long, 1200000, 'アピールポイントが長い場合でも折り返して表示される'], ['高すぎるもの', 9000000, '予算超え']];
      for (const [n, p, note] of names) await add(page, n, p, note);
      await page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}-register.png`), fullPage: true });
      assert.equal(await noHScroll(page), true, 'register');
      await page.click('#next-btn');
      await page.locator('.opt').first().click();
      await page.waitForTimeout(400); // カードの出現アニメーションが終わるのを待つ
      await page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}-compare.png`), fullPage: true });
      assert.equal(await noHScroll(page), true, 'compare');
      // タップ領域 36px 以上
      const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 36).map(b => b.textContent.trim()));
      assert.deepEqual(small, []);
      while (await page.locator('.opt').count()) await page.locator('.opt').first().click();
      await page.click('#question [data-go=result]');
      await page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}-result.png`), fullPage: true });
      assert.equal(await noHScroll(page), true, 'result');
      assert.deepEqual(page.errors, []);
    });
  }
}
