/* 差枚ビューア v2
 * 3画面構成（承認済み設計 2026-11-23）:
 *   1. トークン入力のみ（保存済みなら自動スキップ）。デモは廃止。
 *   2. 機種一覧: 横断No.1バナー + 機種カード（最新日のNo.1と機種合計付き）
 *   3. 機種ページ: 従来UI + 機種切替タブ + 全件表示 + 並べ替え切替
 *      + プラス日ゼロの強調・絞り込み + 期間内最大単日の併記
 * データ源: 非公開リポジトリ sldata19/slot-data
 *   machines.txt（ID,表示名,一覧URL。空行・#行は無視）が機種一覧を決める。
 *   各機種の通算CSV <ID>_sabai_all.csv（ヘッダ: 取得日,台番号,推定差枚,備考）
 * 機種の増減・並び順は machines.txt の行順だけが決める。ビューア側に
 * 機種の設定を持たない（PC側で1行増やすだけで一覧に自動で増える）。
 */
"use strict";

var REPO_CONTENTS = "https://api.github.com/repos/sldata19/slot-data/contents/";
var TOKEN_KEY = "slotViewerReadToken";

var state = {
  token: null,
  machines: [],        // [{ id, name }]
  data: {},            // id -> rows [{ d, m, v }]
  screen: "token",     // token | list | machine
  currentId: null,
  period: "all",
  mode: "total",
  digits: {},          // 選択中の末尾数字（空 = 絞り込みなし）
  sortDir: "desc",     // desc = 出てる順 / asc = 出てない順
  plusZeroOnly: false, // 期間合計モード: プラス日ゼロの台だけに絞る
  detailMachine: null, // ドリルダウン中の台番号
  latestDate: null     // 現在の機種のデータ最新日
};

function $(id) { return document.getElementById(id); }
function fmt(n) { return (n > 0 ? "+" : "") + n.toLocaleString("ja-JP"); }
function dayOf(dateStr) { return parseInt(dateStr.slice(8, 10), 10); }
function addDays(dateStr, n) {
  var t = new Date(dateStr + "T00:00:00+09:00");
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ---- machines.txt 解析: "ID,表示名,一覧URL" を1行1機種。空行・#行は無視。
 * URLにカンマは含まれない（サイトのURLは%エンコード済み）前提で3分割。 ---- */
function parseMachinesTxt(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var out = [];
  text.split(/\r?\n/).forEach(function (line) {
    var l = line.trim();
    if (!l || l.charAt(0) === "#") return;
    var parts = l.split(",");
    if (parts.length < 2 || !parts[0].trim()) return;
    out.push({ id: parts[0].trim(), name: parts[1].trim() });
  });
  return out;
}

/* ---- CSV解析: 通算CSV（取得日,台番号,推定差枚,備考）。BOM付きUTF-8対応。
 * 推定差枚が空欄の行（読み取り失敗）はランキングから外す。 ---- */
function parseSabaiCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
  if (lines.length < 2) return [];
  var head = lines[0].split(",").map(function (h) { return h.trim(); });
  var iDate = head.indexOf("取得日"), iMach = head.indexOf("台番号"), iVal = head.indexOf("推定差枚");
  if (iDate < 0 || iMach < 0 || iVal < 0) throw new Error("想定外のヘッダです: " + lines[0]);
  var out = [];
  for (var i = 1; i < lines.length; i++) {
    var c = lines[i].split(",");
    var v = parseInt((c[iVal] || "").trim(), 10);
    if (isNaN(v)) continue;
    out.push({ d: (c[iDate] || "").trim(), m: (c[iMach] || "").trim(), v: v });
  }
  return out;
}

/* ---- GitHub連携: Contents APIで1ファイルをテキストで読む（base64） ---- */
function fetchRepoText(token, path) {
  return fetch(REPO_CONTENTS + path, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  }).then(function (res) {
    if (res.status === 401) throw new Error("トークンが違うか期限切れです（401）");
    if (res.status === 404) throw new Error("ファイルが見つかりません（404）: " + path);
    if (!res.ok) throw new Error("GitHub APIエラー: HTTP " + res.status);
    return res.json();
  }).then(function (json) {
    var b64 = (json.content || "").replace(/\s/g, "");
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  });
}

