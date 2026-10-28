const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

// 決まった乱数（再現のため）
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// n件を登録した空の状態。価格は小さめにして全件が eligible になるようにする。
function make(n, { budget = 100000000, rng = mulberry(1) } = {}) {
  const s = L.newState();
  L.setBudget(s, budget, rng);
  for (let i = 0; i < n; i++) {
    const r = L.addItem(s, { name: 'item' + (i + 1), price: 1000 * (i + 1), note: '' }, rng);
    assert.ok(r.ok, r.error);
  }
  return s;
}

// 隠れた効用 util[id] が大きい方を選ぶ人として最後まで答える。質問数を返す。
function run(s, util, rng = mulberry(2)) {
  let q = 0;
  while (L.currentQuestion(s)) {
    const { cur, opp } = L.currentQuestion(s);
    L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old', rng);
    q++;
    assert.ok(q < 200, '無限ループ');
  }
  return q;
}
function randomUtil(n, rng) {
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  const u = {}; ids.forEach((id, k) => { u[id] = k; });
  return u;
}

test('Rp 整形と解析 (FR-1)', () => {
  assert.equal(L.formatRp(1800000), 'Rp 1.800.000');
  assert.equal(L.formatRp(0), 'Rp 0');
  assert.equal(L.formatRp(999), 'Rp 999');
  assert.equal(L.parseRp('5.000.000'), 5000000);
  assert.equal(L.parseRp('１２３'), 123);
  assert.equal(L.parseRp(''), null);
  assert.equal(L.parseRp('abc'), null);
  assert.equal(L.parseRp('1234567890123456'), 123456789012);
});

test('T-1 サンプル表示、追加するとサンプルが消える', () => {
  const s = L.load(null);
  assert.equal(s.sample, true);
  assert.ok(s.items.length > 0);
  const r = L.addItem(s, { name: '新しいもの', price: 1000, note: '' });
  assert.ok(r.ok);
  assert.equal(s.sample, false);
  assert.deepEqual(s.items.map(i => i.name), ['新しいもの']);
  assert.equal(s.budget, null); // 触っていない予算は消える
});

test('FR-2 入力検証と17件目の拒否', () => {
  const s = make(0);
  assert.equal(L.addItem(s, { name: '', price: 100 }).ok, false);
  assert.equal(L.addItem(s, { name: 'a', price: 0 }).ok, false);
  assert.equal(L.addItem(s, { name: 'a', price: '' }).ok, false);
  assert.equal(L.addItem(s, { name: 'a'.repeat(31), price: 100 }).ok, false);
  assert.equal(L.addItem(s, { name: 'a', price: 100, note: 'x'.repeat(61) }).ok, false);
  assert.equal(s.items.length, 0);
  for (let i = 0; i < 16; i++) assert.ok(L.addItem(s, { name: 'n' + i, price: 100 }).ok);
  const r = L.addItem(s, { name: '17', price: 100 });
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.equal(s.items.length, 16);
  // 買えば枠が空く（active のみ数える）
  assert.equal(L.buy(s, 1), null);
  assert.ok(L.addItem(s, { name: '17', price: 100 }).ok);
});

test('T-2 予算超えは質問に出ない。予算が増えると復帰', () => {
  const s = make(0, { budget: 5000 });
  L.addItem(s, { name: '安1', price: 1000 });
  L.addItem(s, { name: '安2', price: 2000 });
  L.addItem(s, { name: '高', price: 9000 });
  const big = s.items[2];
  assert.equal(L.overBudget(s, big), true);
  const seen = new Set();
  const util = { 1: 1, 2: 2, 3: 3 };
  while (L.currentQuestion(s)) {
    const { cur, opp } = L.currentQuestion(s); seen.add(cur.id); seen.add(opp.id);
    L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old');
  }
  assert.ok(!seen.has(big.id));
  assert.ok(!L.solve(s).chosen.includes(big));
  L.setBudget(s, 20000);
  assert.ok(L.currentQuestion(s), '復帰して質問が出る');
  assert.equal(L.currentQuestion(s).cur.id, big.id);
});

