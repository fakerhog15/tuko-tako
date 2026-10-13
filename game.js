(function () {
  "use strict";

  var COLS = 6;
  var ROWS = 12;
  var CELL = 60;

  var COLORS = [
    { name: "blue",   fill: "#1e6bff", edge: "#9fc2ff" },
    { name: "green",  fill: "#16c60c", edge: "#a8f5a2" },
    { name: "red",    fill: "#e02020", edge: "#ffb0b0" },
    { name: "black",  fill: "#0b0b0b", edge: "#ffffff" },
    { name: "white",  fill: "#ffffff", edge: "#c9c9c9" },
    { name: "yellow", fill: "#ffe000", edge: "#fff7b0" }
  ];

  var board = [];
  var piece = null;
  var nextPair = null;
  var state = "idle";       // idle | playing | busy | over
  var score = 0;
  var clearing = [];        // [{x,y}]
  var clearFlash = false;
  var dropTimer = 0;
  var dropInterval = 550;
  var lastTime = 0;
  var softDrop = false;
  var rafId = null;

  var boardCanvas = document.getElementById("board");
  var ctx = boardCanvas.getContext("2d");
  var nextCanvas = document.getElementById("next");
  var nctx = nextCanvas.getContext("2d");
  var scoreEl = document.getElementById("score");
  var chainEl = document.getElementById("chain");
  var overlay = document.getElementById("overlay");
  var startBtn = document.getElementById("startBtn");
  var music = document.getElementById("music");
  var musicBtn = document.getElementById("musicBtn");
  var audioCtx = null;

  var TRACKS = [
    { name: "MAIN MENU", src: "music.mp3" },
    { name: "SNES RAINBOW ROAD", src: "music2.mp3" }
  ];
  var trackIndex = 0;

  function emptyBoard() {
    board = [];
    for (var x = 0; x < COLS; x++) {
      var col = [];
      for (var y = 0; y < ROWS; y++) col.push(-1);
      board.push(col);
    }
  }

  function randColor() {
    return Math.floor(Math.random() * COLORS.length);
  }

  function makePair() {
    return { a: randColor(), b: randColor() };
  }

  // relative cell offsets for the child, indexed by orientation
  // 0=up, 1=right, 2=down, 3=left
  var OFFSETS = [ [0, -1], [1, 0], [0, 1], [-1, 0] ];

  function spawnPiece() {
    var pair = nextPair || makePair();
    nextPair = makePair();
    piece = { x: 2, y: 1, rot: 0, a: pair.a, b: pair.b };
    dropTimer = 0;
    if (collides(piece)) {
      gameOver();
    }
  }

  function cellsOf(p) {
    var o = OFFSETS[p.rot];
    return [
      { x: p.x, y: p.y, color: p.a },
      { x: p.x + o[0], y: p.y + o[1], color: p.b }
    ];
  }

  function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
  }

  function collides(p) {
    var c = cellsOf(p);
    for (var i = 0; i < 2; i++) {
      var cell = c[i];
      if (!inBounds(cell.x, cell.y)) {
        if (cell.y >= ROWS || cell.x < 0 || cell.x >= COLS) return true;
        if (cell.y < 0) continue; // above the top is fine before spawn check
      }
      if (cell.y >= 0 && board[cell.x][cell.y] !== -1) return true;
    }
    return false;
  }

  function tryMove(dx, dy) {
    if (!piece) return false;
    var p = { x: piece.x + dx, y: piece.y + dy, rot: piece.rot, a: piece.a, b: piece.b };
    if (!collides(p)) { piece = p; return true; }
    return false;
  }

  function tryRotate(dir) {
    if (!piece) return false;
    var nr = (piece.rot + dir + 4) % 4;
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i++) {
      var p = { x: piece.x + kicks[i], y: piece.y, rot: nr, a: piece.a, b: piece.b };
      if (!collides(p)) { piece = p; return true; }
    }
    return false;
  }

  function lockPiece() {
    var c = cellsOf(piece);
    for (var i = 0; i < 2; i++) {
      var cell = c[i];
      if (cell.y < 0) continue;
      board[cell.x][cell.y] = cell.color;
    }
    piece = null;
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  function findGroups() {
    var seen = [];
    for (var x = 0; x < COLS; x++) {
      seen.push([]);
      for (var y = 0; y < ROWS; y++) seen[x].push(false);
    }
    var groups = [];
    for (var sx = 0; sx < COLS; sx++) {
      for (var sy = 0; sy < ROWS; sy++) {
        if (seen[sx][sy]) continue;
        var color = board[sx][sy];
        if (color === -1) { seen[sx][sy] = true; continue; }
        var stack = [[sx, sy]];
        var group = [];
        seen[sx][sy] = true;
        while (stack.length) {
          var cur = stack.pop();
          group.push({ x: cur[0], y: cur[1] });
          var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (var d = 0; d < 4; d++) {
            var nx = cur[0] + dirs[d][0];
            var ny = cur[1] + dirs[d][1];
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            if (seen[nx][ny]) continue;
            if (board[nx][ny] === color) {
              seen[nx][ny] = true;
              stack.push([nx, ny]);
            }
          }
        }
        if (group.length >= 4) groups.push(group);
      }
    }
    return groups;
  }

  function applyGravity() {
    for (var x = 0; x < COLS; x++) {
      var write = ROWS - 1;
      for (var y = ROWS - 1; y >= 0; y--) {
        if (board[x][y] !== -1) {
          board[x][write] = board[x][y];
          if (write !== y) board[x][y] = -1;
          write--;
        }
      }
      for (var k = write; k >= 0; k--) board[x][k] = -1;
    }
  }

  function chainScore(cleared, chain) {
    var mult = [0, 1, 2, 4, 8, 16, 32, 64, 96, 128];
    var m = mult[Math.min(chain, mult.length - 1)];
    return cleared * 10 * m;
  }

  async function resolveBoard() {
    var chain = 0;
    while (true) {
      var groups = findGroups();
      if (!groups.length) break;
      chain++;
      var all = [];
      var total = 0;
      groups.forEach(function (g) {
        total += g.length;
        g.forEach(function (cell) { all.push(cell); });
      });

      // flash animation
      for (var f = 0; f < 3; f++) {
        clearing = all;
        clearFlash = (f % 2 === 0);
        draw();
        await sleep(110);
      }

      // remove
      all.forEach(function (cell) { board[cell.x][cell.y] = -1; });
      clearing = [];
      clearFlash = false;
      applyGravity();
      score += chainScore(total, chain);
      updateHud(chain);
      draw();
      await sleep(140);
    }
    chainEl.textContent = chain > 0 ? chain : "-";
    return chain;
  }

  function updateHud(chain) {
    scoreEl.textContent = score.toLocaleString();
    if (chain) chainEl.textContent = chain;
  }

  function gameOver() {
    state = "over";
    piece = null;
    stopMusic();
    gameOverSound();
    overlay.querySelector(".modal").innerHTML =
      '<h2>GAME OVER</h2>' +
      '<p class="tag">Final score: <b style="color:#ffe000">' + score.toLocaleString() + '</b></p>' +
      '<button id="startBtn">PLAY AGAIN</button>' +
      '<p class="hint">Music plays while you play.</p>';
    overlay.classList.add("show");
    document.getElementById("startBtn").addEventListener("click", startGame);
  }

  function startGame() {
    emptyBoard();
    score = 0;
    chainEl.textContent = "-";
    updateHud(0);
    nextPair = makePair();
    clearing = [];
    overlay.classList.remove("show");
    state = "playing";
    spawnPiece();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    playMusic();
    lastTime = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function playMusic() {
    if (music.src.indexOf(TRACKS[trackIndex].src) === -1) {
      music.src = TRACKS[trackIndex].src;
    }
    music.volume = 0.55;
    var p = music.play();
    if (p && p.catch) p.catch(function () {});
  }

  function stopMusic() {
    try { music.pause(); } catch (e) {}
  }

  function updateMusicBtn() {
    if (musicBtn) musicBtn.textContent = "MUSIC: " + TRACKS[trackIndex].name;
  }

  function cycleTrack(e) {
    if (e.preventDefault) e.preventDefault();
    trackIndex = (trackIndex + 1) % TRACKS.length;
    music.src = TRACKS[trackIndex].src;
    if (state === "playing" || state === "busy") playMusic();
    updateMusicBtn();
  }

  function gameOverSound() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      var now = audioCtx.currentTime;
      var notes = [392, 330, 262, 196, 131];
      notes.forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        var t = now + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      });
    } catch (e) {}
  }

  // ---------- rendering ----------

  function drawCell(c, x, y, cellSize) {
    var px = x * cellSize;
    var py = y * cellSize;
    var col = COLORS[c];
    ctx.save();
    ctx.fillStyle = col.fill;
    ctx.fillRect(px, py, cellSize, cellSize);
    ctx.strokeStyle = col.edge;
    ctx.lineWidth = Math.max(2, cellSize * 0.07);
    ctx.strokeRect(px + 1.5, py + 1.5, cellSize - 3, cellSize - 3);
    ctx.restore();
  }

  function drawCellAt(c, px, py, cellSize, context) {
    var c2 = context || ctx;
    var col = COLORS[c];
    c2.fillStyle = col.fill;
    c2.fillRect(px, py, cellSize, cellSize);
    c2.strokeStyle = col.edge;
    c2.lineWidth = Math.max(2, cellSize * 0.07);
    c2.strokeRect(px + 1.5, py + 1.5, cellSize - 3, cellSize - 3);
  }

  function draw() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    // grid
    ctx.strokeStyle = "#1c1c1c";
    ctx.lineWidth = 1;
    for (var gx = 1; gx < COLS; gx++) {
      ctx.beginPath();
      ctx.moveTo(gx * CELL, 0);
      ctx.lineTo(gx * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (var gy = 1; gy < ROWS; gy++) {
      ctx.beginPath();
      ctx.moveTo(0, gy * CELL);
      ctx.lineTo(COLS * CELL, gy * CELL);
      ctx.stroke();
    }

    // settled blocks
    for (var x = 0; x < COLS; x++) {
      for (var y = 0; y < ROWS; y++) {
        if (board[x][y] !== -1) drawCell(board[x][y], x, y, CELL);
      }
    }

    // clearing flash
    if (clearing.length) {
      clearing.forEach(function (cell) {
        var px = cell.x * CELL;
        var py = cell.y * CELL;
        if (clearFlash) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(px, py, CELL, CELL);
        } else {
          ctx.fillStyle = "#000000";
          ctx.fillRect(px, py, CELL, CELL);
        }
      });
    }

    // active piece
    if (piece) {
      var cells = cellsOf(piece);
      cells.forEach(function (cell) {
        if (cell.y >= 0) drawCell(cell.color, cell.x, cell.y, CELL);
      });
    }

    drawNext();
  }

  function drawNext() {
    nctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPair) return;
    var s = 46;
    var ox = (nextCanvas.width - s) / 2;
    var oy = 14;
    drawCellAt(nextPair.a, ox, oy + s + 6, s, nctx);
    drawCellAt(nextPair.b, ox, oy, s, nctx);
  }

  // ---------- loop ----------

  function loop(t) {
    if (state !== "playing") return;
    var dt = t - lastTime;
    lastTime = t;
    dropTimer += dt;

    var interval = softDrop ? 60 : dropInterval;
    if (dropTimer >= interval) {
      dropTimer = 0;
      if (!tryMove(0, 1)) {
        lockPiece();
        state = "busy";
        draw();
        resolveBoard().then(function () {
          if (state === "busy") {
            spawnPiece();
            if (state === "busy") state = "playing";
            lastTime = performance.now();
            draw();
            rafId = requestAnimationFrame(loop);
          }
        });
        return;
      }
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- input ----------

  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowDown") softDrop = false;
  });

  document.addEventListener("keydown", function (e) {
    if (state !== "playing") return;
    switch (e.key) {
      case "ArrowLeft": tryMove(-1, 0); break;
      case "ArrowRight": tryMove(1, 0); break;
      case "ArrowDown": softDrop = true; dropTimer = 999999; break;
      case "ArrowUp": case "x": case "X": tryRotate(1); break;
      case "z": case "Z": tryRotate(-1); break;
      case " ": e.preventDefault(); hardDrop(); break;
      default: return;
    }
    e.preventDefault();
    draw();
  });

  function hardDrop() {
    var guard = 0;
    while (tryMove(0, 1) && guard++ < ROWS + 2) {}
    dropTimer = 999999;
  }

  // touch controls
  document.querySelectorAll("#touch button").forEach(function (btn) {
    var act = btn.getAttribute("data-act");
    function fire(e) {
      e.preventDefault();
      if (state !== "playing") return;
      if (act === "left") tryMove(-1, 0);
      else if (act === "right") tryMove(1, 0);
      else if (act === "rotL") tryRotate(-1);
      else if (act === "rotR") tryRotate(1);
      else if (act === "down") softDrop = true;
      else if (act === "drop") hardDrop();
      draw();
    }
    btn.addEventListener("touchstart", fire, { passive: false });
    btn.addEventListener("mousedown", fire);
  });

  // pause music when tab hidden
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopMusic();
    else if (state === "playing" || state === "busy") playMusic();
  });

  startBtn.addEventListener("click", startGame);
  if (musicBtn) {
    musicBtn.addEventListener("click", cycleTrack);
    updateMusicBtn();
  }

  // boot
  emptyBoard();
  draw();
})();