/* machines.txt → 各機種の通算CSVを順に読む。1機種でも読めれば一覧は出す。 */
function loadAll(token) {
  setTokenStatus("machines.txt を読み込み中…");
  return fetchRepoText(token, "machines.txt").then(function (text) {
    var machines = parseMachinesTxt(text);
    if (!machines.length) throw new Error("machines.txt に機種がありません");
    state.machines = machines;
    state.data = {};
    var chain = Promise.resolve();
    var failed = [];
    machines.forEach(function (mc) {
      chain = chain.then(function () {
        return fetchRepoText(token, mc.id + "_sabai_all.csv").then(function (csv) {
          state.data[mc.id] = parseSabaiCsv(csv);
        }).catch(function (err) {
          failed.push(mc.id + ": " + err.message);
          state.data[mc.id] = [];
        });
      });
    });
    return chain.then(function () {
      state.token = token;
      try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
      var totalRows = Object.keys(state.data).reduce(function (s, k) {
        return s + state.data[k].length;
      }, 0);
      if (!totalRows) throw new Error("どの機種のCSVも読めませんでした");
      var msg = "取得しました（" + machines.length + "機種・" + totalRows + "行）";
      if (failed.length) msg += " ※読めなかった機種: " + failed.join(" / ");
      setTokenStatus(msg);
      showScreen("list");
      renderList();
    });
  }).catch(function (err) {
    setTokenStatus("読み込み失敗: " + err.message);
    showScreen("token");
  });
}

function setTokenStatus(msg) { var el = $("tokenStatus"); if (el) el.textContent = msg; }

/* ---- 集計 ---- */
function currentRows() {
  return state.data[state.currentId] || [];
}

function filteredRows(rows) {
  var latest = state.latestDate;
  var from = null, to = latest;
  if (state.period === "today") from = latest;
  else if (state.period === "yesterday") { from = addDays(latest, -1); to = from; }
  else if (state.period === "7d") from = addDays(latest, -6);
  else if (state.period === "30d") from = addDays(latest, -29);
  else if (state.period === "custom") {
    from = $("fromDate").value || null;
    to = $("toDate").value || latest;
  }
  var digits = Object.keys(state.digits);
  return rows.filter(function (r) {
    if (from && r.d < from) return false;
    if (to && r.d > to) return false;
    if (digits.length && digits.indexOf(String(dayOf(r.d) % 10)) < 0) return false;
    return true;
  });
}

/* 期間合計: 合計・日数・プラス日数に加え、期間内最大単日も持つ。
 * 最大単日が併記してあると「合計は凹んでるが途中で+4,000出した台」が一目で分かる。 */