test('二分探索挿入で順位表が効用順に並ぶ', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const rng = mulberry(seed);
    const s = make(12, { rng });
    const util = randomUtil(12, rng);
    run(s, util, rng);
    const expected = Object.keys(util).map(Number).sort((a, b) => util[b] - util[a]);
    assert.deepEqual(s.ranking, expected);
  }
});

test('T-3 質問数: 8件 ≤17、16件 38〜49（最悪ケースも）', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = mulberry(seed);
    const s8 = make(8, { rng });
    assert.ok(run(s8, randomUtil(8, rng), rng) <= 17);
    const s16 = make(16, { rng });
    const q = run(s16, randomUtil(16, rng), rng);
    assert.ok(q >= 38 && q <= 49, `16件で ${q} 問`);
    assert.equal(s16.ranking.length, 16);
  }
  // 常に「新しい方を下」(tie) だと毎回最後尾まで探索 → 最大側
  const rng = mulberry(9);
  const s = make(16, { rng });
  let q = 0;
  while (L.currentQuestion(s)) { L.answer(s, 'tie', rng); q++; }
  assert.ok(q <= 49, `tie 連打で ${q} 問`);
  assert.equal(s.ranking.length, 16);
});

test('T-4 どちらでもいいは新しい方を下に置く', () => {
  const rng = mulberry(3);
  const s = make(2, { rng });
  const first = s.ranking[0];
  const q = L.currentQuestion(s);
  assert.equal(q.opp.id, first);
  L.answer(s, 'tie', rng);
  assert.deepEqual(s.ranking, [first, q.cur.id]);
});

test('左右の配置は質問ごとに入れ替わる', () => {
  const rng = mulberry(4);
  const s = make(6, { rng });
  const sides = [];
  while (L.currentQuestion(s)) {
    const q = L.currentQuestion(s);
    sides.push(q.left.id === q.cur.id ? 'L' : 'R');
    L.answer(s, 'old', rng);
  }
  assert.ok(sides.length >= 3);
  for (let i = 1; i < sides.length; i++) assert.notEqual(sides[i], sides[i - 1]);
});

test('T-5 ひとつ戻るを3回で3問前に戻る', () => {
  const rng = mulberry(5);
  const s = make(8, { rng });
  const util = randomUtil(8, rng);
  const snaps = [];
  for (let i = 0; i < 6; i++) {
    snaps.push(JSON.stringify({ r: s.ranking, c: L.currentQuestion(s).cur.id, lo: s.session.lo, hi: s.session.hi, a: s.session.asked }));
    const { cur, opp } = L.currentQuestion(s);
    L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old', rng);
  }
  for (let i = 0; i < 3; i++) assert.ok(L.undo(s, rng));
  assert.equal(JSON.stringify({ r: s.ranking, c: L.currentQuestion(s).cur.id, lo: s.session.lo, hi: s.session.hi, a: s.session.asked }), snaps[3]);
  assert.equal(s.answers.length, 3);
  // 戻した先からもう一度最後まで答えられる
  run(s, util, rng);
  assert.equal(s.ranking.length, 8);
});

test('戻る: 全部戻すと canUndo=false', () => {
  const rng = mulberry(6);
  const s = make(5, { rng });
  assert.equal(L.canUndo(s), false);
  run(s, randomUtil(5, rng), rng);
  assert.equal(L.canUndo(s), true);
  while (L.canUndo(s)) L.undo(s, rng);
  assert.equal(s.answers.length, 0);
  assert.equal(s.session.asked, 0);
});

test('T-6/T-7 買った・購入の取り消し', () => {
  const s = make(3, { budget: 10000 });
  const rng = mulberry(7);
  assert.equal(L.buy(s, 2, rng), null);
  assert.equal(s.budget, 10000 - 2000);
  assert.equal(L.byId(s, 2).status, 'bought');
  assert.ok(!L.solve(s).chosen.some(i => i.id === 2));
  assert.equal(L.unbuy(s, 2, rng), null);
  assert.equal(s.budget, 10000);
  assert.equal(L.byId(s, 2).status, 'active');
  assert.ok(L.buy(s, 99)); // 存在しない
  const s2 = make(1, { budget: 1000 });
  L.setBudget(s2, 500);
  assert.ok(L.buy(s2, 1)); // 予算不足はエラーで予算は変わらない
  assert.equal(s2.budget, 500);
});

