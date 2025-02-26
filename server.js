const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public")); // index.html, client.js, bgm.mp3, dead.mp3

// ----------------------
// Global
// ----------------------
var players = {};
var gameRunning = false;

var MAP_WIDTH = 16000;
var MAP_HEIGHT = 16000;

var SERVER_FPS = 30;

// 승자의 수
var winnerCount = 1; // 기본값

// 플레이어
var PLAYER_MAX_SPEED = 30; // 2초만에 0->30
var PLAYER_ACCEL_TIME = 2;
var PLAYER_ACCEL = PLAYER_MAX_SPEED / (PLAYER_ACCEL_TIME * SERVER_FPS);
var TURN_DIFFICULTY = 0.2;
var FRICTION = 0.99;
var PLAYER_RADIUS = 20;
var NEEDLE_LENGTH = 40;
var BALLOON_OFFSET = PLAYER_RADIUS + 10;
var BALLOON_RADIUS = 20;

// NPC: 플레이어의 2배 => 60
var NPC_MAX_SPEED = PLAYER_MAX_SPEED * 2; // 60
var NPC_ACCEL_TIME = 8;
var NPC_ACCEL = NPC_MAX_SPEED / (NPC_ACCEL_TIME * SERVER_FPS);

// 안전스폰
var SAFE_RADIUS = 200;

// 충돌
var BODY_RADIUS = 20;
var BODY_DIAMETER = 40;
var BOUNCE_FACTOR = 0.5;

// NPC 클래스 (기본 NPC)
function NPC(x, y) {
  this.x = x;
  this.y = y;
  this.vx = 0;
  this.vy = 0;
  this.alive = true;
  // type이 없으면 일반 NPC("normal")로 간주
  this.type = this.type || "normal";
}
NPC.prototype.update = function (targetX, targetY, accel, maxSpeed) {
  var desiredAngle = Math.atan2(targetY - this.y, targetX - this.x);
  this.vx += accel * Math.cos(desiredAngle);
  this.vy += accel * Math.sin(desiredAngle);
  this.vx *= FRICTION;
  this.vy *= FRICTION;
  var sp = Math.hypot(this.vx, this.vy);
  if (sp > maxSpeed) {
    var sc = maxSpeed / sp;
    this.vx *= sc;
    this.vy *= sc;
  }
  this.x += this.vx;
  this.y += this.vy;
  if (this.x < 0) this.x = 0;
  if (this.y < 0) this.y = 0;
  if (this.x > MAP_WIDTH) this.x = MAP_WIDTH;
  if (this.y > MAP_HEIGHT) this.y = MAP_HEIGHT;
};

var npcs = [];

// 안전 스폰
function getSafeSpawn(npcs, players) {
  for (var attempt = 0; attempt < 100; attempt++) {
    var x = Math.random() * MAP_WIDTH;
    var y = Math.random() * MAP_HEIGHT;
    var valid = true;
    // NPC
    for (var i = 0; i < npcs.length; i++) {
      var npc = npcs[i];
      var dist = Math.hypot(npc.x - x, npc.y - y);
      if (dist < SAFE_RADIUS) {
        valid = false;
        break;
      }
    }
    // players
    if (valid) {
      for (var pid in players) {
        var p = players[pid];
        if (!p.alive) continue;
        if (p.x === undefined) continue;
        var dd = Math.hypot(p.x - x, p.y - y);
        if (dd < SAFE_RADIUS) {
          valid = false;
          break;
        }
      }
    }
    if (valid) {
      return { x: x, y: y };
    }
  }
  return { x: Math.random() * MAP_WIDTH, y: Math.random() * MAP_HEIGHT };
}

// 충돌 보조 함수: 점과 선분 사이의 거리
function pointLineDist(px, py, x1, y1, x2, y2) {
  var A = px - x1;
  var B = py - y1;
  var C = x2 - x1;
  var D = y2 - y1;
  var dot = A * C + B * D;
  var len2 = C * C + D * D;
  var param = dot / len2;
  if (param < 0) param = 0;
  else if (param > 1) param = 1;
  var xx = x1 + param * C;
  var yy = y1 + param * D;
  var dx = px - xx;
  var dy = py - yy;
  return Math.hypot(dx, dy);
}

