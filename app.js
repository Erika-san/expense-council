(function () {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };
  var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var L = window.Logic;
  var storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  var state = L.load(storage);
  var step = 'register';
  var armedTimer = null;

  function save() { L.save(storage, state); }
  function item(id) { return L.byId(state, id); }
  function activeItems() { return state.items.filter(function (i) { return i.status === 'active'; }); }
  function boughtItems() { return state.items.filter(function (i) { return i.status === 'bought'; }); }
  function inactiveItems() { return state.items.filter(function (i) { return i.status === 'inactive'; }); }
  function eligible() { return L.eligible(state); }
  function sum(items) { return items.reduce(function (total, i) { return total + i.price; }, 0); }
  function scrollTop() { window.scrollTo(0, 0); }

  function showToast(message) {
    var old = $('.toast'); if (old) old.remove();
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = message; el.setAttribute('role', 'status');
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 3600);
  }

  function setStep(next) {
    if (next === 'compare' && !L.currentQuestion(state) && eligible().length < 2) return;
    if (next === 'result' && !state.items.length) return;
    step = next; render(); save(); scrollTop();
  }

  function actionButton(label, action, id, cls) {
    return '<button type="button" class="btn sm ' + (cls || '') + '" data-action="' + action + '" data-id="' + id + '">' + esc(label) + '</button>';
  }
  function itemActions(it, canBuy) {
    return '<div class="pick-actions">' +
      (canBuy ? actionButton('買った', 'buy', it.id, 'primary') : '') +
      actionButton('やめる', 'drop', it.id) + actionButton('削除', 'delete', it.id, 'ghost') + '</div>';
  }

  function renderMeter() {
    var el = $('#meter'), budget = state.budget, active = activeItems(), total = sum(active);
    if (budget == null) { el.innerHTML = '<p class="hint">予算を入れると、買えるものが絞り込まれます。</p>'; return; }
    var max = Math.max(total, budget, 1), fill = Math.min(100, total / max * 100).toFixed(1), tick = Math.min(100, budget / max * 100).toFixed(1);
    var note = total === 0 ? '' : total <= budget
      ? '<p class="meter-note fit">全部買っても予算内です。</p>'
      : '<p class="meter-note over">全部だと ' + L.formatRp(total - budget) + ' 超えます。選ぶ必要があります。</p>';
    el.innerHTML = '<div class="meter-bar"><div class="meter-fill" style="width:' + fill + '%"></div><div class="meter-tick" style="left:calc(' + tick + '% - 1px)"></div></div>' +
      '<div class="meter-cap"><span>欲しいもの合計 <b class="num">' + L.formatRp(total) + '</b></span><span>残り予算 <b class="num">' + L.formatRp(budget) + '</b></span></div>' + note;
  }

  function renderStash() {
    var bought = boughtItems(), inactive = inactiveItems(), html = '';
    if (bought.length) {
      html += '<div class="panel"><div class="section-title"><h2>購入済み</h2><span class="hint">合計 <span class="num">' + L.formatRp(sum(bought)) + '</span></span></div><p class="hint">取り消すと予算が戻り、候補に復帰します。</p>';
      bought.forEach(function (it) { html += '<div class="pick skip"><span class="name">' + esc(it.name) + '</span><span class="price">' + L.formatRp(it.price) + '</span><div class="pick-actions">' + actionButton('購入を取り消す', 'unbuy', it.id) + actionButton('削除', 'delete', it.id, 'ghost') + '</div></div>'; });
      html += '</div>';
    }
    if (inactive.length) {
      html += '<div class="panel"><div class="section-title"><h2>やめたもの</h2><span class="hint">比較には出ません</span></div>';
      inactive.forEach(function (it) { html += '<div class="pick skip"><span class="name">' + esc(it.name) + '</span><span class="price">' + L.formatRp(it.price) + '</span><div class="pick-actions">' + actionButton('復活', 'revive', it.id) + actionButton('削除', 'delete', it.id, 'ghost') + '</div></div>'; });
      html += '</div>';
    }
    $('#stash').innerHTML = html;
  }

  function renderRegister() {
    var active = activeItems(), budget = state.budget;
    $('#sample-banner').hidden = !state.sample;
    $('#budget').value = budget == null ? '' : L.formatNum(budget);
    renderMeter(); renderStash();
    $('#list-count').textContent = active.length ? active.length + ' / ' + L.MAX_ITEMS + ' 件' : '';
    $('#list').innerHTML = active.length ? active.map(function (it) {
      var over = budget != null && it.price > budget;
      return '<div class="item"><div class="name">' + esc(it.name) + (over ? '<span class="chip bad">予算超え</span>' : '') + '</div><div class="price">' + L.formatRp(it.price) + '</div>' +
        '<button type="button" class="del" data-action="delete" data-id="' + it.id + '" aria-label="' + esc(it.name) + 'を削除">×</button>' + (it.note ? '<div class="note">' + esc(it.note) + '</div>' : '') + '</div>';
    }).join('') : '<p class="empty">まだ何もありません。上のフォームから1件目を追加してください。</p>';

    var canCompare = eligible().length >= 2, q = L.currentQuestion(state), next = $('#next-btn'), hint = $('#next-hint');
    next.disabled = !canCompare && !active.length;
    next.dataset.go = canCompare ? 'compare' : 'result';
    next.textContent = canCompare ? (q ? '比較を続ける →' : '比較をはじめる →') : '結果を見る →';
    hint.textContent = budget == null ? 'まず予算を入れてください。' : canCompare ? '登録は後からいつでも追加できます。' : active.length ? '予算内のものを2つ以上登録すると比較できます。' : 'まず欲しいものを登録してください。';
  }

  function card(it, isNew, mid) {
    return '<button type="button" class="opt pop" data-pick="' + it.id + '"><span class="tag ' + (isNew ? '' : 'old') + '">' + (isNew ? '新しく入れる' : 'いま ' + (mid + 1) + ' 位') + '</span><span class="oname">' + esc(it.name) + '</span><span class="oprice">' + L.formatRp(it.price) + '</span>' + (it.note ? '<span class="onote">' + esc(it.note) + '</span>' : '') + '</button>';
  }

  function renderRank() {
    // 比較に使う（eligible な）順位表だけを表示。window は [lo, hi]、mid は比べている相手。
    var q = L.currentQuestion(state), ranked = L.rankedIds(state), s = state.session;
    $('#rank-note').textContent = ranked.length + ' 件' + (q ? 'が順位づけ済み' : 'の順位が確定');
    $('#rank-help').textContent = q ? '青い範囲が、新しいアイテムの入る場所です。' : '順位を点数に変えて、予算内の組み合わせを選びます。';
    $('#rank').innerHTML = ranked.map(function (id, index) {
      var it = item(id), cls = 'rank-row';
      if (q && index >= s.lo && index < s.hi) cls += ' window';
      if (q && index === q.mid) cls += ' mid';
      return '<div class="' + cls + '"><span class="no">' + (index + 1) + '</span><span class="nm">' + esc(it.name) + '</span><span class="pr">' + L.formatRp(it.price) + '</span></div>';
    }).join('') || '<p class="empty">最初のアイテムは質問なしで1位になります。</p>';
  }

  function renderCompare() {
    var q = L.currentQuestion(state), total = state.answers.length + (q ? 1 : 0), max = Math.max(total, state.answers.length + 1), done = state.answers.length;
    $('#p-fill').style.width = (q ? Math.min(100, done / max * 100) : 100) + '%';
    $('#p-text').textContent = state.session.asked + ' 問回答済み';
    $('#p-left').textContent = q ? 'このアイテム ' + (state.session.hi - state.session.lo) + ' 候補' : '完了';
    if (!q) {
      $('#question').innerHTML = '<div class="panel" style="text-align:center"><h2>順位が決まりました</h2><p class="hint">予算内で買うものを計算しました。</p><button class="btn primary" type="button" data-go="result">結果を見る →</button></div>';
      renderRank(); return;
    }
    $('#question').innerHTML = '<p class="question-label">どっちが欲しい？</p><div class="duel">' + card(q.left, q.left.id === q.cur.id, q.mid) + card(q.right, q.right.id === q.cur.id, q.mid) + '<span class="vs" aria-hidden="true">VS</span></div><p class="kbd">カードをタップ、または ← → キーで選べます</p><div class="actions" style="justify-content:space-between"><button class="btn ghost" type="button" data-action="undo"' + (L.canUndo(state) ? '' : ' disabled') + '>← ひとつ戻る</button><button class="btn ghost" type="button" data-action="tie">どちらでもいい</button></div>';
    renderRank();
  }

  function actionHtml(it, canBuy, chosen) {
    var meta = it.note ? esc(it.note) : '';
    return '<div class="pick ' + (chosen ? '' : 'skip') + '"><span class="name">' + esc(it.name) + '</span><span class="price">' + L.formatRp(it.price) + '</span><span class="meta">' + meta + '</span>' + itemActions(it, canBuy) + '</div>';
  }
  function renderResult() {
    var e = eligible(), sol = L.solve(state), chosen = new Set(sol.chosen.map(function (i) { return i.id; })), tooBig = activeItems().filter(function (i) { return L.overBudget(state, i); });
    var html = '<div class="verdict"><span class="label">予算内で一番合理的な買い物</span><span class="big">' + L.formatRp(sol.cost) + '</span><span class="sub">予算 <span class="num">' + L.formatRp(state.budget || 0) + '</span> ・ 残り <span class="num">' + L.formatRp((state.budget || 0) - sol.cost) + '</span> ・ ' + sol.chosen.length + '点</span></div>';
    html += '<div class="panel"><div class="section-title"><h2 id="result-title">買うもの</h2><span class="hint">順位点の合計 ' + sol.points + '</span></div>' + (sol.chosen.length ? sol.chosen.map(function (it) { return actionHtml(it, true, true); }).join('') : '<p class="empty">予算内で買えるものがありません。</p>') + '</div>';
    var skipped = e.filter(function (it) { return !chosen.has(it.id); });
    if (skipped.length || tooBig.length) html += '<div class="panel"><h2>今月は見送り</h2>' + skipped.map(function (it) { return actionHtml(it, true, false); }).join('') + tooBig.map(function (it) { return '<div class="pick skip"><span class="name">' + esc(it.name) + '</span><span class="price">' + L.formatRp(it.price) + '</span><span class="meta">1点で予算を超えるため比較から除外</span>' + itemActions(it, false) + '</div>'; }).join('') + '</div>';
    html += '<p class="hint">順位は1位を最高点として計算しています。同点なら支出が少ない方を選びます。</p><div class="actions"><button class="btn" type="button" data-action="restart-compare">比較をやり直す</button><button class="btn ghost" type="button" data-action="wipe">すべて消して最初から</button></div>';
    $('#result').innerHTML = html;
    renderStash();
  }

  function render() {
    ['register', 'compare', 'result'].forEach(function (name) { $('#v-' + name).hidden = step !== name; });
    document.querySelectorAll('#steps button').forEach(function (button) {
      var name = button.dataset.go, disabled = (name === 'compare' && eligible().length < 2) || (name === 'result' && !state.items.length);
      if (name === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
    renderRegister();
    if (step === 'compare') renderCompare();
    if (step === 'result') renderResult();
  }

  function arm(button, action) {
    if (button.classList.contains('armed')) { action(); return; }
    var original = button.textContent;
    button.classList.add('armed'); button.textContent = 'もう一度押すと確定';
    clearTimeout(armedTimer); armedTimer = setTimeout(function () { button.classList.remove('armed'); button.textContent = original; }, 3000);
  }
  function changeStatus(action, id) {
    var message = null;
    if (action === 'buy') message = L.buy(state, id);
    if (action === 'unbuy') message = L.unbuy(state, id);
    if (action === 'drop') message = L.drop(state, id);
    if (action === 'revive') message = L.revive(state, id);
    if (message) showToast(message); else { save(); render(); }
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('button'); if (!button) return;
    if (button.dataset.go) { if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') setStep(button.dataset.go); return; }
    if (button.dataset.pick) {
      var q = L.currentQuestion(state), choice = Number(button.dataset.pick) === q.cur.id ? 'new' : 'old';
      L.answer(state, choice); save(); render(); return;
    }
    var action = button.dataset.action, id = Number(button.dataset.id);
    if (action === 'theme') {
      var isDark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var nextTheme = isDark ? 'light' : 'dark';
      document.documentElement.dataset.theme = nextTheme;
      try { localStorage.setItem('expense-council-theme', nextTheme); } catch (e) {}
      return;
    }
    if (action === 'clear-sample') { L.clearSample(state); save(); render(); return; }
    if (action === 'tie') { L.answer(state, 'tie'); save(); render(); return; }
    if (action === 'undo') { if (L.undo(state)) { save(); render(); } return; }
    if (action === 'delete') { arm(button, function () { L.removeItem(state, id); save(); render(); }); return; }
    if (action === 'buy' || action === 'unbuy' || action === 'drop' || action === 'revive') { changeStatus(action, id); return; }
    if (action === 'restart-compare') { arm(button, function () { state.ranking = []; state.answers = []; state.session = { cur: null, lo: 0, hi: 0, asked: 0, sig: '' }; L.sync(state); step = 'compare'; save(); render(); scrollTop(); }); return; }
    if (action === 'wipe') { arm(button, function () { state = L.newState(); step = 'register'; save(); render(); scrollTop(); }); return; }
  });

  $('#budget').addEventListener('input', function (event) { L.setBudget(state, L.parseRp(event.target.value)); save(); render(); });
  $('#budget').addEventListener('blur', function (event) { event.target.value = state.budget == null ? '' : L.formatNum(state.budget); });
  $('#price').addEventListener('blur', function (event) { var n = L.parseRp(event.target.value); event.target.value = n == null ? '' : L.formatNum(n); });
  $('#add-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var result = L.addItem(state, { name: $('#name').value, price: $('#price').value, note: $('#note').value });
    if (!result.ok) { $('#form-msg').textContent = result.error; return; }
    $('#form-msg').textContent = ''; $('#name').value = ''; $('#price').value = ''; $('#note').value = ''; save(); render(); $('#name').focus();
  });
  document.addEventListener('keydown', function (event) {
    if (step !== 'compare' || !L.currentQuestion(state) || ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); var q = L.currentQuestion(state), chooseLeft = event.key === 'ArrowLeft';
      L.answer(state, (chooseLeft ? q.left : q.right).id === q.cur.id ? 'new' : 'old'); save(); render();
    }
  });

  var theme = null; try { theme = localStorage.getItem('expense-council-theme'); } catch (e) {}
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  render();
})();
