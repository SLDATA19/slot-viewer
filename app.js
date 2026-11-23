/* マイジャグ差枚ビューア v1
 * データ源: 非公開リポジトリ sldata19/slot-data の通算CSV
 * myjugglerV_sabai_all.csv（ヘッダ: 取得日,台番号,推定差枚,備考）
 * トークン無し時は下のデモデータ（2026-11-21/22の実測30件）で動作する。
 */
"use strict";

var REPO_API = "https://api.github.com/repos/sldata19/slot-data/contents/myjugglerV_sabai_all.csv";
var TOKEN_KEY = "slotViewerReadToken";

/* デモデータ: 2026-11-21 / 11-22 のSVG読み取り実測値（チャットで確認済みの30件）。
 * 11/21: 413 +989, 414 -317, 415 +2400, 416 -378, 417 -833, 515 -567, 516 +56,
 *        517 -1367, 518 -844, 519 +2778, 520 -1067, 521 -683, 522 +1478, 523 -800, 524 -1522
 * 11/22: 413 -1189, 414 +94, 415 -972, 416 -111, 417 +800, 515 -800, 516 +211,
 *        517 -978, 518 +2089, 519 -2133, 520 +6, 521 +1889, 522 -700, 523 +4167, 524 -933 */
var DEMO_ROWS = [
  { d: "2026-11-21", m: "413", v: 989 }, { d: "2026-11-21", m: "414", v: -317 },
  { d: "2026-11-21", m: "415", v: 2400 }, { d: "2026-11-21", m: "416", v: -378 },
  { d: "2026-11-21", m: "417", v: -833 }, { d: "2026-11-21", m: "515", v: -567 },
  { d: "2026-11-21", m: "516", v: 56 }, { d: "2026-11-21", m: "517", v: -1367 },
  { d: "2026-11-21", m: "518", v: -844 }, { d: "2026-11-21", m: "519", v: 2778 },
  { d: "2026-11-21", m: "520", v: -1067 }, { d: "2026-11-21", m: "521", v: -683 },
  { d: "2026-11-21", m: "522", v: 1478 }, { d: "2026-11-21", m: "523", v: -800 },
  { d: "2026-11-21", m: "524", v: -1522 },
  { d: "2026-11-22", m: "413", v: -1189 }, { d: "2026-11-22", m: "414", v: 94 },
  { d: "2026-11-22", m: "415", v: -972 }, { d: "2026-11-22", m: "416", v: -111 },
  { d: "2026-11-22", m: "417", v: 800 }, { d: "2026-11-22", m: "515", v: -800 },
  { d: "2026-11-22", m: "516", v: 211 }, { d: "2026-11-22", m: "517", v: -978 },
  { d: "2026-11-22", m: "518", v: 2089 }, { d: "2026-11-22", m: "519", v: -2133 },
  { d: "2026-11-22", m: "520", v: 6 }, { d: "2026-11-22", m: "521", v: 1889 },
  { d: "2026-11-22", m: "522", v: -700 }, { d: "2026-11-22", m: "523", v: 4167 },
  { d: "2026-11-22", m: "524", v: -933 }
];

var state = {
  rows: DEMO_ROWS.slice(),
  live: false,
  period: "all",
  mode: "total",
  digits: {},          // 選択中の末尾数字 { "1": true, ... }（空 = 絞り込みなし）
  machine: "all",
  detailMachine: null, // ドリルダウン中の台番号
  latestDate: null
};