test('T-8 やめる→復活で元の順位に戻る。やめた間は質問に出ない', () => {
  const rng = mulberry(8);
  const s = make(6, { rng });
  const util = randomUtil(6, rng);
  run(s, util, rng);
  const before = s.ranking.slice();
  const target = before[2];
  assert.equal(L.drop(s, target, rng), null);
  assert.deepEqual(s.ranking, before); // 順位表は保つ
  // 新アイテムを追加して質問 → target は出ない
  L.addItem(s, { name: '追加', price: 500 }, rng);
  const newId = s.items[s.items.length - 1].id;
  util[newId] = 2.5;
  while (L.currentQuestion(s)) {
    const { cur, opp } = L.currentQuestion(s);
    assert.notEqual(cur.id, target); assert.notEqual(opp.id, target);
    L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old', rng);
  }
  assert.equal(L.revive(s, target, rng), null);
  assert.equal(s.ranking.indexOf(target) >= 0, true);
  // 元の相対順位が保たれている
  assert.deepEqual(s.ranking.filter(id => id !== newId), before);
  assert.equal(L.currentQuestion(s), null);
});

test('質問中のアイテムをやめる・予算変更で外れると次へ進む', () => {
  const rng = mulberry(10);
  const s = make(4, { rng });
  const cur = L.currentQuestion(s).cur.id;
  L.drop(s, cur, rng);
  const q = L.currentQuestion(s);
  assert.ok(!q || q.cur.id !== cur);
  L.revive(s, cur, rng);
  // 予算を下げて相手が外れても lo/hi が範囲内に収まる
  const s2 = make(10, { rng });
  const util = randomUtil(10, rng);
  for (let i = 0; i < 5 && L.currentQuestion(s2); i++) {
    const { cur: c, opp } = L.currentQuestion(s2);
    L.answer(s2, util[c.id] > util[opp.id] ? 'new' : 'old', rng);
  }
  L.setBudget(s2, 5500, rng);
  const ranked = L.rankedIds(s2);
  assert.ok(s2.session.lo >= 0 && s2.session.lo <= s2.session.hi && s2.session.hi <= ranked.length);
  run(s2, util, rng);
  assert.equal(L.rankedIds(s2).length, 5);
});

test('T-9 削除で一覧・順位表・回答履歴・進行中から消える', () => {
  const rng = mulberry(11);
  const s = make(8, { rng });
  const util = randomUtil(8, rng);
  for (let i = 0; i < 10; i++) {
    const { cur, opp } = L.currentQuestion(s);
    L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old', rng);
  }
  const victim = s.ranking[1];
  L.removeItem(s, victim, rng);
  const json = JSON.stringify(s);
  assert.ok(!s.items.some(i => i.id === victim));
  assert.ok(!s.ranking.includes(victim));
  assert.ok(!s.answers.some(a => a.item === victim || a.opponent === victim || a.before.ranking.includes(victim)));
  assert.notEqual(s.session.cur, victim);
  assert.ok(!json.includes(`"item":${victim},`) && !json.includes(`"opponent":${victim},`));
  run(s, util, rng);
  assert.equal(s.ranking.length, 7);
  // 質問中のアイテムを削除
  const s2 = make(5, { rng });
  const cur = L.currentQuestion(s2).cur.id;
  L.removeItem(s2, cur, rng);
  assert.ok(!L.currentQuestion(s2) || L.currentQuestion(s2).cur.id !== cur);
  run(s2, randomUtil(5, rng), rng);
  assert.equal(s2.ranking.length, 4);
});

test('削除後も ひとつ戻る が破綻しない', () => {
  const rng = mulberry(12);
  const s = make(7, { rng });
  const util = randomUtil(7, rng);
  for (let i = 0; i < 8; i++) { const { cur, opp } = L.currentQuestion(s); L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old', rng); }
  L.removeItem(s, s.ranking[0], rng);
  while (L.canUndo(s)) assert.ok(L.undo(s, rng));
  run(s, util, rng);
  assert.equal(s.ranking.length, 6);
  for (const id of s.ranking) assert.ok(L.byId(s, id));
});

test('T-10 / FR-10 完了後の追加は最大4問（既存15件）', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry(seed);
    const s = make(15, { rng });
    const util = randomUtil(15, rng);
    run(s, util, rng);
    assert.equal(L.currentQuestion(s), null);
    L.addItem(s, { name: '後から', price: 1000 }, rng);
    const id = s.items[s.items.length - 1].id;
    util[id] = rng() * 15 - 0.5;
    const q = run(s, util, rng);
    assert.ok(q <= 4, `追加で ${q} 問`);
    assert.equal(s.ranking.length, 16);
    assert.ok(s.ranking.indexOf(id) >= 0);
  }
});