// 플레이어 needle와 다른 플레이어 풍선 충돌 (기존)
function arrowBalloonCollision() {
  var plist = Object.entries(players);
  for (var i = 0; i < plist.length; i++) {
    var A = plist[i][1];
    if (!A.alive) continue;
    var startX = A.x + PLAYER_RADIUS * Math.cos(A.angle);
    var startY = A.y + PLAYER_RADIUS * Math.sin(A.angle);
    var curNeedle = A.needleLength || NEEDLE_LENGTH;
    var endX = A.x + curNeedle * Math.cos(A.angle);
    var endY = A.y + curNeedle * Math.sin(A.angle);

    for (var j = 0; j < plist.length; j++) {
      if (i === j) continue;
      var B = plist[j][1];
      if (!B.alive) continue;
      var balloonX = B.x - BALLOON_OFFSET * Math.cos(B.angle);
      var balloonY = B.y - BALLOON_OFFSET * Math.sin(B.angle);

      var dist = pointLineDist(balloonX, balloonY, startX, startY, endX, endY);
      if (dist < BALLOON_RADIUS) {
        B.alive = false;
        B.explosion = true;
      }
    }
  }
}

// 플레이어끼리 몸통 충돌
function bodyCollisionPlayers() {
  var plist = Object.entries(players);
  for (var i = 0; i < plist.length; i++) {
    var A = plist[i][1];
    if (!A.alive) continue;
    for (var j = i + 1; j < plist.length; j++) {
      var B = plist[j][1];
      if (!B.alive) continue;
      var dx = B.x - A.x;
      var dy = B.y - A.y;
      var dist = Math.hypot(dx, dy);
      if (dist < BODY_DIAMETER) {
        var overlap = (BODY_DIAMETER - dist) * 0.5;
        var nx = dx / dist;
        var ny = dy / dist;
        if (dist === 0) {
          nx = 1;
          ny = 0;
        }
        A.x -= nx * overlap;
        A.y -= ny * overlap;
        B.x += nx * overlap;
        B.y += ny * overlap;
        A.vx *= BOUNCE_FACTOR;
        A.vy *= BOUNCE_FACTOR;
        B.vx *= BOUNCE_FACTOR;
        B.vy *= BOUNCE_FACTOR;
      }
    }
  }
}