function $(id) { return document.getElementById(id); }
function fmt(n) { return (n > 0 ? "+" : "") + n.toLocaleString("ja-JP"); }
function dayOf(dateStr) { return parseInt(dateStr.slice(8, 10), 10); }
function addDays(dateStr, n) {
  var t = new Date(dateStr + "T00:00:00+09:00");
  t.setDate(t.getDate() + n);
  return t.toISOString().slice(0, 10);
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

/* ---- GitHub連携: 通算CSVを1ファイルだけ読む（Contents API、base64） ---- */
function loadFromGitHub(token) {
  $("loadStatus").textContent = "GitHubから取得中…";
  return fetch(REPO_API, {
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  }).then(function (res) {
    if (res.status === 401) throw new Error("トークンが違うか期限切れです（401）");
    if (res.status === 404) throw new Error("ファイルが見つかりません（404）。リポジトリ名を確認してください");
    if (!res.ok) throw new Error("GitHub APIエラー: HTTP " + res.status);
    return res.json();
  }).then(function (json) {
    // Contents APIは改行入りのbase64を返す
    var b64 = (json.content || "").replace(/\s/g, "");
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var text = new TextDecoder("utf-8").decode(bytes);
    var rows = parseSabaiCsv(text);
    if (!rows.length) throw new Error("CSVは読めたが行が0件でした");
    state.rows = rows;
    state.live = true;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
    refreshAll();
    $("loadStatus").textContent = "取得しました（" + rows.length + "行・" +
      new Date().toLocaleString("ja-JP") + "）";
  }).catch(function (err) {
    $("loadStatus").textContent = "読み込み失敗: " + err.message + "（デモデータのままです）";
  });
}

/* ---- 集計 ---- */
function filteredRows() {
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
  return state.rows.filter(function (r) {
    if (from && r.d < from) return false;
    if (to && r.d > to) return false;
    if (digits.length && digits.indexOf(String(dayOf(r.d) % 10)) < 0) return false;
    if (state.machine !== "all" && r.m !== state.machine) return false;
    return true;
  });
}

function totals(rows) {
  var by = {};
  rows.forEach(function (r) {
    var g = by[r.m] || (by[r.m] = { m: r.m, sum: 0, days: 0, plus: 0 });
    g.sum += r.v; g.days += 1; if (r.v > 0) g.plus += 1;
  });
  return Object.keys(by).map(function (k) { return by[k]; })
    .sort(function (a, b) { return b.sum - a.sum; });
}

/* ---- 描画 ---- */
function render() {
  var rows = filteredRows();
  var badge = $("srcBadge");
  badge.textContent = state.live ? "GitHub連携中" : "デモデータ";
  badge.className = "badge" + (state.live ? " live" : "");
  $("dataInfo").textContent = state.live
    ? "データ最新日: " + state.latestDate + "（" + state.rows.length + "行）"
    : "デモデータ: 2026-11-21〜22の実測30件（" + state.rows.length + "行）・設定からGitHub連携できます";

  var hero = $("hero"), heroSub = $("heroSub");
  var list = $("list"), title = $("listTitle");
  $("backBtn").style.display = state.detailMachine ? "" : "none";

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
    list.innerHTML = '<p class="muted">期間・末尾・機種の条件を変えてみてください。</p>';
    return;
  }

  if (state.mode === "total") {
    var t = totals(rows);
    var top = t[0];
    hero.innerHTML = '<span class="' + (top.sum >= 0 ? "pos" : "neg") + '">' + fmt(top.sum) +
      '<span class="unit">枚</span></span>';
    heroSub.textContent = top.m + "番が期間No.1（" + top.days + "日分・平均 " +
      fmt(Math.round(top.sum / top.days)) + "枚/日・プラス " + top.plus + "日）";
    title.textContent = "期間合計 Top10";
    var h = '<table><tr><th>#</th><th>台</th><th class="num">合計</th>' +
      '<th class="num">平均/日</th><th class="num">プラス日</th></tr>';
    t.slice(0, 10).forEach(function (g, i) {
      h += '<tr class="tap' + (i === 0 ? " rank1" : "") + '" data-m="' + g.m + '">' +
        '<td>' + (i + 1) + '</td><td>' + g.m + '番</td>' +
        '<td class="num ' + (g.sum >= 0 ? "pos" : "neg") + '">' + fmt(g.sum) + '</td>' +
        '<td class="num">' + fmt(Math.round(g.sum / g.days)) + '</td>' +
        '<td class="num">' + g.plus + '/' + g.days + '</td></tr>';
    });
    list.innerHTML = h + "</table><p class='muted'>行をタップするとその台の日別履歴を表示します。</p>";
  } else {
    var s = rows.slice().sort(function (a, b) { return b.v - a.v; });
    var top1 = s[0];
    hero.innerHTML = '<span class="' + (top1.v >= 0 ? "pos" : "neg") + '">' + fmt(top1.v) +
      '<span class="unit">枚</span></span>';
    heroSub.textContent = top1.m + "番・" + top1.d + "の単日記録が期間No.1";
    title.textContent = "単日記録 Top10";
    var h2 = '<table><tr><th>#</th><th>台</th><th>日付</th><th class="num">差枚</th></tr>';
    s.slice(0, 10).forEach(function (r, i) {
      h2 += '<tr class="tap' + (i === 0 ? " rank1" : "") + '" data-m="' + r.m + '">' +
        '<td>' + (i + 1) + '</td><td>' + r.m + '番</td><td>' + r.d + '</td>' +
        '<td class="num ' + (r.v >= 0 ? "pos" : "neg") + '">' + fmt(r.v) + '</td></tr>';
    });
    list.innerHTML = h2 + "</table><p class='muted'>行をタップするとその台の日別履歴を表示します。</p>";
  }

  list.querySelectorAll("tr.tap").forEach(function (tr) {
    tr.addEventListener("click", function () {
      state.detailMachine = tr.getAttribute("data-m");
      render();
    });
  });
}

