/* 出費会議 ロジック。画面・DOMに依存しない。ブラウザでは window.Logic、Node では require で使う。
   state は素のJSONオブジェクト。各関数は state をその場で更新する（status 付きの結果を返すものもある）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'expense-council-v2';
  var MAX_ITEMS = 16;
  var NAME_MAX = 30;
  var NOTE_MAX = 60;
  var STATUSES = ['active', 'bought', 'inactive'];

  /* ---------- Rp ---------- */
  function formatNum(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function formatRp(n) { return 'Rp ' + formatNum(n); }
  // 入力文字列 -> 整数 or null。全角数字も受ける。12桁まで。
  function parseRp(s) {
    var d = String(s == null ? '' : s)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 65248); })
      .replace(/[^\d]/g, '').slice(0, 12);
    return d === '' ? null : Number(d);
  }

  /* ---------- state ---------- */
  function newState() {
    return {
      version: 2, sample: false, budget: null, budgetTouched: false, nextId: 1,
      items: [], ranking: [], session: emptySession(0), answers: []
    };
  }
  function sampleState() {
    var s = newState();
    s.sample = true;
    s.budget = 5000000;
    s.items = [
      ['ワイヤレスイヤホン', 1800000, '通勤電車が静かになる'],
      ['電動歯ブラシ', 950000, '歯医者の仕上がりに近づく'],
      ['冬用ブーツ', 1450000, '雪の日でも滑らない'],
      ['ミニ加湿器', 420000, '喉の乾燥が楽になる'],
      ['読みたい本セット', 680000, '積読の候補を一気に解消'],
      ['コーヒーミル', 1200000, '毎朝の一杯が変わる']
    ].map(function (r, i) { return { id: i + 1, name: r[0], price: r[1], note: r[2], status: 'active' }; });
    s.nextId = 7;
    sync(s);
    return s;
  }
  function emptySession(asked) { return { cur: null, lo: 0, hi: 0, asked: asked || 0, sig: '' }; }

  function byId(state, id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }
  function isEligible(state, item) {
    return !!item && item.status === 'active' && state.budget != null && item.price <= state.budget;
  }
  function eligible(state) { return state.items.filter(function (i) { return isEligible(state, i); }); }
  function activeCount(state) { return state.items.filter(function (i) { return i.status === 'active'; }).length; }
  function overBudget(state, item) { return state.budget != null && item.price > state.budget; }
  // 比較に使う順位表（eligible だけ、順位順）の id 配列
  function rankedIds(state) {
    return state.ranking.filter(function (id) { return isEligible(state, byId(state, id)); });
  }

  /* ---------- 同期: eligible の変化に追従して質問を進める ---------- */
  function sync(state, rng) {
    rng = rng || Math.random;
    var s = state.session;
    var ranked = rankedIds(state);
    var sig = ranked.join(',');
    var cur = s.cur != null ? byId(state, s.cur) : null;
    if (!isEligible(state, cur) || state.ranking.indexOf(s.cur) >= 0) { s.cur = null; cur = null; }

    if (cur && !ranked.length) {
      // 比べる相手が全員外れた: 質問なしで1位に置く
      state.ranking.push(cur.id);
      s.cur = null; cur = null;
      ranked = rankedIds(state); sig = ranked.join(',');
    }
    if (cur) {
      if (s.sig !== sig || !(s.lo >= 0 && s.lo <= s.hi && s.hi <= ranked.length)) {
        s.lo = 0; s.hi = ranked.length; s.sig = sig;
      }
      return state;
    }
    // 次の待ちアイテムを選ぶ。順位表が空なら質問なしで1位に置く。
    for (;;) {
      var waiting = eligible(state).filter(function (i) { return state.ranking.indexOf(i.id) < 0; });
      if (!waiting.length) { s.cur = null; s.lo = 0; s.hi = 0; s.sig = sig; return state; }
      var pick = waiting[Math.floor(rng() * waiting.length)];
      if (!ranked.length) {
        state.ranking.push(pick.id);
        ranked = rankedIds(state); sig = ranked.join(',');
        continue;
      }
      s.cur = pick.id; s.lo = 0; s.hi = ranked.length; s.sig = sig;
      return state;
    }
  }

  /* ---------- 質問 ---------- */
  // {cur, opp, mid, left, right} or null。left/right は質問ごとに入れ替える（asked の偶奇）。
  function currentQuestion(state) {
    var s = state.session;
    if (s.cur == null) return null;
    var ranked = rankedIds(state);
    var mid = Math.floor((s.lo + s.hi) / 2);
    var cur = byId(state, s.cur), opp = byId(state, ranked[mid]);
    if (!cur || !opp) return null;
    var flip = s.asked % 2 === 1;
    return { cur: cur, opp: opp, mid: mid, left: flip ? opp : cur, right: flip ? cur : opp };
  }

  // choice: 'new'（質問中の方）/ 'old'（順位表の方）/ 'tie'（どちらでもいい＝新しい方を下に）
  function answer(state, choice, rng) {
    var q = currentQuestion(state);
    if (!q) return false;
    var s = state.session;
    var ranked = rankedIds(state);
    var before = { ranking: state.ranking.slice(), session: Object.assign({}, s) };
    var newWon = choice === 'new';
    if (newWon) s.hi = q.mid; else s.lo = q.mid + 1;
    s.asked++;
    state.answers.push({ item: q.cur.id, opponent: q.opp.id, newWon: newWon, before: before });
    if (s.lo >= s.hi) {
      var at;
      if (s.lo < ranked.length) at = state.ranking.indexOf(ranked[s.lo]);
      else if (ranked.length) at = state.ranking.indexOf(ranked[ranked.length - 1]) + 1;
      else at = state.ranking.length;
      state.ranking.splice(at, 0, q.cur.id);
      s.cur = null;
    }
    sync(state, rng);
    return true;
  }

  function canUndo(state) {
    return state.answers.some(function (a) { return isEligible(state, byId(state, a.item)); });
  }
  // 1問前に戻す。今は対象外のアイテムの回答は読み飛ばして捨てる。
  function undo(state, rng) {
    while (state.answers.length) {
      var a = state.answers.pop();
      if (!isEligible(state, byId(state, a.item))) continue;
      state.ranking = a.before.ranking.slice();
      state.session = Object.assign({}, a.before.session);
      sync(state, rng);
      return true;
    }
    return false;
  }

  /* ---------- アイテム操作 ---------- */
  function clearSample(state) {
    if (!state.sample) return state;
    var budget = state.budgetTouched ? state.budget : null;
    var touched = state.budgetTouched;
    Object.assign(state, newState());
    state.budget = budget; state.budgetTouched = touched;
    return state;
  }

  // -> {ok:true, item} / {ok:false, error}
  function addItem(state, input, rng) {
    var name = String(input.name == null ? '' : input.name).trim();
    var note = String(input.note == null ? '' : input.note).trim();
    var price = typeof input.price === 'number' ? input.price : parseRp(input.price);
    if (!name) return { ok: false, error: '名前を入力してください。' };
    if (name.length > NAME_MAX) return { ok: false, error: '名前は' + NAME_MAX + '文字までです。' };
    if (note.length > NOTE_MAX) return { ok: false, error: 'アピールポイントは' + NOTE_MAX + '文字までです。' };
    if (!Number.isInteger(price) || price < 1) return { ok: false, error: '値段は1以上の整数で入力してください。' };
    if (!state.sample && activeCount(state) >= MAX_ITEMS) {
      return { ok: false, error: '候補は' + MAX_ITEMS + '件までです。買った・やめる・削除で減らしてください。' };
    }
    clearSample(state);
    var item = { id: state.nextId++, name: name, price: price, note: note, status: 'active' };
    state.items.push(item);
    sync(state, rng);
    return { ok: true, item: item };
  }

  function setBudget(state, n, rng) {
    state.budget = n;
    state.budgetTouched = true;
    return sync(state, rng);
  }

  // 戻り値: null=成功 / 文字列=エラーメッセージ
  function buy(state, id, rng) {
    var it = byId(state, id);
    if (!it || it.status !== 'active') return '買えるのは候補のアイテムだけです。';
    if (state.budget == null || it.price > state.budget) return '残り予算が足りません。';
    it.status = 'bought';
    state.budget -= it.price;
    sync(state, rng);
    return null;
  }
  function unbuy(state, id, rng) {
    var it = byId(state, id);
    if (!it || it.status !== 'bought') return '購入済みではありません。';
    if (activeCount(state) >= MAX_ITEMS) return '候補が' + MAX_ITEMS + '件のため戻せません。';
    it.status = 'active';
    state.budget = (state.budget || 0) + it.price;
    sync(state, rng);
    return null;
  }
  function drop(state, id, rng) {
    var it = byId(state, id);
    if (!it || it.status !== 'active') return 'やめられるのは候補のアイテムだけです。';
    it.status = 'inactive';
    sync(state, rng);
    return null;
  }
  function revive(state, id, rng) {
    var it = byId(state, id);
    if (!it || it.status !== 'inactive') return 'やめたアイテムではありません。';
    if (activeCount(state) >= MAX_ITEMS) return '候補が' + MAX_ITEMS + '件のため復活できません。';
    it.status = 'active';
    sync(state, rng);
    return null;
  }
  // 順位表・回答履歴・進行中の質問から該当部分を消す。
  function removeItem(state, id, rng) {
    state.items = state.items.filter(function (i) { return i.id !== id; });
    state.ranking = state.ranking.filter(function (x) { return x !== id; });
    state.answers = state.answers.filter(function (a) { return a.item !== id && a.opponent !== id; });
    state.answers.forEach(function (a) {
      a.before.ranking = a.before.ranking.filter(function (x) { return x !== id; });
    });
    if (state.session.cur === id) state.session.cur = null;
    return sync(state, rng);
  }

  /* ---------- 結果: 全探索 ---------- */
  // 順位を点数（1位=n点…最下位=1点）にし、予算内で合計点が最大の組み合わせ。同点なら支出が少ない方。
  // 質問が残っていれば、順位表に入っているものだけが対象。
  function solve(state) {
    var items = rankedIds(state).map(function (id) { return byId(state, id); });
    var n = items.length, budget = state.budget;
    var best = { pts: -1, cost: 0, set: [] }, cur = [];
    (function dfs(i, cost, pts) {
      if (i === n) {
        if (pts > best.pts || (pts === best.pts && cost < best.cost)) best = { pts: pts, cost: cost, set: cur.slice() };
        return;
      }
      if (cost + items[i].price <= budget) {
        cur.push(i); dfs(i + 1, cost + items[i].price, pts + n - i); cur.pop();
      }
      dfs(i + 1, cost, pts);
    })(0, 0, 0);
    return {
      chosen: best.set.map(function (i) { return items[i]; }),
      cost: best.cost,
      points: Math.max(best.pts, 0),
      ranked: items
    };
  }

  /* ---------- 保存 ---------- */
  function isId(x) { return Number.isInteger(x) && x > 0; }
  function sanitize(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== 2 || !Array.isArray(raw.items)) return null;
    var s = newState();
    var seen = {};
    raw.items.forEach(function (i) {
      if (!i || !isId(i.id) || seen[i.id] || typeof i.name !== 'string' || !Number.isInteger(i.price) || i.price < 1 ||
        STATUSES.indexOf(i.status) < 0) return;
      seen[i.id] = 1;
      s.items.push({ id: i.id, name: i.name.slice(0, NAME_MAX), price: i.price, note: typeof i.note === 'string' ? i.note.slice(0, NOTE_MAX) : '', status: i.status });
    });
    s.budget = Number.isInteger(raw.budget) && raw.budget >= 0 ? raw.budget : null;
    s.budgetTouched = !!raw.budgetTouched;
    s.sample = !!raw.sample;
    var maxId = s.items.reduce(function (m, i) { return Math.max(m, i.id); }, 0);
    s.nextId = Math.max(isId(raw.nextId) ? raw.nextId : 1, maxId + 1);
    var inRank = {};
    (Array.isArray(raw.ranking) ? raw.ranking : []).forEach(function (id) {
      if (seen[id] && !inRank[id]) { inRank[id] = 1; s.ranking.push(id); }
    });
    var rs = raw.session || {};
    s.session = {
      cur: seen[rs.cur] ? rs.cur : null,
      lo: Number.isInteger(rs.lo) ? rs.lo : 0, hi: Number.isInteger(rs.hi) ? rs.hi : 0,
      asked: Number.isInteger(rs.asked) && rs.asked >= 0 ? rs.asked : 0,
      sig: typeof rs.sig === 'string' ? rs.sig : ''
    };
    (Array.isArray(raw.answers) ? raw.answers : []).forEach(function (a) {
      if (!a || !seen[a.item] || !seen[a.opponent] || !a.before || !Array.isArray(a.before.ranking) || !a.before.session) return;
      var bs = a.before.session;
      s.answers.push({
        item: a.item, opponent: a.opponent, newWon: !!a.newWon,
        before: {
          ranking: a.before.ranking.filter(function (id) { return seen[id]; }),
          session: {
            cur: seen[bs.cur] ? bs.cur : null, lo: Number.isInteger(bs.lo) ? bs.lo : 0, hi: Number.isInteger(bs.hi) ? bs.hi : 0,
            asked: Number.isInteger(bs.asked) ? bs.asked : 0, sig: typeof bs.sig === 'string' ? bs.sig : ''
          }
        }
      });
    });
    return sync(s);
  }

  // storage が無い・壊れている・例外でも、エラーにせず sampleState を返す / 何もしない。
  function load(storage) {
    try {
      var raw = storage && storage.getItem(STORAGE_KEY);
      if (raw) { var s = sanitize(JSON.parse(raw)); if (s) return s; }
    } catch (e) { /* 保存なしで動く */ }
    return sampleState();
  }
  function save(storage, state) {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  return {
    STORAGE_KEY: STORAGE_KEY, MAX_ITEMS: MAX_ITEMS, NAME_MAX: NAME_MAX, NOTE_MAX: NOTE_MAX,
    formatRp: formatRp, formatNum: formatNum, parseRp: parseRp,
    newState: newState, sampleState: sampleState, clearSample: clearSample,
    byId: byId, eligible: eligible, isEligible: isEligible, activeCount: activeCount, overBudget: overBudget, rankedIds: rankedIds,
    sync: sync, currentQuestion: currentQuestion, answer: answer, canUndo: canUndo, undo: undo,
    addItem: addItem, setBudget: setBudget, buy: buy, unbuy: unbuy, drop: drop, revive: revive, removeItem: removeItem,
    solve: solve, sanitize: sanitize, load: load, save: save
  };
});