test('T-11 保存→復元（回答途中を含む）', () => {
  const store = {};
  const storage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const rng = mulberry(13);
  const s = make(8, { rng });
  const util = randomUtil(8, rng);
  for (let i = 0; i < 7; i++) { const { cur, opp } = L.currentQuestion(s); L.answer(s, util[cur.id] > util[opp.id] ? 'new' : 'old', rng); }
  L.buy(s, s.ranking[0], rng);
  assert.ok(L.save(storage, s));
  assert.ok('expense-council-v2' in store);
  const r = L.load(storage);
  assert.deepEqual(r, s);
  assert.equal(L.currentQuestion(r).cur.id, L.currentQuestion(s).cur.id);
  run(r, util, rng);
  assert.equal(L.rankedIds(r).length, 7);
});

test('保存できない・壊れたデータでもエラーにならない', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(L.load(broken).sample, true);
  assert.equal(L.save(broken, L.newState()), false);
  assert.equal(L.load(null).sample, true);
  for (const bad of ['', '{', 'null', '[]', '{"version":1}', '{"version":2}', '{"version":2,"items":"x"}']) {
    assert.equal(L.load({ getItem: () => bad }).sample, true, bad);
  }
  // 参照切れ・重複・不正値は捨てられる
  const s = L.load({ getItem: () => JSON.stringify({
    version: 2, budget: 5000, items: [
      { id: 1, name: 'a', price: 1000, status: 'active' }, { id: 1, name: 'dup', price: 1, status: 'active' },
      { id: 2, name: 'b', price: -5, status: 'active' }, { id: 3, name: 'c', price: 10, status: 'weird' }],
    ranking: [1, 1, 99], session: { cur: 99, lo: 5, hi: 9 }, answers: [{ item: 99, opponent: 1, before: {} }]
  }) });
  assert.deepEqual(s.items.map(i => i.id), [1]);
  assert.deepEqual(s.ranking, [1]);
  assert.equal(s.session.cur, null);
  assert.equal(s.answers.length, 0);
});

test('FR-5 solve: 手計算 (3〜5件)', () => {
  // ランキング A(1位=4点,600) B(3点,500) C(2点,400) D(1点,300) 予算 900
  // 候補: A+D=5点(900) / B+C=5点(900) / A+... A+C=1000超 / B+D=4点 / C+D=3点
  // 同点5点→支出同じ900 → 先に見つかった方（A+D, A を含む側）が残る。どちらも合計点は最大5点。
  const s = L.newState();
  L.setBudget(s, 900);
  const ids = {};
  [['A', 600], ['B', 500], ['C', 400], ['D', 300]].forEach(([n, p]) => { ids[n] = L.addItem(s, { name: n, price: p }).item.id; });
  s.ranking = [ids.A, ids.B, ids.C, ids.D];
  L.sync(s);
  const r = L.solve(s);
  assert.equal(r.points, 5);
  assert.ok(r.cost <= 900);
  assert.equal(r.chosen.reduce((a, i) => a + i.price, 0), r.cost);

  // 同点なら支出が少ない方: 1位=3点(300) 2位=2点(250) 3位=1点(100) 予算 300
  // {1位}=3点(300) / {2位,3位}=3点(350超) → 1位のみ。 予算 350: {2,3}=3点(350) vs {1}=3点(300) → 安い {1}
  const t = L.newState();
  L.setBudget(t, 350);
  const a = L.addItem(t, { name: 'x', price: 300 }).item.id;
  const b = L.addItem(t, { name: 'y', price: 250 }).item.id;
  const c = L.addItem(t, { name: 'z', price: 100 }).item.id;
  t.ranking = [a, b, c]; L.sync(t);
  const rt = L.solve(t);
  assert.equal(rt.points, 3);
  assert.equal(rt.cost, 300); // 同点 3 でも支出が少ない {a}
  assert.deepEqual(rt.chosen.map(i => i.id), [a]);

  // 予算ゼロ・全部買える・何も買えない
  const u = make(3, { budget: 1e9 });
  L.sync(u);
  assert.equal(L.solve(u).chosen.length, L.rankedIds(u).length);
  const v = make(0, { budget: 0 });
  assert.deepEqual(L.solve(v).chosen, []);
});