function refreshAll() {
  state.latestDate = state.rows.reduce(function (max, r) {
    return r.d > max ? r.d : max;
  }, state.rows[0].d);
  // 機種チップを更新
  var machines = Array.from(new Set(state.rows.map(function (r) { return r.m; }))).sort();
  var mr = $("machineRow");
  mr.innerHTML = '<button class="seg' + (state.machine === "all" ? " on" : "") +
    '" data-machine="all">全部</button>';
  machines.forEach(function (m) {
    mr.innerHTML += '<button class="seg' + (state.machine === m ? " on" : "") +
      '" data-machine="' + m + '">' + m + '番</button>';
  });
  mr.querySelectorAll("[data-machine]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.machine = b.getAttribute("data-machine");
      state.detailMachine = null;
      refreshAll();
    });
  });
  render();
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
      render();
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
      render();
    });
  });

  document.querySelectorAll("[data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.mode = btn.getAttribute("data-mode");
      state.detailMachine = null;
      document.querySelectorAll("[data-mode]").forEach(function (x) {
        x.classList.toggle("on", x === btn);
      });
      render();
    });
  });

  $("fromDate").addEventListener("change", render);
  $("toDate").addEventListener("change", render);
  $("backBtn").addEventListener("click", function () { state.detailMachine = null; render(); });

  $("loadBtn").addEventListener("click", function () {
    var t = $("tokenInput").value.trim();
    if (!t) { $("loadStatus").textContent = "トークンを貼ってください。"; return; }
    loadFromGitHub(t);
  });
  $("clearBtn").addEventListener("click", function () {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    $("tokenInput").value = "";
    $("loadStatus").textContent = "トークンを消しました。";
  });
  $("demoBtn").addEventListener("click", function () {
    state.rows = DEMO_ROWS.slice(); state.live = false;
    refreshAll();
    $("loadStatus").textContent = "デモデータに戻しました。";
  });

  // 保存済みトークンがあれば自動でGitHubから読む
  var saved = null;
  try { saved = localStorage.getItem(TOKEN_KEY); } catch (e) {}
  refreshAll();
  if (saved) { $("tokenInput").value = saved; loadFromGitHub(saved); }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
}

if (typeof document !== "undefined") init();

/* テスト用に主要関数を露出（ブラウザ外のnode検証で使う） */
if (typeof module !== "undefined") {
  module.exports = { parseSabaiCsv: parseSabaiCsv, DEMO_ROWS: DEMO_ROWS, totals: totals };
}
