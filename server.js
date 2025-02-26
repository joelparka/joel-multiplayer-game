const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public")); // index.html, client.js, sounds/bgm.mp3, sounds/dead.mp3, sounds/zone.mp3

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
var PLAYER_MAX_SPEED = 30; 
var PLAYER_ACCEL_TIME = 2;
var PLAYER_ACCEL = PLAYER_MAX_SPEED / (PLAYER_ACCEL_TIME * SERVER_FPS);
var TURN_DIFFICULTY = 0.2;
var FRICTION = 0.99;
var PLAYER_RADIUS = 20;
var NEEDLE_LENGTH = 40;
var BALLOON_OFFSET = PLAYER_RADIUS + 10;
var BALLOON_RADIUS = 20;

// NPC: 플레이어의 2배
var NPC_MAX_SPEED = PLAYER_MAX_SPEED * 2;
var NPC_ACCEL_TIME = 8;
var NPC_ACCEL = NPC_MAX_SPEED / (NPC_ACCEL_TIME * SERVER_FPS);

// 안전스폰
var SAFE_RADIUS = 200;

// 충돌
var BODY_RADIUS = 20;
var BODY_DIAMETER = 40;
var BOUNCE_FACTOR = 0.5;

// 특수 NPC 스폰 플래그 (각각 단 한 번만 생성)
var spawnedNarang = false;
var spawnedEolkimchi = false;
var spawnedGoryeosam = false;

// NPC 클래스 (기본 NPC) – type이 없으면 "normal"
function NPC(x, y) {
  this.x = x;
  this.y = y;
  this.vx = 0;
  this.vy = 0;
  this.alive = true;
  this.type = this.type || "normal";
}
NPC.prototype.update = function(targetX, targetY, accel, maxSpeed) {
  var desiredAngle = Math.atan2(targetY - this.y, targetX - this.x);
  this.vx += accel * Math.cos(desiredAngle);
  this.vy += accel * Math.sin(desiredAngle);
  this.vx *= FRICTION;
  this.vy *= FRICTION;
  var sp = Math.hypot(this.vx, this.vy);
  if(sp > maxSpeed) {
    var sc = maxSpeed / sp;
    this.vx *= sc;
    this.vy *= sc;
  }
  this.x += this.vx;
  this.y += this.vy;
  if(this.x < 0) this.x = 0;
  if(this.y < 0) this.y = 0;
  if(this.x > MAP_WIDTH) this.x = MAP_WIDTH;
  if(this.y > MAP_HEIGHT) this.y = MAP_HEIGHT;
};

var npcs = [];

// 안전 스폰 함수
function getSafeSpawn(npcs, players) {
  for(var attempt = 0; attempt < 100; attempt++) {
    var x = Math.random() * MAP_WIDTH;
    var y = Math.random() * MAP_HEIGHT;
    var valid = true;
    for(var i = 0; i < npcs.length; i++) {
      var npc = npcs[i];
      if(Math.hypot(npc.x - x, npc.y - y) < SAFE_RADIUS) { valid = false; break; }
    }
    if(valid) {
      for(var pid in players) {
        var p = players[pid];
        if(!p.alive || p.x === undefined) continue;
        if(Math.hypot(p.x - x, p.y - y) < SAFE_RADIUS) { valid = false; break; }
      }
    }
    if(valid) return { x: x, y: y };
  }
  return { x: Math.random() * MAP_WIDTH, y: Math.random() * MAP_HEIGHT };
}

// 충돌 보조 함수: 점과 선분 사이 거리
function pointLineDist(px, py, x1, y1, x2, y2) {
  var A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  var dot = A * C + B * D;
  var len2 = C * C + D * D;
  var param = dot / len2;
  if(param < 0) param = 0; else if(param > 1) param = 1;
  var xx = x1 + param * C, yy = y1 + param * D;
  return Math.hypot(px - xx, py - yy);
}