test('FR-5 solve: 小さな入力で別実装(ビットマスク)と一致', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry(seed);
    const n = 3 + Math.floor(rng() * 6);
    const s = L.newState();
    L.setBudget(s, 3000 + Math.floor(rng() * 4000));
    for (let i = 0; i < n; i++) L.addItem(s, { name: 'i' + i, price: 200 + Math.floor(rng() * 2500) });
    const util = randomUtil(n, rng);
    run(s, util, rng);
    const ranked = L.solve(s).ranked;
    let bestV = -1, bestC = 0;
    for (let m = 0; m < 1 << ranked.length; m++) {
      let c = 0, v = 0;
      ranked.forEach((it, k) => { if (m >> k & 1) { c += it.price; v += ranked.length - k; } });
      if (c > s.budget) continue;
      if (v > bestV || (v === bestV && c < bestC)) { bestV = v; bestC = c; }
    }
    const r = L.solve(s);
    assert.equal(r.points, bestV); assert.equal(r.cost, bestC);
  }
});

test('品質: 16件の結果計算が1秒未満', () => {
  const rng = mulberry(14);
  // 全部は買えない予算にして枝刈りに頼らない
  const s = make(16, { budget: 60000, rng });
  run(s, randomUtil(16, rng), rng);
  assert.equal(L.rankedIds(s).length, 16);
  const t0 = process.hrtime.bigint();
  const r = L.solve(s);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1000, `${ms}ms`);
  assert.ok(r.cost <= 60000);
});

test('状態の整合: buy/drop/remove/budget の乱操作で不変条件が崩れない', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rng = mulberry(seed);
    const s = make(10, { rng });
    const util = randomUtil(40, rng);
    for (let step = 0; step < 60; step++) {
      const r = rng();
      const pick = s.items.length ? s.items[Math.floor(rng() * s.items.length)].id : 0;
      if (r < 0.45) { const q = L.currentQuestion(s); if (q) L.answer(s, ['new', 'old', 'tie'][Math.floor(rng() * 3)], rng); }
      else if (r < 0.55) L.undo(s, rng);
      else if (r < 0.62) L.buy(s, pick, rng);
      else if (r < 0.68) L.unbuy(s, pick, rng);
      else if (r < 0.75) L.drop(s, pick, rng);
      else if (r < 0.82) L.revive(s, pick, rng);
      else if (r < 0.87) L.removeItem(s, pick, rng);
      else if (r < 0.93) L.setBudget(s, Math.floor(rng() * 80000), rng);
      else L.addItem(s, { name: 'n', price: 500 + Math.floor(rng() * 9000) }, rng);
      // 不変条件
      const ids = new Set(s.items.map(i => i.id));
      assert.equal(ids.size, s.items.length);
      assert.ok(s.ranking.every(id => ids.has(id)));
      assert.equal(new Set(s.ranking).size, s.ranking.length);
      assert.ok(L.activeCount(s) <= 16);
      assert.ok(s.budget === null || s.budget >= 0);
      const q = L.currentQuestion(s);
      if (q) {
        assert.ok(L.isEligible(s, q.cur) && L.isEligible(s, q.opp));
        assert.ok(!s.ranking.includes(q.cur.id));
      }
      const ranked = L.rankedIds(s);
      if (s.session.cur != null) assert.ok(s.session.lo <= s.session.hi && s.session.hi <= ranked.length);
      // 保存→復元で同じ状態
      assert.deepEqual(L.sanitize(JSON.parse(JSON.stringify(s))), s);
    }
    // 最後まで答えきれる
    run(s, util, rng);
    assert.equal(L.currentQuestion(s), null);
    assert.equal(L.rankedIds(s).length, L.eligible(s).length);
  }
});
