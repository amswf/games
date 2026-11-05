/* 星光花园 H5 版。
   关卡逻辑与 StarlitGarden/GameModel.swift 逐行对齐，保证三端关卡一致。
   纯脚本无依赖：浏览器直接运行 UI，Node 通过 globalThis.Starlit 引出逻辑做测试。 */
(function (global) {
  'use strict';

  /* ============ 纯逻辑（与 GameModel.swift 对齐） ============ */

  function levelSize(id) { return id < 12 ? 4 : 5; }

  function levelChapter(id) {
    return id < 10 ? '月光初绽' : id < 20 ? '流萤秘境' : '银河盛放';
  }

  // LCG 生成参考解；JS Number 中间值 < 2^53，与 Swift UInt64 结果一致。
  function solutionOf(id) {
    var size = levelSize(id);
    var seed = (id + 1) * 7919;
    var result = new Set();
    var count = Math.min(3 + Math.floor(id / 3), size * size - 2);
    while (result.size < count) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      result.add(seed % (size * size));
    }
    return result;
  }

  // 翻转自身与上下左右
  function toggleAt(index, size, cells) {
    var row = Math.floor(index / size), col = index % size;
    var neighbors = [[row, col], [row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
    for (var i = 0; i < neighbors.length; i++) {
      var r = neighbors[i][0], c = neighbors[i][1];
      if (r >= 0 && c >= 0 && r < size && c < size) cells[r * size + c] = !cells[r * size + c];
    }
  }

  // 初始盘面：全亮后按参考解翻转
  function initialCells(id) {
    var size = levelSize(id);
    var cells = new Array(size * size).fill(true);
    solutionOf(id).forEach(function (index) { toggleAt(index, size, cells); });
    return cells;
  }

  // storage 需要提供 getItem/setItem（浏览器传 localStorage 适配器，测试传内存版）
  function GardenGame(storage) {
    this.storage = storage || null;
    this.records = {};
    this.sound = true;
    this._load();
    this.start(0);
  }
  GardenGame.prototype._load = function () {
    if (!this.storage) return;
    try {
      var raw = this.storage.getItem('garden.records');
      if (raw) this.records = JSON.parse(raw);
    } catch (e) { /* 忽略损坏存档 */ }
    var saved = this.storage.getItem('garden.sound');
    if (saved === 'true' || saved === 'false') this.sound = saved === 'true';
  };
  GardenGame.prototype._saveRecords = function () {
    if (!this.storage) return;
    try { this.storage.setItem('garden.records', JSON.stringify(this.records)); } catch (e) {}
  };
  GardenGame.prototype.setSound = function (value) {
    this.sound = value;
    if (this.storage) try { this.storage.setItem('garden.sound', String(value)); } catch (e) {}
  };
  GardenGame.prototype.start = function (id) {
    this.level = Math.max(0, Math.min(id, 29));
    this.cells = initialCells(this.level);
    this.moves = 0;
    this.won = false;
    this.hint = -1;
    this.pressed = new Set();
    this.usedHint = false;
  };
  GardenGame.prototype.tap = function (index) {
    if (this.won || index < 0 || index >= this.cells.length) return false;
    toggleAt(index, levelSize(this.level), this.cells);
    if (this.pressed.has(index)) this.pressed.delete(index); else this.pressed.add(index);
    this.moves++;
    this.hint = -1;
    if (this.cells.every(Boolean)) {
      this.won = true;
      var key = String(this.level);
      this.records[key] = Math.max(this.records[key] || 0, this.earnedStars());
      this._saveRecords();
    }
    return true;
  };
  GardenGame.prototype.showHint = function () {
    var solution = solutionOf(this.level), remaining = [];
    solution.forEach(function (i) { if (!this.pressed.has(i)) remaining.push(i); }, this);
    this.pressed.forEach(function (i) { if (!solution.has(i)) remaining.push(i); });
    this.hint = remaining.length ? Math.min.apply(null, remaining) : -1;
    this.usedHint = true;
  };
  GardenGame.prototype.earnedStars = function () {
    return this.usedHint ? 1 : (this.moves <= solutionOf(this.level).size ? 3 : 2);
  };
  GardenGame.prototype.litCount = function () {
    return this.cells.filter(Boolean).length;
  };
  GardenGame.prototype.unlocked = function () {
    var highest = -1;
    Object.keys(this.records).forEach(function (key) {
      var id = parseInt(key, 10);
      if (!isNaN(id) && id > highest) highest = id;
    });
    return Math.min(29, highest + 1);
  };
  GardenGame.prototype.totalStars = function () {
    return Object.keys(this.records).reduce(function (sum, key) { return sum + (this.records[key] || 0); }.bind(this), 0);
  };

  var api = {
    levelSize: levelSize,
    levelChapter: levelChapter,
    solutionOf: solutionOf,
    toggleAt: toggleAt,
    initialCells: initialCells,
    GardenGame: GardenGame
  };
  global.Starlit = api;

  /* ============ 浏览器 UI ============ */

  if (typeof document === 'undefined' || !document.getElementById('app')) return;

  var MINT = '#91F0C9', GOLD = '#FFD487';
  var CHAPTERS = ['月光初绽', '流萤秘境', '银河盛放'];

  /* ---------- SVG 构建 ---------- */

  function flowerSVG() {
    var petals = '';
    for (var i = 0; i < 6; i++) {
      petals += '<ellipse class="petal" cx="50" cy="33" rx="11" ry="20" transform="rotate(' + i * 60 + ' 50 50)"/>';
    }
    return '<svg class="flower" viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="glow" cx="50" cy="50" r="40"/>' + petals +
      '<circle class="heart" cx="50" cy="50" r="7.5"/>' +
      '<circle class="ring" cx="50" cy="50" r="43"/></svg>';
  }

  var STAR_POINTS = (function () {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 === 0 ? 10.5 : 4.4;
      pts.push((12 + r * Math.cos(a)).toFixed(2) + ',' + (12 + r * Math.sin(a)).toFixed(2));
    }
    return pts.join(' ');
  })();

  function starSVG(cls) {
    return '<svg class="star' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><polygon points="' + STAR_POINTS + '"/></svg>';
  }

  var LOCK_SVG = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a5 5 0 0 1 5 5v3.2h.8A2.2 2.2 0 0 1 20 13.4v5.4A2.2 2.2 0 0 1 17.8 21H6.2A2.2 2.2 0 0 1 4 18.8v-5.4a2.2 2.2 0 0 1 2.2-2.2H7V8a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v3.2h6V8a3 3 0 0 0-3-3Z"/></svg>';

  var SOUND_ON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2v5.6h3.6L13 19V5L7.6 9.2H4Z"/><path class="wave" d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8M17.8 6.3a8 8 0 0 1 0 11.4"/></svg>';
  var SOUND_OFF_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.2v5.6h3.6L13 19V5L7.6 9.2H4Z"/><path class="wave slash" d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- 音效与触感 ---------- */

  var audioCtx = null;
  function playTapSound() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      var osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1350, t);
      osc.frequency.exponentialRampToValueAtTime(640, t + 0.055);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.15, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(t); osc.stop(t + 0.09);
    } catch (e) { /* 音频不可用时静默 */ }
  }

  function feedback() {
    if (game.sound) {
      playTapSound();
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    }
  }

  /* ---------- 状态与 DOM ---------- */

  var localStorageAdapter = {
    getItem: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  var game = new GardenGame(localStorageAdapter);
  var screen = 0; // 0 首页 1 游戏 2 地图

  function $(id) { return document.getElementById(id); }
  var dom = {
    back: $('btn-back'), backIcon: $('back-icon'), sound: $('btn-sound'),
    home: $('screen-home'), play: $('screen-play'), map: $('screen-map'),
    hero: $('hero'), totalStars: $('total-stars'),
    code: $('play-code'), chapter: $('play-chapter'), moves: $('play-moves'),
    lit: $('play-lit'), capsules: $('capsules'), board: $('board'),
    mapScroll: $('map-scroll'), mapFooter: $('map-footer'),
    victory: $('victory')
  };
  var cellEls = [];

  /* ---------- 夜空 ---------- */

  function buildSky() {
    var sky = $('sky');
    for (var i = 0; i < 65; i++) {
      var star = document.createElement('div');
      star.className = 'sky-star';
      var big = i % 7 === 0;
      star.style.cssText =
        'left:' + (((i * 73 + 19) % 997) / 997 * 100).toFixed(3) + '%;' +
        'top:' + (((i * 137 + 41) % 991) / 991 * 100).toFixed(3) + '%;' +
        'width:' + (big ? 3 : 1.5) + 'px;height:' + (big ? 3 : 1.5) + 'px;' +
        'opacity:' + (((i % 5) + 1) * 0.09).toFixed(2) + ';';
      sky.appendChild(star);
    }
  }

  /* ---------- 首页 ---------- */

  function buildHero() {
    var flowers = [{ x: 0, y: 0, size: 90 }];
    for (var i = 1; i < 7; i++) {
      var angle = i * Math.PI / 3;
      flowers.push({ x: Math.cos(angle) * 98, y: Math.sin(angle) * 98, size: 58 });
    }
    flowers.forEach(function (f) {
      var wrap = document.createElement('div');
      wrap.className = 'hero-flower is-lit';
      wrap.style.width = f.size + 'px';
      wrap.style.height = f.size + 'px';
      wrap.style.transform = 'translate(-50%,-50%) translate(' + f.x.toFixed(1) + 'px,' + f.y.toFixed(1) + 'px)';
      wrap.innerHTML = flowerSVG();
      dom.hero.appendChild(wrap);
    });
  }

  function renderHome() {
    dom.totalStars.innerHTML = starSVG('gold') + '<span>' + game.totalStars() + ' / 90</span>';
  }

  /* ---------- 游戏屏 ---------- */

  function buildBoard() {
    var size = levelSize(game.level);
    dom.board.style.setProperty('--n', size);
    dom.board.innerHTML = '';
    cellEls = [];
    for (var i = 0; i < game.cells.length; i++) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.index = i;
      cell.innerHTML = flowerSVG();
      cell.addEventListener('click', onCellTap);
      dom.board.appendChild(cell);
      cellEls.push(cell);
    }
  }

  function onCellTap(event) {
    if (game.won) return;
    var index = parseInt(event.currentTarget.dataset.index, 10);
    game.tap(index);
    feedback();
    refreshBoard();
    if (game.won) showVictory();
  }

  function refreshBoard() {
    for (var i = 0; i < cellEls.length; i++) {
      var lit = game.cells[i];
      cellEls[i].classList.toggle('is-lit', lit);
      cellEls[i].classList.toggle('is-hinted', game.hint === i);
      cellEls[i].setAttribute('aria-label', '星花 ' + (i + 1) + '，' + (lit ? '亮' : '暗'));
    }
    dom.moves.textContent = game.moves;
    dom.lit.textContent = '已点亮 ' + game.litCount() + ' / ' + game.cells.length;
    var html = '';
    for (var j = 0; j < game.cells.length; j++) {
      html += '<i class="' + (j < game.litCount() ? 'on' : '') + '"></i>';
    }
    dom.capsules.innerHTML = html;
  }

  function enterPlay(id) {
    game.start(id);
    dom.code.textContent = 'GARDEN ' + pad2(game.level + 1);
    dom.chapter.textContent = levelChapter(game.level);
    buildBoard();
    refreshBoard();
    dom.victory.classList.remove('open');
    showScreen(1);
  }

  /* ---------- 关卡地图 ---------- */

  function renderMap() {
    var unlocked = game.unlocked();
    var html = '';
    for (var ch = 0; ch < 3; ch++) {
      html += '<div class="chapter"><div class="chapter-head"><span class="no">0' + (ch + 1) + '</span><span class="name">' + CHAPTERS[ch] + '</span><span class="sparkle">✦</span></div><div class="level-grid">';
      for (var id = ch * 10; id < ch * 10 + 10; id++) {
        var open = id <= unlocked;
        var stars = game.records[String(id)] || 0;
        var starRow = '';
        for (var s = 0; s < 3; s++) starRow += starSVG(s < stars ? 'gold' : 'dim');
        html += '<button type="button" class="level' + (id === unlocked ? ' current' : '') + '"' +
          (open ? '' : ' disabled') +
          ' data-level="' + id + '"' +
          ' aria-label="第 ' + (id + 1) + ' 关，' + (open ? stars + ' 星' : '未解锁') + '">' +
          (open ? '<span class="no">' + pad2(id + 1) + '</span><span class="lv-stars">' + starRow + '</span>' : LOCK_SVG) +
          '</button>';
      }
      html += '</div></div>';
    }
    dom.mapScroll.innerHTML = html;
    dom.mapScroll.querySelectorAll('.level:not([disabled])').forEach(function (btn) {
      btn.addEventListener('click', function () { enterPlay(parseInt(btn.dataset.level, 10)); });
    });
    dom.mapFooter.innerHTML = starSVG('gold') + '<span>' + game.totalStars() + ' 颗星光已收入花园</span>';
  }

  /* ---------- 通关 ---------- */

  function showVictory() {
    var last = game.level === 29;
    var stars = game.earnedStars();
    var starRow = '';
    for (var i = 0; i < 3; i++) starRow += starSVG(i < stars ? 'gold big' : 'dim big');
    dom.victory.innerHTML =
      '<div class="victory-card">' +
      '<div class="victory-flower is-lit">' + flowerSVG() + '</div>' +
      '<h2>' + (last ? '银河已为你盛放' : '这一夜，因你而亮') + '</h2>' +
      '<div class="victory-stars">' + starRow + '</div>' +
      '<p class="victory-meta">第 ' + (game.level + 1) + ' 关 · ' + game.moves + ' 步完成</p>' +
      '<button type="button" id="btn-next" class="btn-primary"><span>' + (last ? '回到花园' : '前往下一片花园') + '</span><span class="arrow">→</span></button>' +
      '<button type="button" id="btn-replay" class="text-btn mint">再欣赏一次</button>' +
      '<button type="button" id="btn-tomap" class="text-btn dim">关卡地图</button>' +
      '</div>';
    $('btn-next').addEventListener('click', function () {
      if (game.level < 29) enterPlay(game.level + 1); else showScreen(2);
    });
    $('btn-replay').addEventListener('click', function () { enterPlay(game.level); });
    $('btn-tomap').addEventListener('click', function () { showScreen(2); });
    requestAnimationFrame(function () { dom.victory.classList.add('open'); });
  }

  /* ---------- 屏幕切换 ---------- */

  function showScreen(next) {
    screen = next;
    dom.home.classList.toggle('active', screen === 0);
    dom.play.classList.toggle('active', screen === 1);
    dom.map.classList.toggle('active', screen === 2);
    dom.backIcon.textContent = screen === 0 ? '✦' : '‹';
    dom.back.setAttribute('aria-label', screen === 0 ? '主页' : '返回');
    if (screen === 0) renderHome();
    if (screen === 2) renderMap();
    if (screen !== 1) dom.victory.classList.remove('open');
  }

  /* ---------- 弹窗 ---------- */

  function bindSheet(sheetId, openBtn, closeBtn) {
    var sheet = $(sheetId);
    $(openBtn).addEventListener('click', function () { sheet.classList.add('open'); });
    sheet.querySelector('.sheet-mask').addEventListener('click', function () { sheet.classList.remove('open'); });
    $(closeBtn).addEventListener('click', function () { sheet.classList.remove('open'); });
  }

  /* ---------- 启动 ---------- */

  buildSky();
  buildHero();
  renderHome();
  updateSoundIcon();

  dom.back.addEventListener('click', function () { showScreen(screen === 1 ? 2 : 0); });
  dom.sound.addEventListener('click', function () {
    game.setSound(!game.sound);
    updateSoundIcon();
    if (game.sound) playTapSound();
  });
  $('btn-continue').addEventListener('click', function () { enterPlay(game.unlocked()); });
  $('btn-explore').addEventListener('click', function () { showScreen(2); });
  $('btn-restart').addEventListener('click', function () { enterPlay(game.level); });
  $('btn-hint').addEventListener('click', function () { game.showHint(); refreshBoard(); });
  bindSheet('sheet-help', 'btn-help', 'btn-help-close');
  bindSheet('sheet-privacy', 'btn-privacy', 'btn-privacy-close');

  function updateSoundIcon() {
    dom.sound.innerHTML = game.sound ? SOUND_ON_SVG : SOUND_OFF_SVG;
    dom.sound.setAttribute('aria-label', game.sound ? '关闭音效' : '开启音效');
  }

})(typeof window !== 'undefined' ? window : globalThis);