function totals(rows) {
  var by = {};
  rows.forEach(function (r) {
    var g = by[r.m] || (by[r.m] = { m: r.m, sum: 0, days: 0, plus: 0, maxDay: -Infinity });
    g.sum += r.v; g.days += 1; if (r.v > 0) g.plus += 1;
    if (r.v > g.maxDay) g.maxDay = r.v;
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

function sortTotals(list, dir) {
  var d = dir || state.sortDir;
  return list.sort(function (a, b) {
    return d === "asc" ? a.sum - b.sum : b.sum - a.sum;
  });
}
function sortSingles(rows, dir) {
  var d = dir || state.sortDir;
  return rows.slice().sort(function (a, b) {
    return d === "asc" ? a.v - b.v : b.v - a.v;
  });
}

/* 機種カード用の1日サマリ: その日のNo.1台と機種合計 */
function summarizeDay(rows, dateStr) {
  var day = rows.filter(function (r) { return r.d === dateStr; });
  if (!day.length) return null;
  var top = day.slice().sort(function (a, b) { return b.v - a.v; })[0];
  var sum = day.reduce(function (s, r) { return s + r.v; }, 0);
  return { date: dateStr, count: day.length, top: top, sum: sum };
}

/* 横断No.1: 全機種の最新日の中で一番出た(機種, 台, 日) */
function crossNo1(machines, data) {
  var ms = machines || state.machines, dt = data || state.data;
  var best = null;
  ms.forEach(function (mc) {
    var rows = dt[mc.id] || [];
    if (!rows.length) return;
    var latest = rows.reduce(function (max, r) { return r.d > max ? r.d : max; }, rows[0].d);
    rows.forEach(function (r) {
      if (r.d !== latest) return;
      if (!best || r.v > best.v) best = { machine: mc, m: r.m, v: r.v, d: r.d };
    });
  });
  return best;
}

/* ---- 画面切替 ---- */
function showScreen(name) {
  state.screen = name;
  ["token", "list", "machine"].forEach(function (s) {
    var el = $("screen-" + s);
    if (el) el.style.display = (s === name) ? "" : "none";
  });
  window.scrollTo(0, 0);
}

/* ---- 機種一覧の描画 ---- */
function renderList() {
  var banner = $("crossBanner"), list = $("machineList");
  var best = crossNo1();
  if (best) {
    banner.innerHTML = '<div class="muted">全機種・最新日のNo.1</div>' +
      '<div class="hero-num"><span class="' + (best.v >= 0 ? "pos" : "neg") + '">' + fmt(best.v) +
      '<span class="unit">枚</span></span></div>' +
      '<div class="muted">' + esc(best.machine.name) + ' ' + best.m + '番・' + best.d + '</div>';
  } else {
    banner.innerHTML = '<div class="muted">データがありません。</div>';
  }
  var html = "";
  state.machines.forEach(function (mc) {
    var rows = state.data[mc.id] || [];
    if (!rows.length) {
      html += '<div class="machine-card"><strong>' + esc(mc.name) + '</strong>' +
        '<div class="muted">データがありません。</div></div>';
      return;
    }
    var latest = rows.reduce(function (max, r) { return r.d > max ? r.d : max; }, rows[0].d);
    var s = summarizeDay(rows, latest);
    html += '<div class="machine-card" data-id="' + esc(mc.id) + '">' +
      '<div class="mc-head"><strong>' + esc(mc.name) + '</strong>' +
      '<span class="muted">' + latest + '</span></div>' +
      '<div>その日のNo.1：<strong>' + s.top.m + '番 ' +
      '<span class="' + (s.top.v >= 0 ? "pos" : "neg") + '">' + fmt(s.top.v) + '枚</span></strong></div>' +
      '<div class="muted">機種合計 ' + fmt(s.sum) + '枚（' + s.count + '台分）・タップで詳細へ</div>' +
      '</div>';
  });
  list.innerHTML = html;
  list.querySelectorAll(".machine-card[data-id]").forEach(function (card) {
    card.addEventListener("click", function () { openMachine(card.getAttribute("data-id")); });
  });
  $("listInfo").textContent = state.machines.length + "機種・machines.txt の順番で表示";
}

function openMachine(id) {
  state.currentId = id;
  state.detailMachine = null;
  var rows = currentRows();
  state.latestDate = rows.length
    ? rows.reduce(function (max, r) { return r.d > max ? r.d : max; }, rows[0].d)
    : null;
  renderMachineTabs();
  showScreen("machine");
  renderMachine();
}

function renderMachineTabs() {
  var tabs = $("machineTabs");
  tabs.innerHTML = "";
  state.machines.forEach(function (mc) {
    var b = document.createElement("button");
    b.className = "seg" + (mc.id === state.currentId ? " on" : "");
    b.textContent = mc.name;
    b.addEventListener("click", function () { openMachine(mc.id); });
    tabs.appendChild(b);
  });
  var cur = state.machines.filter(function (mc) { return mc.id === state.currentId; })[0];
  $("machineTitle").textContent = cur ? cur.name : "";
}

/* ---- 機種ページの描画 ---- */
function renderMachine() {
  var rows = filteredRows(currentRows());
  var hero = $("hero"), heroSub = $("heroSub");
  var list = $("list"), title = $("listTitle");
  $("backBtn").style.display = state.detailMachine ? "" : "none";
  $("sortBtn").textContent = state.sortDir === "desc" ? "出てる順 ▼" : "出てない順 ▲";
  var pz = $("plusZeroChip");
  pz.style.display = state.mode === "total" ? "" : "none";
  pz.classList.toggle("on", state.plusZeroOnly);

  if (state.detailMachine) {
    var mine = rows.filter(function (r) { return r.m === state.detailMachine; })
      .sort(function (a, b) { return a.d < b.d ? 1 : -1; });
    var sum = mine.reduce(function (s, r) { return s + r.v; }, 0);
    hero.innerHTML = '<span class="' + (sum >= 0 ? "pos" : "neg") + '">' + fmt(sum) +
      '<span class="unit">枚</span></span>';
    heroSub.textContent = state.detailMachine + "番・この期間の合計（" + mine.length + "日分）";
    title.textContent = state.detailMachine + "番の日別履歴";
    if (!mine.length) { list.innerHTML = '<p class="muted">この期間のデータがありません。</p>'; return; }
    var html = '<table><tr><th>日付</th><th class="num">差枚</th></tr>';
    mine.forEach(function (r) {
      html += '<tr><td>' + r.d + '（' + (dayOf(r.d) % 10) + 'のつく日）</td>' +
        '<td class="num ' + (r.v >= 0 ? "pos" : "neg") + '">' + fmt(r.v) + '</td></tr>';
    });
    list.innerHTML = html + "</table>";
    return;
  }

  if (!rows.length) {
    hero.textContent = "—";
    heroSub.textContent = "この条件のデータがありません。";
    list.innerHTML = '<p class="muted">期間・末尾の条件を変えてみてください。</p>';
    return;
  }

  if (state.mode === "total") {
    var t = sortTotals(totals(rows));
    if (state.plusZeroOnly) t = t.filter(function (g) { return g.plus === 0; });
    if (!t.length) {
      hero.textContent = "—";
      heroSub.textContent = "プラス日ゼロの台がこの期間にありません。";
      list.innerHTML = '<p class="muted">絞り込みを外すか期間を変えてみてください。</p>';
      return;
    }
    var top = t[0];
    hero.innerHTML = '<span class="' + (top.sum >= 0 ? "pos" : "neg") + '">' + fmt(top.sum) +
      '<span class="unit">枚</span></span>';
    heroSub.textContent = top.m + "番が期間No.1（" + top.days + "日分・平均 " +
      fmt(Math.round(top.sum / top.days)) + "枚/日・プラス " + top.plus + "日）";
    title.textContent = "期間合計（全台）";
    var h = '<table><tr><th>#</th><th>台</th><th class="num">合計</th>' +
      '<th class="num">平均/日</th><th class="num">プラス日</th><th class="num">最大単日</th></tr>';
    t.forEach(function (g, i) {
      h += '<tr class="tap' + (i === 0 ? " rank1" : "") + '" data-m="' + g.m + '">' +
        '<td>' + (i + 1) + '</td><td>' + g.m + '番' +
        (g.plus === 0 ? ' <span class="pill">プラスなし</span>' : "") + '</td>' +
        '<td class="num ' + (g.sum >= 0 ? "pos" : "neg") + '">' + fmt(g.sum) + '</td>' +
        '<td class="num">' + fmt(Math.round(g.sum / g.days)) + '</td>' +
        '<td class="num">' + g.plus + '/' + g.days + '</td>' +
        '<td class="num ' + (g.maxDay >= 0 ? "pos" : "neg") + '">' + fmt(g.maxDay) + '</td></tr>';
    });
    list.innerHTML = h + "</table><p class='muted'>行をタップするとその台の日別履歴を表示します。</p>";
  } else {
    var s = sortSingles(rows);
    var top1 = s[0];
    hero.innerHTML = '<span class="' + (top1.v >= 0 ? "pos" : "neg") + '">' + fmt(top1.v) +
      '<span class="unit">枚</span></span>';
    heroSub.textContent = top1.m + "番・" + top1.d + "の単日記録が期間No.1";
    title.textContent = "単日記録（全台）";
    var h2 = '<table><tr><th>#</th><th>台</th><th>日付</th><th class="num">差枚</th></tr>';
    s.forEach(function (r, i) {
      h2 += '<tr class="tap' + (i === 0 ? " rank1" : "") + '" data-m="' + r.m + '">' +
        '<td>' + (i + 1) + '</td><td>' + r.m + '番</td><td>' + r.d + '</td>' +
        '<td class="num ' + (r.v >= 0 ? "pos" : "neg") + '">' + fmt(r.v) + '</td></tr>';
    });
    list.innerHTML = h2 + "</table><p class='muted'>行をタップするとその台の日別履歴を表示します。</p>";
  }

  list.querySelectorAll("tr.tap").forEach(function (tr) {
    tr.addEventListener("click", function () {
      state.detailMachine = tr.getAttribute("data-m");
      renderMachine();
    });
  });
}

function refreshMachineDate() {
  var rows = currentRows();
  state.latestDate = rows.length
    ? rows.reduce(function (max, r) { return r.d > max ? r.d : max; }, rows[0].d)
    : null;
}

/* ---- UI配線（ブラウザでのみ実行。nodeの検証時は走らせない） ---- */
function init() {
  // 末尾チップ 0〜9
  var dr = $("digitRow");
  for (var d = 0; d <= 9; d++) {
    var b = document.createElement("button");
    b.className = "chip"; b.textContent = d; b.setAttribute("data-digit", String(d));
    b.addEventListener("click", function () {
      var k = this.getAttribute("data-digit");
      if (state.digits[k]) { delete state.digits[k]; this.classList.remove("on"); }
      else { state.digits[k] = true; this.classList.add("on"); }
      state.detailMachine = null;
      renderMachine();
    });
    dr.appendChild(b);
  }

  $("periodRow").querySelectorAll("[data-period]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.period = btn.getAttribute("data-period");
      state.detailMachine = null;
      $("periodRow").querySelectorAll("[data-period]").forEach(function (x) {
        x.classList.toggle("on", x === btn);
      });
      $("customRow").style.display = state.period === "custom" ? "" : "none";
      renderMachine();
    });
  });

  document.querySelectorAll("[data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.mode = btn.getAttribute("data-mode");
      state.detailMachine = null;
      document.querySelectorAll("[data-mode]").forEach(function (x) {
        x.classList.toggle("on", x === btn);
      });
      renderMachine();
    });
  });

  $("fromDate").addEventListener("change", renderMachine);
  $("toDate").addEventListener("change", renderMachine);
  $("backBtn").addEventListener("click", function () { state.detailMachine = null; renderMachine(); });
  $("toListBtn").addEventListener("click", function () { showScreen("list"); renderList(); });
  $("sortBtn").addEventListener("click", function () {
    state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
    state.detailMachine = null;
    renderMachine();
  });
  $("plusZeroChip").addEventListener("click", function () {
    state.plusZeroOnly = !state.plusZeroOnly;
    state.detailMachine = null;
    renderMachine();
  });

  $("loadBtn").addEventListener("click", function () {
    var t = $("tokenInput").value.trim();
    if (!t) { setTokenStatus("トークンを貼ってください。"); return; }
    loadAll(t);
  });
  $("changeTokenBtn").addEventListener("click", function () { showScreen("token"); });

  // 保存済みトークンがあれば自動で読み込み、一覧へ（無ければトークン画面のまま）
  var saved = null;
  try { saved = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  showScreen("token");
  if (saved) { $("tokenInput").value = saved; loadAll(saved); }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}

if (typeof document !== "undefined") init();

/* テスト用に主要関数を露出（ブラウザ外のnode検証で使う） */
if (typeof module !== "undefined") {
  module.exports = {
    parseSabaiCsv: parseSabaiCsv,
    parseMachinesTxt: parseMachinesTxt,
    totals: totals,
    summarizeDay: summarizeDay,
    sortTotals: sortTotals,
    sortSingles: sortSingles,
    crossNo1: crossNo1
  };
}