// 충돌 함수들에서, 플레이어가 무적이면 피해를 입지 않도록 처리
function arrowBalloonCollision() {
  var plist = Object.entries(players);
  for(var i = 0; i < plist.length; i++) {
    var A = plist[i][1];
    if(!A.alive) continue;
    var startX = A.x + PLAYER_RADIUS * Math.cos(A.angle);
    var startY = A.y + PLAYER_RADIUS * Math.sin(A.angle);
    var curNeedle = A.needleLength || NEEDLE_LENGTH;
    var endX = A.x + curNeedle * Math.cos(A.angle);
    var endY = A.y + curNeedle * Math.sin(A.angle);
    for(var j = 0; j < plist.length; j++) {
      if(i === j) continue;
      var B = plist[j][1];
      if(!B.alive || B.invincible) continue;
      var balloonX = B.x - BALLOON_OFFSET * Math.cos(B.angle);
      var balloonY = B.y - BALLOON_OFFSET * Math.sin(B.angle);
      var dist = pointLineDist(balloonX, balloonY, startX, startY, endX, endY);
      if(dist < BALLOON_RADIUS) {
        B.alive = false;
        B.explosion = true;
      }
    }
  }
}

function bodyCollisionPlayers() {
  var plist = Object.entries(players);
  for(var i = 0; i < plist.length; i++) {
    var A = plist[i][1];
    if(!A.alive || A.invincible) continue;
    for(var j = i + 1; j < plist.length; j++) {
      var B = plist[j][1];
      if(!B.alive || B.invincible) continue;
      var dx = B.x - A.x, dy = B.y - A.y;
      var dist = Math.hypot(dx, dy);
      if(dist < BODY_DIAMETER) {
        var overlap = (BODY_DIAMETER - dist) * 0.5;
        var nx = dx / dist, ny = dy / dist;
        if(dist === 0) { nx = 1; ny = 0; }
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

function npcCollision() {
  var npcRad = 20;
  for(var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if(!npc.alive) continue;
    if(npc.type === "narang") continue;
    for(var pid in players) {
      var p = players[pid];
      if(!p.alive || p.invincible) continue;
      if(Math.hypot(npc.x - p.x, npc.y - p.y) < npcRad + PLAYER_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

function specialNPCCollision() {
  for(var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if(!npc.alive || npc.type !== "narang") continue;
    for(var pid in players) {
      var p = players[pid];
      if(!p.alive || p.invincible) continue;
      var curNeedle = p.needleLength || NEEDLE_LENGTH;
      var startX = p.x + PLAYER_RADIUS * Math.cos(p.angle);
      var startY = p.y + PLAYER_RADIUS * Math.sin(p.angle);
      var endX = p.x + curNeedle * Math.cos(p.angle);
      var endY = p.y + curNeedle * Math.sin(p.angle);
      var dist = pointLineDist(npc.x, npc.y, startX, startY, endX, endY);
      if(dist < 30) {
        npc.alive = false;
        p.needleLength = curNeedle * 4;
        p.needleBonus = true;
        io.emit("gameMessage", { text: "나랑드의 현신이 등장했습니다. 처치하면 캐릭터가 강화됩니다.", duration: 0 });
        break;
      }
    }
  }
}

function eolkimchiNeedleCollision() {
  for(var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if(!npc.alive || npc.type !== "eolkimchi") continue;
    var needleLength = 100;
    var startX = npc.x, startY = npc.y;
    var endX = npc.x + needleLength * Math.cos(npc.needleAngle);
    var endY = npc.y + needleLength * Math.sin(npc.needleAngle);
    for(var pid in players) {
      var p = players[pid];
      if(!p.alive || p.invincible) continue;
      var balloonX = p.x - BALLOON_OFFSET * Math.cos(p.angle);
      var balloonY = p.y - BALLOON_OFFSET * Math.sin(p.angle);
      var dist = pointLineDist(balloonX, balloonY, startX, startY, endX, endY);
      if(dist < BALLOON_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

function goryeosamCollision() {
  for(var i = 0; i < npcs.length; i++) {
    var npc = npcs[i];
    if(!npc.alive || npc.type !== "goryeosam") continue;
    for(var pid in players) {
      var p = players[pid];
      if(!p.alive || p.invincible) continue;
      if(Math.hypot(npc.x - p.x, npc.y - p.y) < npc.size + PLAYER_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

// 소켓 연결 및 대기방/게임 시작 처리
io.on("connection", function(socket) {
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
    score: 0,
    invincible: false,
    freezeTimer: 0,
    invincibilityUsed: false
  };

  socket.on("setPlayerInfo", function(data) {
    var p = players[socket.id];
    if(p) {
      p.nickname = data.nickname;
      p.color = data.color;
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("setWinnerCount", function(num) {
    var wCount = parseInt(num);
    if(!isNaN(wCount) && wCount >= 1) {
      winnerCount = wCount;
      console.log("승자의 수 설정: " + winnerCount);
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("setReady", function(rdy) {
    var p = players[socket.id];
    if(p) p.ready = rdy;
    io.emit("lobbyUpdate", players);
  });

  // 무적 스킬 (키보드 1) – 대기방에서는 무시
  socket.on("activateInvincibility", function() {
    var p = players[socket.id];
    if(p && !p.invincibilityUsed && gameRunning) {
      p.invincibilityUsed = true;
      p.invincible = true;
      p.freezeTimer = 3 * SERVER_FPS;
      io.emit("zoneSound");
    }
  });

  // START 버튼 클릭 (대기방)
  socket.on("startGame", function() {
    var allReady = true;
    for(var pid in players) {
      if(!players[pid].ready) { allReady = false; break; }
    }
    if(allReady && !gameRunning) {
      gameRunning = true;
      npcs = [];
      spawnedNarang = false;
      spawnedEolkimchi = false;
      spawnedGoryeosam = false;
      // 일반 NPC 2마리 생성 (npc.index 1,2) – 충돌 대상으로
      for(var i = 0; i < 2; i++) {
        var spn = getSafeSpawn(npcs, players);
        var npc = new NPC(spn.x, spn.y);
        npc.index = i + 1;
        npc.type = "normal";
        npcs.push(npc);
      }
      // 플레이어 리스폰 (닉네임/색상 그대로 유지)
      for(var pid2 in players) {
        var pl = players[pid2];
        pl.alive = true;
        pl.explosion = false;
        pl.vx = 0;
        pl.vy = 0;
        pl.needleLength = NEEDLE_LENGTH;
        pl.needleBonus = false;
        pl.score = 0;
        pl.invincible = false;
        pl.freezeTimer = 0;
        // invincibilityUsed는 유지 (한 게임당 1번)
        var s = getSafeSpawn(npcs, players);
        pl.x = s.x;
        pl.y = s.y;
      }
      io.emit("gameStart");
      console.log("모든 플레이어 준비 완료. 게임 시작! (승자수:" + winnerCount + ")");
      
      // 타이머 설정
      // [1] 나랑드의 현신: 게임 시작 후 30초에 메시지, 그 후 30초 후(총 60초 후)에 등장
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후에 나랑드의 현신이 등장합니다...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          if(!spawnedNarang) {
            var spn = getSafeSpawn(npcs, players);
            var narang = new NPC(spn.x, spn.y);
            narang.type = "narang";
            narang.vx = 0;
            narang.vy = 0;
            narang.size = 40; // 40x40 크기
            npcs.push(narang);
            spawnedNarang = true;
            io.emit("gameMessage", { text: "나랑드의 현신이 등장했습니다. 처치하면 캐릭터가 강화됩니다.", duration: 0 });
          }
        }, 30000);
      }, 30000);

      // [2] 얼김치 NPC: 게임 시작 후 120초에 메시지, 그 후 30초 후(총 150초, 2분 30초 후)에 등장
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후에 얼김치의 얼이 울부짖습니다...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          if(!spawnedEolkimchi) {
            var eolkimchi = new NPC(MAP_WIDTH / 2, MAP_HEIGHT / 2);
            eolkimchi.type = "eolkimchi";
            eolkimchi.needleAngle = 0;
            eolkimchi.vx = 0;
            eolkimchi.vy = 0;
            npcs.push(eolkimchi);
            spawnedEolkimchi = true;
            io.emit("gameMessage", { text: "얼김치가 포효합니다. 좆됐군요.. 도망치세요...", duration: 5 });
          }
        }, 30000);
      }, 120000);

      // [3] 한국고려삼 NPC: 게임 시작 후 210초에 메시지, 그 후 30초 후(총 240초, 4분 후)에 등장
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후 한국고려삼이 등장합니다.. 결판을 내세요...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          if(!spawnedGoryeosam) {
            var goryeosam = {
              x: MAP_WIDTH / 2,
              y: MAP_HEIGHT / 2,
              alive: true,
              type: "goryeosam",
              size: 20,
              growthCountdown: 10 * SERVER_FPS
            };
            npcs.push(goryeosam);
            spawnedGoryeosam = true;
            io.emit("gameMessage", { text: "10초 후 브랜드가 2배 커집니다.", countdown: 10, color: "red", position: "top" });
          }
        }, 30000);
      }, 210000);
    } else {
      let pname = players[socket.id].nickname;
      io.emit("gameMessage", { text: pname + " 님이 레디를 안박으셔서 시간을 낭비하고있습니다.", duration: 5 });
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("playerMove", function(data) {
    var p = players[socket.id];
    if(!p || !p.alive || !gameRunning) return;
    var curSpeed = Math.hypot(p.vx, p.vy);
    var speedFactor = 1.0 - (curSpeed / PLAYER_MAX_SPEED) * TURN_DIFFICULTY;
    if(speedFactor < 0) speedFactor = 0;
    if(data.mouseDown) {
      p.vx += PLAYER_ACCEL * Math.cos(data.angle) * speedFactor;
      p.vy += PLAYER_ACCEL * Math.sin(data.angle) * speedFactor;
    }
    p.angle = data.angle;
  });

  socket.on("disconnect", function() {
    console.log("플레이어 나감:" + socket.id);
    delete players[socket.id];
    io.emit("lobbyUpdate", players);
  });
});

// 메인 게임 루프
function updateGame() {
  try {
    if(!gameRunning) return;
    for(var pid in players) {
      var p = players[pid];
      if(p.alive) p.score = (p.score || 0) + 1;
    }
    var ranking = Object.values(players).filter(p => p.alive).sort((a, b) => b.score - a.score);
    for(var pid in players) {
      var p = players[pid];
      if(!p.alive) continue;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      var spd = Math.hypot(p.vx, p.vy);
      if(spd > PLAYER_MAX_SPEED) {
        var sc = PLAYER_MAX_SPEED / spd;
        p.vx *= sc;
        p.vy *= sc;
      }
      p.x += p.vx;
      p.y += p.vy;
      if(p.x < 0) p.x = 0;
      if(p.y < 0) p.y = 0;
      if(p.x > MAP_WIDTH) p.x = MAP_WIDTH;
      if(p.y > MAP_HEIGHT) p.y = MAP_HEIGHT;
      // 무적 스킬: 3초 동안 이동 정지 및 충돌 무시
      if(p.invincible && p.freezeTimer > 0) {
        p.vx = 0;
        p.vy = 0;
        p.freezeTimer--;
        if(p.freezeTimer <= 0) {
          p.invincible = false;
        }
      }
    }
    for(var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      if(!n.alive) continue;
      if(n.type === "narang") {
        if(n.x < 100 || n.x > MAP_WIDTH - 100 || n.y < 100 || n.y > MAP_HEIGHT - 100) {
          if(ranking.length > 0) {
            var target = ranking[ranking.length - 1];
            var d = Math.hypot(n.x - target.x, n.y - target.y);
            if(d > 300) {
              var desiredAngle = Math.atan2(target.y - n.y, target.x - n.x);
              var dashSpeed = PLAYER_MAX_SPEED * 2.5;
              var dashAccel = dashSpeed / SERVER_FPS;
              n.vx += dashAccel * Math.cos(desiredAngle);
              n.vy += dashAccel * Math.sin(desiredAngle);
            } else {
              var desiredAngle = Math.atan2(n.y - target.y, n.x - target.x);
              var specialSpeed = PLAYER_MAX_SPEED * 2;
              var specialAccel = specialSpeed / (2 * SERVER_FPS);
              n.vx += specialAccel * Math.cos(desiredAngle);
              n.vy += specialAccel * Math.sin(desiredAngle);
            }
          }
        } else {
          var closest = null;
          var minD = Infinity;
          for(var pid in players) {
            var pl = players[pid];
            if(!pl.alive) continue;
            var d = Math.hypot(pl.x - n.x, pl.y - n.y);
            if(d < minD) { minD = d; closest = pl; }
          }
          if(closest) {
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
        if(sp > PLAYER_MAX_SPEED * 2) {
          var sc = (PLAYER_MAX_SPEED * 2) / sp;
          n.vx *= sc;
          n.vy *= sc;
        }
        n.x += n.vx;
        n.y += n.vy;
        if(n.x < 0) n.x = 0;
        if(n.y < 0) n.y = 0;
        if(n.x > MAP_WIDTH) n.x = MAP_WIDTH;
        if(n.y > MAP_HEIGHT) n.y = MAP_HEIGHT;
      }
      else if(n.type === "eolkimchi") {
        var closest = null;
        var minD = Infinity;
        for(var pid in players) {
          var pl = players[pid];
          if(!pl.alive) continue;
          var d = Math.hypot(pl.x - n.x, pl.y - n.y);
          if(d < minD) { minD = d; closest = pl; }
        }
        if(closest) {
          var desiredAngle = Math.atan2(closest.y - n.y, closest.x - n.x);
          var accel = PLAYER_MAX_SPEED / (PLAYER_ACCEL_TIME * SERVER_FPS);
          n.vx += accel * Math.cos(desiredAngle);
          n.vy += accel * Math.sin(desiredAngle);
        }
        n.vx *= FRICTION;
        n.vy *= FRICTION;
        var sp = Math.hypot(n.vx, n.vy);
        if(sp > PLAYER_MAX_SPEED) {
          var sc = PLAYER_MAX_SPEED / sp;
          n.vx *= sc;
          n.vy *= sc;
        }
        n.x += n.vx;
        n.y += n.vy;
        if(n.x < 0) n.x = 0;
        if(n.y < 0) n.y = 0;
        if(n.x > MAP_WIDTH) n.x = MAP_WIDTH;
        if(n.y > MAP_HEIGHT) n.y = MAP_HEIGHT;
        if(n.needleAngle === undefined) n.needleAngle = 0;
        n.needleAngle += Math.PI / 30;
      }
      else if(n.type === "goryeosam") {
        n.growthCountdown--;
        if(n.growthCountdown <= 0) {
          n.size *= 2;
          n.growthCountdown = 10 * SERVER_FPS;
        }
      }
      else if(n.type === "normal") {
        if(ranking.length > 0) {
          var target = (n.index === 1) ? ranking[0] : (ranking[1] || ranking[0]);
          if(target) n.update(target.x, target.y, NPC_ACCEL, NPC_MAX_SPEED);
        }
      }
      else {
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
  } catch(e) {
    console.error("updateGame 에러:", e);
  }
}

function checkGameOver() {
  var arr = Object.values(players);
  var alive = [];
  for(var i = 0; i < arr.length; i++) {
    if(arr[i].alive) alive.push(arr[i]);
  }
  if(alive.length <= 0 && gameRunning) {
    gameRunning = false;
    io.emit("gameOver", { winner: null });
    console.log("무승부(아무도 안남음)");
    npcs = [];
    for(var pid in players) {
      players[pid].ready = false;
      players[pid].invincibilityUsed = false;
    }
    return;
  }
  if(alive.length <= winnerCount && gameRunning) {
    gameRunning = false;
    if(alive.length > 0) {
      var names = [];
      for(var x = 0; x < alive.length; x++) {
        names.push(alive[x].nickname);
      }
      var winnerNames = names.join(", ");
      io.emit("gameOver", { winner: winnerNames });
      console.log("승자들: " + winnerNames);
    } else {
      io.emit("gameOver", { winner: null });
      console.log("무승부(승자 없음)");
    }
    npcs = [];
    for(var pid in players) {
      players[pid].ready = false;
      players[pid].invincibilityUsed = false;
    }
  }
}

setInterval(updateGame, 1000 / SERVER_FPS);

var PORT = 3000;
server.listen(PORT, function() {
  console.log("서버 실행 중: http://localhost:" + PORT);
});