// 일반 NPC와 플레이어 충돌 (플레이어 죽음)
function npcCollision() {
  var npcRad = 20;
  for (var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if (!npc.alive) continue;
    if (npc.type === "normal") {
      // 일반 NPC는 아래에서 따로 처리
      continue;
    }
    // 특수 NPC (나랑드, 얼김치, 한국고려삼)는 기존 충돌 처리
    for (var pid in players) {
      var p = players[pid];
      if (!p.alive) continue;
      var dist = Math.hypot(npc.x - p.x, npc.y - p.y);
      if (dist < npcRad + PLAYER_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

// 나랑드의 현신(Narang)과 플레이어 needle 충돌 처리
function specialNPCCollision() {
  for (var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if (!npc.alive || npc.type !== "narang") continue;
    // 각 플레이어의 needle 충돌 (충돌 임계값을 30으로 상향)
    for (var pid in players) {
      var p = players[pid];
      if (!p.alive) continue;
      var curNeedle = p.needleLength || NEEDLE_LENGTH;
      var startX = p.x + PLAYER_RADIUS * Math.cos(p.angle);
      var startY = p.y + PLAYER_RADIUS * Math.sin(p.angle);
      var endX = p.x + curNeedle * Math.cos(p.angle);
      var endY = p.y + curNeedle * Math.sin(p.angle);
      var dist = pointLineDist(npc.x, npc.y, startX, startY, endX, endY);
      if (dist < 30) {
        npc.alive = false;
        // 단 한 명에게만 보너스 적용
        p.needleLength = curNeedle * 2;
        p.needleBonus = true;
        io.emit("gameMessage", { text: p.nickname + "께서 나랑드의 현신을 처치해 4억원을 벌었습니다.." });
        break;
      }
    }
  }
}

// 얼김치 NPC의 회전하는 바늘과 플레이어 풍선 충돌 처리
function eolkimchiNeedleCollision() {
  for (var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if (!npc.alive || npc.type !== "eolkimchi") continue;
    var needleLength = 100;
    var startX = npc.x;
    var startY = npc.y;
    var endX = npc.x + needleLength * Math.cos(npc.needleAngle);
    var endY = npc.y + needleLength * Math.sin(npc.needleAngle);
    for (var pid in players) {
      var p = players[pid];
      if (!p.alive) continue;
      var balloonX = p.x - BALLOON_OFFSET * Math.cos(p.angle);
      var balloonY = p.y - BALLOON_OFFSET * Math.sin(p.angle);
      var dist = pointLineDist(balloonX, balloonY, startX, startY, endX, endY);
      if (dist < BALLOON_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

// 한국고려삼과 플레이어 충돌 처리
function goryeosamCollision() {
  for (var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if (!npc.alive || npc.type !== "goryeosam") continue;
    for (var pid in players) {
      var p = players[pid];
      if (!p.alive) continue;
      var d = Math.hypot(npc.x - p.x, npc.y - p.y);
      if (d < npc.size + PLAYER_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

// 소켓 연결
io.on("connection", function (socket) {
  console.log("플레이어 접속:" + socket.id);

  players[socket.id] = {
    nickname: "Guest",
    color: "#00AAFF",
    ready: false,
    x: 999999,
    y: 999999,
    vx: 0,
    vy: 0,
    angle: 0,
    alive: true,
    explosion: false,
    score: 0
  };

  socket.on("setPlayerInfo", function (data) {
    var p = players[socket.id];
    if (p) {
      p.nickname = data.nickname;
      p.color = data.color;
    }
    io.emit("lobbyUpdate", players);
  });

  // winnerCount 설정
  socket.on("setWinnerCount", function (num) {
    var wCount = parseInt(num);
    if (!isNaN(wCount) && wCount >= 1) {
      winnerCount = wCount;
      console.log("승자의 수 설정: " + winnerCount);
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("setReady", function (rdy) {
    var p = players[socket.id];
    if (p) p.ready = rdy;

    var allReady = true;
    for (var pid in players) {
      if (!players[pid].ready) {
        allReady = false;
        break;
      }
    }
    if (allReady && !gameRunning) {
      gameRunning = true;
      npcs = [];
      // 일반 NPC 2마리 생성 (각각 npc.index 1,2 지정)
      for (var i = 0; i < 2; i++) {
        var spn = getSafeSpawn(npcs, players);
        var npc = new NPC(spn.x, spn.y);
        npc.index = i + 1; // npc.index 1이면 1위, 2이면 2위 목표
        npc.type = "normal";
        npcs.push(npc);
      }
      // respawn players
      for (var pid2 in players) {
        var pl = players[pid2];
        pl.alive = true;
        pl.explosion = false;
        pl.vx = 0;
        pl.vy = 0;
        pl.needleLength = NEEDLE_LENGTH;
        pl.needleBonus = false;
        pl.score = 0;
        var s = getSafeSpawn(npcs, players);
        pl.x = s.x;
        pl.y = s.y;
      }
      io.emit("gameStart");
      console.log("모든 플레이어 준비 완료. 게임 시작! (승자수:" + winnerCount + ")");

      // ------------------------------
      // 게임 이벤트 타이머 (서버 측)
      // ------------------------------
      // [1] 2분 후 - 나랑드 현신 등장 카운트다운 (30초)
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후에 나랑드의 현신이 등장합니다...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          var spn = getSafeSpawn(npcs, players);
          var narang = new NPC(spn.x, spn.y);
          narang.type = "narang";
          narang.vx = 0;
          narang.vy = 0;
          npcs.push(narang);
          io.emit("gameMessage", { text: "나랑드의 현신이 등장했습니다. 처치하면 캐릭터가 강화됩니다.", duration: 5 });
        }, 30000);
      }, 120000);

      // [2] 4분 후 - 얼김치 등장 카운트다운 (30초)
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후에 얼김치의 얼이 울부짖습니다...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          var eolkimchi = new NPC(MAP_WIDTH / 2, MAP_HEIGHT / 2);
          eolkimchi.type = "eolkimchi";
          eolkimchi.needleAngle = 0;
          eolkimchi.vx = 0;
          eolkimchi.vy = 0;
          npcs.push(eolkimchi);
          io.emit("gameMessage", { text: "얼김치가 포효합니다. 좆됐군요.. 도망치세요...", duration: 5 });
        }, 30000);
      }, 240000);

      // [3] 6분 후 - 한국고려삼 등장 카운트다운 (100초)
      setTimeout(() => {
        io.emit("gameMessage", { text: "100초 후 한국고려삼이 등장합니다.. 결판을 내세요...", countdown: 100, color: "red", position: "top" });
        setTimeout(() => {
          var goryeosam = {
            x: MAP_WIDTH / 2,
            y: MAP_HEIGHT / 2,
            alive: true,
            type: "goryeosam",
            size: 20,
            growthCountdown: 10 * SERVER_FPS
          };
          npcs.push(goryeosam);
          io.emit("gameMessage", { text: "10초 후 브랜드가 2배 커집니다.", countdown: 10, color: "red", position: "top" });
        }, 100000);
      }, 360000);
    } else {
      io.emit("lobbyUpdate", players);
    }
  });

  socket.on("playerMove", function (data) {
    var p = players[socket.id];
    if (!p || !p.alive || !gameRunning) return;
    var curSpeed = Math.hypot(p.vx, p.vy);
    var speedFactor = 1.0 - (curSpeed / PLAYER_MAX_SPEED) * TURN_DIFFICULTY;
    if (speedFactor < 0) speedFactor = 0;

    if (data.mouseDown) {
      p.vx += PLAYER_ACCEL * Math.cos(data.angle) * speedFactor;
      p.vy += PLAYER_ACCEL * Math.sin(data.angle) * speedFactor;
    }
    p.angle = data.angle;
  });

  socket.on("disconnect", function () {
    console.log("플레이어 나감:" + socket.id);
    delete players[socket.id];
    io.emit("lobbyUpdate", players);
  });
});

// 메인 게임 루프
function updateGame() {
  if (!gameRunning) return;

  // 각 플레이어의 생존 점수 (누적)
  for (var pid in players) {
    var p = players[pid];
    if (p.alive) {
      p.score = (p.score || 0) + 1;
    }
  }
  // 살아있는 플레이어들을 점수 내림차순(1위부터)로 정렬
  var ranking = Object.values(players)
    .filter(p => p.alive)
    .sort((a, b) => b.score - a.score);

  // 플레이어 이동 처리
  for (var pid in players) {
    var p = players[pid];
    if (!p.alive) continue;
    p.vx *= FRICTION;
    p.vy *= FRICTION;
    var spd = Math.hypot(p.vx, p.vy);
    if (spd > PLAYER_MAX_SPEED) {
      var sc = PLAYER_MAX_SPEED / spd;
      p.vx *= sc;
      p.vy *= sc;
    }
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = 0;
    if (p.y < 0) p.y = 0;
    if (p.x > MAP_WIDTH) p.x = MAP_WIDTH;
    if (p.y > MAP_HEIGHT) p.y = MAP_HEIGHT;
  }

  // NPC 업데이트
  for (var i = 0; i < npcs.length; i++) {
    var n = npcs[i];
    if (!n.alive) continue;
    // 특수 NPC: 나랑드의 현신
    if (n.type === "narang") {
      // 만약 맵의 가장자리(100px 이내)에 도달하면
      if (n.x < 100 || n.x > MAP_WIDTH - 100 || n.y < 100 || n.y > MAP_HEIGHT - 100) {
        // "꼴찌" (가장 낮은 점수)의 플레이어를 목표로 설정
        if (ranking.length > 0) {
          var target = ranking[ranking.length - 1];
          var d = Math.hypot(n.x - target.x, n.y - target.y);
          if (d > 300) {
            // 충분히 멀면 돌진 (평소보다 강한 가속)
            var desiredAngle = Math.atan2(target.y - n.y, target.x - n.x);
            var dashSpeed = PLAYER_MAX_SPEED * 2.5;
            var dashAccel = dashSpeed / (1 * SERVER_FPS);
            n.vx += dashAccel * Math.cos(desiredAngle);
            n.vy += dashAccel * Math.sin(desiredAngle);
          } else {
            // 거리가 가까우면 다시 도망치듯 반대 방향으로
            var desiredAngle = Math.atan2(n.y - target.y, n.x - target.x);
            var specialSpeed = PLAYER_MAX_SPEED * 2;
            var specialAccel = specialSpeed / (2 * SERVER_FPS);
            n.vx += specialAccel * Math.cos(desiredAngle);
            n.vy += specialAccel * Math.sin(desiredAngle);
          }
        }
      } else {
        // 평소에는 가장 가까운 플레이어로부터 도망감
        var closest = null;
        var minD = Infinity;
        for (var pid in players) {
          var pl = players[pid];
          if (!pl.alive) continue;
          var d = Math.hypot(pl.x - n.x, pl.y - n.y);
          if (d < minD) {
            minD = d;
            closest = pl;
          }
        }
        if (closest) {
          var desiredAngle = Math.atan2(n.y - closest.y, n.x - closest.x);
          var specialSpeed = PLAYER_MAX_SPEED * 2;
          var specialAccel = specialSpeed / (2 * SERVER_FPS);
          n.vx += specialAccel * Math.cos(desiredAngle);
          n.vy += specialAccel * Math.sin(desiredAngle);
        }
      }
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      var sp = Math.hypot(n.vx, n.vy);
      if (sp > PLAYER_MAX_SPEED * 2) {
        var sc = (PLAYER_MAX_SPEED * 2) / sp;
        n.vx *= sc;
        n.vy *= sc;
      }
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0) n.x = 0;
      if (n.y < 0) n.y = 0;
      if (n.x > MAP_WIDTH) n.x = MAP_WIDTH;
      if (n.y > MAP_HEIGHT) n.y = MAP_HEIGHT;
    }
    // 특수 NPC: 얼김치
    else if (n.type === "eolkimchi") {
      var closest = null;
      var minD = Infinity;
      for (var pid in players) {
        var pl = players[pid];
        if (!pl.alive) continue;
        var d = Math.hypot(pl.x - n.x, pl.y - n.y);
        if (d < minD) {
          minD = d;
          closest = pl;
        }
      }
      if (closest) {
        var desiredAngle = Math.atan2(closest.y - n.y, closest.x - n.x);
        var accel = PLAYER_MAX_SPEED / (PLAYER_ACCEL_TIME * SERVER_FPS);
        n.vx += accel * Math.cos(desiredAngle);
        n.vy += accel * Math.sin(desiredAngle);
      }
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      var sp = Math.hypot(n.vx, n.vy);
      if (sp > PLAYER_MAX_SPEED) {
        var sc = PLAYER_MAX_SPEED / sp;
        n.vx *= sc;
        n.vy *= sc;
      }
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0) n.x = 0;
      if (n.y < 0) n.y = 0;
      if (n.x > MAP_WIDTH) n.x = MAP_WIDTH;
      if (n.y > MAP_HEIGHT) n.y = MAP_HEIGHT;
      if (n.needleAngle === undefined) n.needleAngle = 0;
      n.needleAngle += Math.PI / 30;
    }
    // 특수 NPC: 한국고려삼
    else if (n.type === "goryeosam") {
      n.growthCountdown--;
      if (n.growthCountdown <= 0) {
        n.size *= 2;
        n.growthCountdown = 10 * SERVER_FPS;
      }
      // 움직이지 않음
    }
    // 일반 NPC ("normal") – 두 NPC가 서로 다른 목표(1위, 2위)를 따라가도록
    else if (n.type === "normal") {
      var target = null;
      if (n.index === 1) {
        target = ranking[0];
      } else if (n.index === 2) {
        target = ranking[1] || ranking[0];
      }
      if (target) {
        n.update(target.x, target.y, NPC_ACCEL, NPC_MAX_SPEED);
      }
    } else {
      // 기본 업데이트 (없을 경우)
      n.update(n.x, n.y, NPC_ACCEL, NPC_MAX_SPEED);
    }
  }

  arrowBalloonCollision();
  bodyCollisionPlayers();
  npcCollision();
  specialNPCCollision();
  eolkimchiNeedleCollision();
  goryeosamCollision();
  checkGameOver();

  io.emit("gameState", {
    players: players,
    npcs: npcs,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT
  });
}

function checkGameOver() {
  var arr = Object.values(players);
  var alive = [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].alive) alive.push(arr[i]);
  }
  if (alive.length <= 0 && gameRunning) {
    gameRunning = false;
    io.emit("gameOver", { winner: null });
    console.log("무승부(아무도 안남음)");
    return;
  }
  if (alive.length <= winnerCount && gameRunning) {
    gameRunning = false;
    if (alive.length > 0) {
      var names = [];
      for (var x = 0; x < alive.length; x++) {
        names.push(alive[x].nickname);
      }
      var winnerNames = names.join(", ");
      io.emit("gameOver", { winner: winnerNames });
      console.log("승자들: " + winnerNames);
    } else {
      io.emit("gameOver", { winner: null });
      console.log("무승부(승자 없음)");
    }
  }
}

setInterval(updateGame, 1000 / SERVER_FPS);

var PORT = 3000;
server.listen(PORT, function () {
  console.log("서버 실행 중: http://localhost:" + PORT);
});
