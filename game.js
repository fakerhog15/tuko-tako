(function () {
  "use strict";

  // ---------- board geometry (all drawn on one canvas, Ssuika-style) ----------
  var COLS = 6;
  var ROWS = 12;
  var CELL = 48;

  var HOLD_W = 3 * CELL;
  var NEXT_W = 3 * CELL;
  var GRID_W = COLS * CELL;
  var GRID_H = ROWS * CELL;
  var BAND = 54;             // top band (score)
  var BAR = 28;              // bottom band (level progress)
  var W = HOLD_W + GRID_W + NEXT_W;
  var H = BAND + GRID_H + BAR;
  var GX = HOLD_W;           // grid origin x
  var GY = BAND;             // grid origin y

  var COLORS = [
    { name: "blue",   fill: "#1e6bff", edge: "#9fc2ff" },
    { name: "green",  fill: "#16c60c", edge: "#a8f5a2" },
    { name: "red",    fill: "#e02020", edge: "#ffb0b0" },
    { name: "black",  fill: "#0b0b0b", edge: "#ffffff" },
    { name: "white",  fill: "#ffffff", edge: "#c9c9c9" },
    { name: "yellow", fill: "#ffe000", edge: "#fff7b0" }
  ];

  var OFFSETS = [ [0, -1], [1, 0], [0, 1], [-1, 0] ];

  var LEVEL_UP = 1500;
  var DROP_TABLE = [620, 560, 500, 450, 400, 350, 300, 250, 200, 150];
  var DAS = 0.120;   // s held before auto-repeat
  var ARR = 0.035;   // s between auto-repeat steps

  // ---------- state ----------
  var board = [];
  var piece = null;
  var heldPair = null;
  var canHold = true;
  var nextQueue = [];
  var state = "idle";         // idle | playing | busy | over
  var score = 0;
  var clearing = [];
  var clearFlash = false;
  var particles = [];
  var dropTimer = 0;
  var lastTime = 0;
  var softDrop = false;
  var rafId = null;
  var chainFlash = 0;

  // input state
  var leftHeld = false, rightHeld = false;
  var dasLeft = 0, arrLeft = 0, dasRight = 0, arrRight = 0;

  // ---------- dom ----------
  var boardCanvas = document.getElementById("board");
  var overlay = document.getElementById("overlay");
  var startBtn = document.getElementById("startBtn");
  var music = document.getElementById("music");
  var musicBtn = document.getElementById("musicBtn");
  var crtBtn = document.getElementById("crtBtn");
  var stage = document.getElementById("stage");
  var audioCtx = null;

  var TRACKS = [
    { name: "MAIN MENU", src: "music.mp3" },
    { name: "SNES RAINBOW ROAD", src: "music2.mp3" }
  ];
  var trackIndex = 0;

  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  // game renders to an offscreen 2D canvas, then is presented through a
  // CRT/RF post-process (WebGL) onto the visible canvas.
  var scene = document.createElement("canvas");
  scene.width = W * DPR;
  scene.height = H * DPR;
  var ctx = scene.getContext("2d");

  boardCanvas.width = W * DPR;
  boardCanvas.height = H * DPR;
  boardCanvas.style.width = W + "px";
  boardCanvas.style.height = H + "px";

  var crt = null;
  var fbCtx = null;

  // CRT/RF display modes, cycled by the DISPLAY button and persisted.
  var CRT_MODES = ["rf", "crt", "off"];
  var CRT_LABEL = { rf: "CRT + RF", crt: "CRT", off: "OFF" };
  var crtMode = "rf";

  function loadCrtMode() {
    try {
      var q = (location.search.match(/[?&]crt=([a-z0-9]+)/i) || [])[1];
      if (q) {
        q = q.toLowerCase();
        if (q === "1" || q === "on") q = "rf";
        if (q === "0") q = "off";
        if (CRT_MODES.indexOf(q) >= 0) return q;
      }
    } catch (e) {}
    try {
      var s = localStorage.getItem("tukotako.crt");
      if (CRT_MODES.indexOf(s) >= 0) return s;
    } catch (e) {}
    return "rf";
  }

  function initCRT() {
    try { crt = createCRT(boardCanvas, W * DPR, H * DPR); } catch (e) { crt = null; }
    fbCtx = crt ? null : boardCanvas.getContext("2d");
    crtMode = crt ? loadCrtMode() : "off";
  }

  // ---------- helpers ----------
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

  function refillQueue() {
    nextQueue = [];
    for (var i = 0; i < 4; i++) nextQueue.push(makePair());
  }

  function cellsOf(p) {
    var o = OFFSETS[p.rot];
    return [
      { x: p.x, y: p.y, color: p.a },
      { x: p.x + o[0], y: p.y + o[1], color: p.b }
    ];
  }

  function collidesXY(x, y, rot) {
    var o = OFFSETS[rot];
    var pts = [[x, y], [x + o[0], y + o[1]]];
    for (var i = 0; i < 2; i++) {
      var cx = pts[i][0], cy = pts[i][1];
      if (cy >= ROWS || cx < 0 || cx >= COLS) return true;
      if (cy < 0) continue;
      if (board[cx][cy] !== -1) return true;
    }
    return false;
  }

  function tryMove(dx, dy) {
    if (!piece) return false;
    if (!collidesXY(piece.x + dx, piece.y + dy, piece.rot)) {
      piece.x += dx;
      piece.y += dy;
      return true;
    }
    return false;
  }

  function tryRotate(dir) {
    if (!piece) return false;
    var nr = (piece.rot + dir + 4) % 4;
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i++) {
      if (!collidesXY(piece.x + kicks[i], piece.y, nr)) {
        piece.x += kicks[i];
        piece.rot = nr;
        return true;
      }
    }
    return false;
  }

  function landingCells(p) {
    var g = { x: p.x, y: p.y, rot: p.rot, a: p.a, b: p.b };
    var guard = 0;
    while (!collidesXY(g.x, g.y + 1, g.rot) && guard++ < ROWS + 4) g.y++;
    return cellsOf(g);
  }

  function spawnPiece() {
    var pair = nextQueue.shift();
    nextQueue.push(makePair());
    piece = { x: 2, y: 1, rot: 0, a: pair.a, b: pair.b };
    dropTimer = 0;
    if (collidesXY(piece.x, piece.y, piece.rot)) {
      gameOver();
    }
  }

  function lockPiece() {
    var cs = cellsOf(piece);
    cs.forEach(function (cell) {
      if (cell.y < 0) return;
      board[cell.x][cell.y] = cell.color;
      spawnParticles(cellCX(cell.x), cellCY(cell.y), COLORS[cell.color].fill, 7, 100);
    });
    soundLand();
    piece = null;
    canHold = true;
  }

  function doHold() {
    if (!piece || !canHold || state !== "playing") return;
    var cur = { a: piece.a, b: piece.b };
    if (heldPair) {
      piece = { x: 2, y: 1, rot: 0, a: heldPair.a, b: heldPair.b };
    } else {
      piece = null;
      spawnPiece();
      piece = { x: 2, y: 1, rot: 0, a: cur.a, b: cur.b };
    }
    heldPair = cur;
    canHold = false;
    soundHold();
    draw();
  }

  function hardDrop() {
    if (!piece) return;
    var g = { x: piece.x, y: piece.y, rot: piece.rot };
    var guard = 0;
    while (!collidesXY(g.x, g.y + 1, g.rot) && guard++ < ROWS + 4) g.y++;
    piece.y = g.y;
    soundHard();
    dropTimer = 999999;
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  function level() {
    return Math.min(DROP_TABLE.length - 1, Math.floor(score / LEVEL_UP));
  }
  function levelProgress() {
    return (score % LEVEL_UP) / LEVEL_UP;
  }
  function dropInterval() {
    return softDrop ? 45 : DROP_TABLE[level()];
  }

  // ---------- matching / clearing (Puyo rules) ----------
  function findGroups() {
    var seen = [];
    for (var x = 0; x < COLS; x++) {
      seen.push([]);
      for (var y = 0; y < ROWS; y++) seen[x].push(false);
    }
    var groups = [];
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
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
      groups.forEach(function (g) {
        g.forEach(function (cell) { all.push(cell); });
      });
      var total = all.length;

      for (var f = 0; f < 3; f++) {
        updateParticles(0.085);
        clearing = all;
        clearFlash = (f % 2 === 0);
        if (f === 0) {
          all.forEach(function (cell) {
            var col = COLORS[board[cell.x][cell.y]];
            spawnParticles(cellCX(cell.x), cellCY(cell.y), col.fill, 13, 190);
          });
        }
        draw();
        await sleep(85);
      }

      all.forEach(function (cell) { board[cell.x][cell.y] = -1; });
      clearing = [];
      clearFlash = false;
      applyGravity();
      score += chainScore(total, chain);
      chainFlash = chain;
      soundClear(chain);
      updateParticles(0.14);
      draw();
      await sleep(140);
    }
    chainFlash = 0;
    return chain;
  }

  // ---------- particles ----------
  function cellCX(x) { return GX + (x + 0.5) * CELL; }
  function cellCY(y) { return GY + (y + 0.5) * CELL; }

  function spawnParticles(x, y, hex, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = spd * (0.4 + Math.random() * 0.8);
      if (particles.length > 700) particles.shift();
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 40,
        life: 0.35 + Math.random() * 0.3,
        size: 3 + Math.random() * 3,
        color: hex
      });
    }
  }

  function updateParticles(dt) {
    var out = [];
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      out.push(p);
    }
    particles = out;
  }

  // ---------- sound (16-bit SNES-style chiptune SFX) ----------
  var noiseBuf = null;

  function ensureAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
  }

  // SNES APU noise channel: band-limited static burst
  function noise(dur, vol, t, filterFreq) {
    try {
      ensureAudio();
      if (!noiseBuf) {
        var len = audioCtx.sampleRate * 0.5;
        noiseBuf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      var src = audioCtx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      var lp = audioCtx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = filterFreq || 2200;
      var g = audioCtx.createGain();
      var now = audioCtx.currentTime + (t || 0);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol || 0.18, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(lp); lp.connect(g); g.connect(audioCtx.destination);
      src.start(now); src.stop(now + dur + 0.03);
    } catch (e) {}
  }

  // SNES-style tone: pulse/square lead + optional sub oscillator for punch
  function tone(freq, opts) {
    opts = opts || {};
    try {
      ensureAudio();
      var now = audioCtx.currentTime + (opts.t || 0);
      var dur = opts.dur || 0.1;
      var f = freq;
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = opts.wave || "square";
      o.frequency.setValueAtTime(f, now);
      if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), now + dur);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(opts.vol || 0.16, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start(now);
      o.stop(now + dur + 0.03);

      if (opts.sub) {
        var o2 = audioCtx.createOscillator();
        var g2 = audioCtx.createGain();
        o2.type = "square";
        o2.frequency.setValueAtTime(f / 2, now);
        g2.gain.setValueAtTime(0.0001, now);
        g2.gain.exponentialRampToValueAtTime((opts.vol || 0.16) * 0.55, now + 0.004);
        g2.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o2.connect(g2);
        g2.connect(audioCtx.destination);
        o2.start(now);
        o2.stop(now + dur + 0.03);
      }
    } catch (e) {}
  }

  function soundMove() {
    tone(300, { dur: 0.04, vol: 0.045 });
  }
  function soundRotate() {
    tone(440, { dur: 0.05, vol: 0.09, slide: 620 });
    tone(660, { t: 0.03, dur: 0.045, vol: 0.06, wave: "triangle" });
  }
  function soundLand() {
    tone(160, { dur: 0.09, vol: 0.18, slide: 66, sub: true });
    noise(0.06, 0.10, 0, 1500);
  }
  function soundHard() {
    tone(110, { dur: 0.15, vol: 0.26, slide: 40, sub: true });
    noise(0.12, 0.22, 0, 1100);
  }
  function soundHold() {
    tone(660, { dur: 0.06, vol: 0.10, slide: 880 });
    tone(990, { t: 0.05, dur: 0.08, vol: 0.10, slide: 1320 });
  }
  function soundClear(chain) {
    var base = 520 + Math.min(chain, 8) * 70;
    tone(base, { dur: 0.09, vol: 0.16, slide: base * 1.4 });
    tone(base * 1.5, { t: 0.05, dur: 0.10, vol: 0.11, wave: "triangle" });
    tone(base * 2, { t: 0.09, dur: 0.12, vol: 0.10 });
    noise(0.05, 0.06, 0, 3500);
  }
  function gameOverSound() {
    var notes = [392, 330, 277, 220, 165, 110];
    notes.forEach(function (freq, i) {
      tone(freq, { t: i * 0.16, dur: 0.18, vol: 0.20, slide: freq * 0.88 });
      if (i === notes.length - 1) noise(0.4, 0.22, i * 0.16, 900);
    });
  }

  function playMusic() {
    if (music.src.indexOf(TRACKS[trackIndex].src) === -1) {
      music.src = TRACKS[trackIndex].src;
    }
    music.volume = 0.5;
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

  // ---------- game flow ----------
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
    heldPair = null;
    canHold = true;
    refillQueue();
    clearing = [];
    particles = [];
    chainFlash = 0;
    overlay.classList.remove("show");
    state = "playing";
    spawnPiece();
    ensureAudio();
    playMusic();
    lastTime = performance.now();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  // ---------- CRT + RF post-process (WebGL) ----------
  // Replicates the crt-geom look (curvature, aperture-grille mask, scanlines,
  // rounded corner) plus the crt-guest-advanced NTSC/RF look (color fringing,
  // RF static, horizontal ringing and phosphor afterglow).
  var CRT_VERT = [
    "attribute vec2 aPos;",
    "varying vec2 vUv;",
    "void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }"
  ].join("\n");

  var CRT_FRAG = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "varying vec2 vUv;",
    "uniform sampler2D uScene;",
    "uniform sampler2D uPrev;",
    "uniform vec2 uRes;",
    "uniform float uTime;",
    "uniform float uBlit;",
    "uniform float uCurvature;",
    "uniform float uScanline;",
    "uniform float uMask;",
    "uniform float uRfNoise;",
    "uniform float uFringing;",
    "uniform float uEcho;",
    "uniform float uAfterglow;",
    "uniform float uVignette;",
    "uniform float uGamma;",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(41.0, 289.0))) * 45758.5453); }",
    "vec2 distort(vec2 uv){",
    "  vec2 c = uv * 2.0 - 1.0;",
    "  float r2 = dot(c, c);",
    "  c *= 1.0 + uCurvature * 0.14 * r2;",
    "  return c * 0.5 + 0.5;",
    "}",
    "void main(){",
    "  if (uBlit > 0.5) { gl_FragColor = vec4(texture2D(uScene, vUv).rgb, 1.0); return; }",
    "  vec2 uv = distort(vUv);",
    "  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }",
    "  float px = 1.0 / uRes.x;",
    "  float off = uFringing * 1.6 * px;",
    "  vec3 s;",
    "  s.r = texture2D(uScene, uv + vec2(off, 0.0)).r;",
    "  s.g = texture2D(uScene, uv).g;",
    "  s.b = texture2D(uScene, uv - vec2(off, 0.0)).b;",
    "  s += texture2D(uScene, uv + vec2(px * 2.0, 0.0)).rgb * 0.06 * uEcho;",
    "  s -= texture2D(uScene, uv - vec2(px * 3.0, 0.0)).rgb * 0.045 * uEcho;",
    "  s = clamp(s, 0.0, 1.0);",
    "  float mx = mod(gl_FragCoord.x, 3.0);",
    "  vec3 maskCol = mx < 1.0 ? vec3(1.0,0.0,0.0) : (mx < 2.0 ? vec3(0.0,1.0,0.0) : vec3(0.0,0.0,1.0));",
    "  s *= mix(vec3(1.0), maskCol * 2.4, uMask);",
    "  float scan = 0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159265);",
    "  s *= 1.0 - uScanline * scan;",
    "  float n = hash(gl_FragCoord.xy + vec2(uTime * 61.0, uTime * 97.0));",
    "  float streak = hash(vec2(gl_FragCoord.y, floor(uTime * 30.0)));",
    "  s += (n - 0.5) * uRfNoise * 0.6 + (streak - 0.5) * uRfNoise * 0.3;",
    "  s = clamp(s, 0.0, 1.0);",
    "  vec3 prev = texture2D(uPrev, uv).rgb;",
    "  s = max(s, prev * uAfterglow);",
    "  vec2 v = vUv - 0.5;",
    "  float vig = smoothstep(0.95, 0.25, dot(v, v) * 2.2);",
    "  s *= mix(1.0, vig, uVignette);",
    "  s = pow(s, vec3(1.0 / uGamma));",
    "  gl_FragColor = vec4(s, 1.0);",
    "}"
  ].join("\n");

  function createCRT(canvas, w, h) {
    var gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: false }) ||
             canvas.getContext("experimental-webgl", { alpha: false });
    if (!gl) return null;

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) || "shader compile error");
      }
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, CRT_VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, CRT_FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || "program link error");
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    function makeTex() {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    }
    var sceneTex = makeTex();
    var prevTex = makeTex();
    var writeTex = makeTex();

    var writeFbo = gl.createFramebuffer();
    var clearFbo = gl.createFramebuffer();

    // clear persistence buffers to black
    gl.bindFramebuffer(gl.FRAMEBUFFER, clearFbo);
    [prevTex, writeTex].forEach(function (t) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var U = {};
    ["uScene", "uPrev", "uRes", "uTime", "uBlit", "uCurvature", "uScanline",
     "uMask", "uRfNoise", "uFringing", "uEcho", "uAfterglow", "uVignette", "uGamma"]
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    var params = {
      curvature: 0.5, scanline: 0.22, mask: 0.22, rfNoise: 0.10,
      fringing: 1.0, echo: 1.0, afterglow: 0.35, vignette: 0.45, gamma: 1.25
    };

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.viewport(0, 0, w, h);

    function drawQuad() { gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    function bindScene(tex, unit) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.uScene, unit);
    }

    return {
      gl: gl,
      params: params,
      setParams: function (p) { for (var k in p) params[k] = p[k]; },
      render: function (sceneCanvas, time, mode) {
        gl.bindTexture(gl.TEXTURE_2D, sceneTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);

        if (mode === "off") {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, w, h);
          bindScene(sceneTex, 0);
          gl.uniform1f(U.uBlit, 1.0);
          drawQuad();
          return;
        }

        var rf = mode === "rf";

        // pass 1: effects -> write texture
        gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, writeTex, 0);
        gl.viewport(0, 0, w, h);
        gl.uniform1f(U.uBlit, 0.0);
        bindScene(sceneTex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, prevTex);
        gl.uniform1i(U.uPrev, 1);
        gl.uniform2f(U.uRes, w, h);
        gl.uniform1f(U.uTime, time);
        gl.uniform1f(U.uCurvature, params.curvature);
        gl.uniform1f(U.uScanline, params.scanline);
        gl.uniform1f(U.uMask, params.mask);
        gl.uniform1f(U.uRfNoise, rf ? params.rfNoise : 0.0);
        gl.uniform1f(U.uFringing, rf ? params.fringing : 0.0);
        gl.uniform1f(U.uEcho, rf ? params.echo : 0.0);
        gl.uniform1f(U.uAfterglow, rf ? params.afterglow : 0.0);
        gl.uniform1f(U.uVignette, params.vignette);
        gl.uniform1f(U.uGamma, params.gamma);
        drawQuad();

        // pass 2: blit result -> screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        bindScene(writeTex, 0);
        gl.uniform1f(U.uBlit, 1.0);
        drawQuad();

        // ping-pong persistence
        var t = prevTex;
        prevTex = writeTex;
        writeTex = t;
      }
    };
  }

  function present() {
    if (crt) {
      crt.render(scene, performance.now() / 1000, crtMode);
    } else if (fbCtx) {
      fbCtx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);
      fbCtx.drawImage(scene, 0, 0);
    }
  }

  initCRT();

  // ---------- rendering ----------
  function drawSquare(x, y, size, fill, edge) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, size, size);
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
    }
  }

  function drawBoardCell(c, x, y) {
    drawSquare(GX + x * CELL, GY + y * CELL, CELL, COLORS[c].fill, COLORS[c].edge);
  }

  function drawText(str, x, y, size, color, align) {
    ctx.font = "700 " + size + 'px "Iosevka Nerd Font Mono", "Courier New", monospace';
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color || "#ffffff";
    ctx.fillText(str, x, y);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // dark bands
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, 0, HOLD_W, H);
    ctx.fillRect(GX + GRID_W, 0, NEXT_W, H);

    // faint grid
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= COLS; gx++) {
      ctx.beginPath();
      ctx.moveTo(GX + gx * CELL, GY);
      ctx.lineTo(GX + gx * CELL, GY + GRID_H);
      ctx.stroke();
    }
    for (var gy = 0; gy <= ROWS; gy++) {
      ctx.beginPath();
      ctx.moveTo(GX, GY + gy * CELL);
      ctx.lineTo(GX + GRID_W, GY + gy * CELL);
      ctx.stroke();
    }

    // column highlight under active piece
    if (piece) {
      var gcs = landingCells(piece);
      var acs = cellsOf(piece);
      var cols = {};
      acs.forEach(function (c) { cols[c.x] = true; });
      Object.keys(cols).forEach(function (cx) {
        var colX = +cx;
        var top = ROWS, bot = 0;
        acs.forEach(function (c) { if (c.x === colX) top = Math.min(top, c.y); });
        gcs.forEach(function (c) { if (c.x === colX) bot = Math.max(bot, c.y); });
        if (bot >= top) {
          ctx.fillStyle = "rgba(255,255,255,0.06)";
          ctx.fillRect(GX + colX * CELL, GY + (top + 1) * CELL, CELL, (bot - top) * CELL);
        }
      });

      // ghost
      gcs.forEach(function (cell) {
        if (cell.y < 0) return;
        ctx.globalAlpha = 0.22;
        drawSquare(GX + cell.x * CELL, GY + cell.y * CELL, CELL, COLORS[cell.color].fill, COLORS[cell.color].edge);
        ctx.globalAlpha = 1;
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(GX + cell.x * CELL + 2, GY + cell.y * CELL + 2, CELL - 4, CELL - 4);
        ctx.setLineDash([]);
      });
    }

    // settled blocks
    for (var x = 0; x < COLS; x++) {
      for (var y = 0; y < ROWS; y++) {
        if (board[x][y] !== -1 && !isClearing(x, y)) drawBoardCell(board[x][y], x, y);
      }
    }

    // clearing flash
    if (clearing.length) {
      clearing.forEach(function (cell) {
        var px = GX + cell.x * CELL, py = GY + cell.y * CELL;
        ctx.fillStyle = clearFlash ? "#ffffff" : "#000000";
        ctx.fillRect(px, py, CELL, CELL);
      });
    }

    // active pair
    if (piece) {
      cellsOf(piece).forEach(function (cell) {
        if (cell.y >= 0) drawBoardCell(cell.color, cell.x, cell.y);
      });
    }

    // particles
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.min(1, p.life * 2.4);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // score band
    drawText("SCORE", GX + GRID_W / 2, BAND / 2 - 10, 12, "#808080");
    drawText(score.toLocaleString(), GX + GRID_W / 2, BAND / 2 + 10, 22, "#ffffff");
    if (chainFlash > 1) {
      drawText("CHAIN x" + chainFlash, GX + GRID_W / 2, BAND / 2 - 26, 14, "#ffe000");
    }

    // level progress bar
    var bgy = H - BAR + 6;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(GX, bgy, GRID_W, 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(GX, bgy, GRID_W * levelProgress(), 4);
    drawText("Lv " + (level() + 1), GX + GRID_W / 2, H - BAR / 2, 14, "#cfcfcf");

    // hold
    drawText("HOLD", HOLD_W / 2, BAND / 2, 12, "#808080");
    var hx = HOLD_W / 2, hy = BAND + 2 * CELL;
    if (heldPair) {
      drawPair(heldPair, hx, hy, canHold ? 1 : 0.4);
    } else {
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(hx - CELL / 2 - 2, hy - CELL - 2, CELL + 4, CELL * 2 + 4);
      ctx.setLineDash([]);
    }

    // next queue
    drawText("NEXT", GX + GRID_W + NEXT_W / 2, BAND / 2, 12, "#808080");
    for (var q = 0; q < Math.min(3, nextQueue.length); q++) {
      drawPair(nextQueue[q], GX + GRID_W + NEXT_W / 2, BAND + 26 + q * (2 * CELL + 10));
    }

    present();
  }

  function isClearing(x, y) {
    for (var i = 0; i < clearing.length; i++) {
      if (clearing[i].x === x && clearing[i].y === y) return true;
    }
    return false;
  }

  function drawPair(pair, cx, cy, alpha) {
    var s = CELL * 0.62;
    ctx.globalAlpha = alpha != null ? alpha : 1;
    drawSquare(cx - s / 2, cy - s - s / 2, s, COLORS[pair.a].fill, COLORS[pair.a].edge);
    drawSquare(cx - s / 2, cy - s / 2, s, COLORS[pair.b].fill, COLORS[pair.b].edge);
    ctx.globalAlpha = 1;
  }

  // ---------- main loop ----------
  function loop(t) {
    if (state !== "playing") return;
    var dt = Math.min(0.05, (t - lastTime) / 1000);
    lastTime = t;

    updatePieceInput(dt);
    updateParticles(dt);

    dropTimer += dt * 1000;
    if (dropTimer >= dropInterval()) {
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

  function updatePieceInput(dt) {
    if (!piece || state !== "playing") return;

    if (leftHeld && !rightHeld) {
      dasLeft += dt;
      if (dasLeft >= DAS) {
        arrLeft += dt;
        if (arrLeft >= ARR) {
          if (tryMove(-1, 0)) soundMove();
          arrLeft = 0;
        }
      }
    }
    if (rightHeld && !leftHeld) {
      dasRight += dt;
      if (dasRight >= DAS) {
        arrRight += dt;
        if (arrRight >= ARR) {
          if (tryMove(1, 0)) soundMove();
          arrRight = 0;
        }
      }
    }
  }

  // ---------- input ----------
  document.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowLeft") {
      if (!leftHeld) { leftHeld = true; dasLeft = arrLeft = 0; if (tryMove(-1, 0)) soundMove(); draw(); }
      e.preventDefault();
    } else if (k === "ArrowRight") {
      if (!rightHeld) { rightHeld = true; dasRight = arrRight = 0; if (tryMove(1, 0)) soundMove(); draw(); }
      e.preventDefault();
    } else if (k === "ArrowDown") {
      if (!softDrop) { softDrop = true; dropTimer = 999999; }
      e.preventDefault();
    } else if (k === "ArrowUp" || k === "x" || k === "X") {
      if (state === "playing" && tryRotate(1)) { soundRotate(); draw(); }
      e.preventDefault();
    } else if (k === "z" || k === "Z") {
      if (state === "playing" && tryRotate(-1)) { soundRotate(); draw(); }
      e.preventDefault();
    } else if (k === "c" || k === "C") {
      doHold();
      e.preventDefault();
    } else if (k === " ") {
      if (state === "playing") hardDrop();
      e.preventDefault();
    }
  });

  document.addEventListener("keyup", function (e) {
    var k = e.key;
    if (k === "ArrowLeft") { leftHeld = false; dasLeft = arrLeft = 0; }
    if (k === "ArrowRight") { rightHeld = false; dasRight = arrRight = 0; }
    if (k === "ArrowDown") softDrop = false;
  });

  // touch controls
  document.querySelectorAll("#touch button").forEach(function (btn) {
    var act = btn.getAttribute("data-act");
    function fire(e) {
      e.preventDefault();
      if (act === "left") { if (tryMove(-1, 0)) soundMove(); draw(); }
      else if (act === "right") { if (tryMove(1, 0)) soundMove(); draw(); }
      else if (act === "rotL") { if (tryRotate(-1)) soundRotate(); draw(); }
      else if (act === "rotR") { if (tryRotate(1)) soundRotate(); draw(); }
      else if (act === "down") softDrop = true;
      else if (act === "drop") hardDrop();
      else if (act === "hold") doHold();
    }
    btn.addEventListener("touchstart", fire, { passive: false });
    btn.addEventListener("mousedown", fire);
  });
  document.querySelectorAll("#touch button[data-act=down]").forEach(function (btn) {
    btn.addEventListener("touchend", function () { softDrop = false; });
    btn.addEventListener("mouseup", function () { softDrop = false; });
  });

  // pause music when tab hidden
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopMusic();
    else if (state === "playing" || state === "busy") playMusic();
  });

  // fit to window
  function fit() {
    if (!stage) return;
    var scale = Math.min(1, (window.innerWidth - 12) / (boardCanvas.clientWidth + 30));
    stage.style.transform = "scale(" + scale + ")";
  }
  window.addEventListener("resize", fit);
  fit();

  startBtn.addEventListener("click", startGame);
  if (musicBtn) {
    musicBtn.addEventListener("click", cycleTrack);
    updateMusicBtn();
  }
  if (crtBtn) {
    if (!crt) {
      crtBtn.textContent = "CRT: UNAVAILABLE";
      crtBtn.disabled = true;
    } else {
      var updateCrtBtn = function () {
        crtBtn.textContent = "FILTER: " + CRT_LABEL[crtMode];
      };
      updateCrtBtn();
      crtBtn.addEventListener("click", function (e) {
        e.preventDefault();
        crtMode = CRT_MODES[(CRT_MODES.indexOf(crtMode) + 1) % CRT_MODES.length];
        try { localStorage.setItem("tukotako.crt", crtMode); } catch (err) {}
        updateCrtBtn();
        draw();
      });
    }
  }

  // boot
  emptyBoard();
  refillQueue();
  draw();
})();