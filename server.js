const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public")); // public 폴더 내 index.html, client.js, sounds 폴더 등

// ----------------------
// Global Variables
// ----------------------
var players = {};
var gameRunning = false;
var MAP_WIDTH = 16000;
var MAP_HEIGHT = 16000;
var SERVER_FPS = 30;
var winnerCount = 1;

// 플레이어 관련 상수
var PLAYER_MAX_SPEED = 30;
var PLAYER_ACCEL_TIME = 2;
var PLAYER_ACCEL = PLAYER_MAX_SPEED / (PLAYER_ACCEL_TIME * SERVER_FPS);
var TURN_DIFFICULTY = 0.2;
var FRICTION = 0.99;
var PLAYER_RADIUS = 20;
var NEEDLE_LENGTH = 40;
var BALLOON_OFFSET = PLAYER_RADIUS + 10;
var BALLOON_RADIUS = 20;

// NPC 관련 상수
var NPC_MAX_SPEED = PLAYER_MAX_SPEED * 2;
var NPC_ACCEL_TIME = 8;
var NPC_ACCEL = NPC_MAX_SPEED / (NPC_ACCEL_TIME * SERVER_FPS);

// 안전 스폰 반경
var SAFE_RADIUS = 200;

// 충돌 상수
var BODY_DIAMETER = 40;
var BOUNCE_FACTOR = 0.5;

// 특수 NPC 스폰 플래그 (각각 단 한 번만 생성)
var spawnedNarang = false;   // 나랑드의 현신
var spawnedEolkimchi = false; // 얼김치
var spawnedGoryeosam = false; // 한국고려삼

// ----------------------
// Helper Functions
// ----------------------

// NPC 클래스 (type 없으면 "normal")
function NPC(x, y) {
  this.x = x;
  this.y = y;
  this.vx = 0;
  this.vy = 0;
  this.alive = true;
  this.type = this.type || "normal"; // "narang", "eolkimchi", "goryeosam", "normal"
}
NPC.prototype.update = function(targetX, targetY, accel, maxSpeed) {
  let angle = Math.atan2(targetY - this.y, targetX - this.x);
  this.vx += accel * Math.cos(angle);
  this.vy += accel * Math.sin(angle);
  this.vx *= FRICTION;
  this.vy *= FRICTION;
  let sp = Math.hypot(this.vx, this.vy);
  if(sp > maxSpeed) {
    let sc = maxSpeed / sp;
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

function getSafeSpawn(npcs, players) {
  for(let attempt = 0; attempt < 100; attempt++) {
    let x = Math.random() * MAP_WIDTH;
    let y = Math.random() * MAP_HEIGHT;
    let valid = true;
    for(let i = 0; i < npcs.length; i++) {
      let npc = npcs[i];
      if(Math.hypot(npc.x - x, npc.y - y) < SAFE_RADIUS) { valid = false; break; }
    }
    if(valid) {
      for(let pid in players) {
        let p = players[pid];
        if(!p.alive || p.x === undefined) continue;
        if(Math.hypot(p.x - x, p.y - y) < SAFE_RADIUS) { valid = false; break; }
      }
    }
    if(valid) return { x: x, y: y };
  }
  return { x: Math.random() * MAP_WIDTH, y: Math.random() * MAP_HEIGHT };
}

function pointLineDist(px, py, x1, y1, x2, y2) {
  let A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  let dot = A * C + B * D;
  let len2 = C * C + D * D;
  let param = dot / len2;
  if(param < 0) param = 0;
  else if(param > 1) param = 1;
  let xx = x1 + param * C, yy = y1 + param * D;
  return Math.hypot(px - xx, py - yy);
}

// ----------------------
// Collision Functions (무적 상태 고려)
// ----------------------
function arrowBalloonCollision() {
  let plist = Object.entries(players);
  for(let i = 0; i < plist.length; i++) {
    let A = plist[i][1];
    if(!A.alive) continue;
    let startX = A.x + PLAYER_RADIUS * Math.cos(A.angle);
    let startY = A.y + PLAYER_RADIUS * Math.sin(A.angle);
    let curNeedle = A.needleLength || NEEDLE_LENGTH;
    let endX = A.x + curNeedle * Math.cos(A.angle);
    let endY = A.y + curNeedle * Math.sin(A.angle);
    for(let j = 0; j < plist.length; j++) {
      if(i === j) continue;
      let B = plist[j][1];
      if(!B.alive || B.invincible) continue;
      let balloonX = B.x - BALLOON_OFFSET * Math.cos(B.angle);
      let balloonY = B.y - BALLOON_OFFSET * Math.sin(B.angle);
      let dist = pointLineDist(balloonX, balloonY, startX, startY, endX, endY);
      if(dist < BALLOON_RADIUS) {
        B.alive = false;
        B.explosion = true;
      }
    }
  }
}

function bodyCollisionPlayers() {
  let plist = Object.entries(players);
  for(let i = 0; i < plist.length; i++) {
    let A = plist[i][1];
    if(!A.alive || A.invincible) continue;
    for(let j = i + 1; j < plist.length; j++) {
      let B = plist[j][1];
      if(!B.alive || B.invincible) continue;
      let dx = B.x - A.x, dy = B.y - A.y;
      let dist = Math.hypot(dx, dy);
      if(dist < BODY_DIAMETER) {
        let overlap = (BODY_DIAMETER - dist) * 0.5;
        let nx = dx / dist, ny = dy / dist;
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
  let npcRad = 20;
  for(let i = 0; i < npcs.length; i++) {
    let npc = npcs[i];
    if(!npc.alive) continue;
    // 나랑드의 현신(Narang)은 일반 충돌 검사에서 제외!
    if(npc.type === "narang") continue;
    for(let pid in players) {
      let p = players[pid];
      if(!p.alive || p.invincible) continue;
      if(Math.hypot(npc.x - p.x, npc.y - p.y) < npcRad + PLAYER_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

function specialNPCCollision() {
  for(let i = 0; i < npcs.length; i++) {
    let npc = npcs[i];
    if(!npc.alive || npc.type !== "narang") continue;
    for(let pid in players) {
      let p = players[pid];
      if(!p.alive || p.invincible) continue;
      let curNeedle = p.needleLength || NEEDLE_LENGTH;
      let startX = p.x + PLAYER_RADIUS * Math.cos(p.angle);
      let startY = p.y + PLAYER_RADIUS * Math.sin(p.angle);
      let endX = p.x + curNeedle * Math.cos(p.angle);
      let endY = p.y + curNeedle * Math.sin(p.angle);
      let dist = pointLineDist(npc.x, npc.y, startX, startY, endX, endY);
      if(dist < 30) {
        npc.alive = false;
        p.needleLength = curNeedle * 4;
        p.needleBonus = true;
        // 메시지는 NPC 등장 시 바로 송출됨 (모든 플레이어에게)
        io.emit("gameMessage", { text: "나랑드의 현신이 등장했습니다. 처치하면 캐릭터가 강화됩니다.", duration: 0 });
        break;
      }
    }
  }
}

function eolkimchiNeedleCollision() {
  for(let i = 0; i < npcs.length; i++) {
    let npc = npcs[i];
    if(!npc.alive || npc.type !== "eolkimchi") continue;
    let needleLength = 100;
    let startX = npc.x, startY = npc.y;
    let endX = npc.x + needleLength * Math.cos(npc.needleAngle);
    let endY = npc.y + needleLength * Math.sin(npc.needleAngle);
    for(let pid in players) {
      let p = players[pid];
      if(!p.alive || p.invincible) continue;
      let balloonX = p.x - BALLOON_OFFSET * Math.cos(p.angle);
      let balloonY = p.y - BALLOON_OFFSET * Math.sin(p.angle);
      let dist = pointLineDist(balloonX, balloonY, startX, startY, endX, endY);
      if(dist < BALLOON_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

function goryeosamCollision() {
  for(let i = 0; i < npcs.length; i++) {
    let npc = npcs[i];
    if(!npc.alive || npc.type !== "goryeosam") continue;
    for(let pid in players) {
      let p = players[pid];
      if(!p.alive || p.invincible) continue;
      if(Math.hypot(npc.x - p.x, npc.y - p.y) < npc.size + PLAYER_RADIUS) {
        p.alive = false;
        p.explosion = true;
      }
    }
  }
}

// ----------------------
// Socket.io Events
// ----------------------
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
    let p = players[socket.id];
    if(p) {
      p.nickname = data.nickname;
      p.color = data.color;
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("setWinnerCount", function(num) {
    let wCount = parseInt(num);
    if(!isNaN(wCount) && wCount >= 1) {
      winnerCount = wCount;
      console.log("승자의 수 설정: " + winnerCount);
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("setReady", function(rdy) {
    let p = players[socket.id];
    if(p) p.ready = rdy;
    io.emit("lobbyUpdate", players);
  });

  // 무적 스킬 (키보드 1) – 게임 중에만
  socket.on("activateInvincibility", function() {
    let p = players[socket.id];
    if(p && !p.invincibilityUsed && gameRunning) {
      p.invincibilityUsed = true;
      p.invincible = true;
      p.freezeTimer = 3 * SERVER_FPS;
      io.emit("zoneSound");
    }
  });

  socket.on("playerMove", function(data) {
    let p = players[socket.id];
    if(!p || !p.alive || !gameRunning) return;
    let curSpeed = Math.hypot(p.vx, p.vy);
    let speedFactor = 1.0 - (curSpeed / PLAYER_MAX_SPEED) * TURN_DIFFICULTY;
    if(speedFactor < 0) speedFactor = 0;
    if(data.mouseDown) {
      p.vx += PLAYER_ACCEL * Math.cos(data.angle) * speedFactor;
      p.vy += PLAYER_ACCEL * Math.sin(data.angle) * speedFactor;
    }
    p.angle = data.angle;
  });

  socket.on("startGame", function() {
    let allReady = true;
    for(let pid in players) {
      if(!players[pid].ready) { allReady = false; break; }
    }
    if(allReady && !gameRunning) {
      gameRunning = true;
      npcs = [];
      spawnedNarang = false;
      spawnedEolkimchi = false;
      spawnedGoryeosam = false;
      // 일반 NPC 2마리 생성 (normal 타입; 충돌 대상으로)
      for(let i = 0; i < 2; i++) {
        let spn = getSafeSpawn(npcs, players);
        let npc = new NPC(spn.x, spn.y);
        npc.index = i + 1;
        npc.type = "normal";
        npcs.push(npc);
      }
      // 플레이어 리스폰 (닉네임/색상 그대로 유지)
      for(let pid in players) {
        let pl = players[pid];
        pl.alive = true;
        pl.explosion = false;
        pl.vx = 0;
        pl.vy = 0;
        pl.needleLength = NEEDLE_LENGTH;
        pl.needleBonus = false;
        pl.score = 0;
        pl.invincible = false;
        pl.freezeTimer = 0;
        let s = getSafeSpawn(npcs, players);
        pl.x = s.x;
        pl.y = s.y;
      }
      io.emit("gameStart");
      console.log("모든 플레이어 준비 완료. 게임 시작! (승자수:" + winnerCount + ")");
      
      // 타이머 설정
      // [1] 나랑드의 현신: 게임 시작 후 30초에 메시지, 그 후 30초 후 (총 60초 후) 등장
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후에 나랑드의 현신이 등장합니다...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          if(!spawnedNarang) {
            let spn = getSafeSpawn(npcs, players);
            let narang = new NPC(spn.x, spn.y);
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
      
      // [2] 얼김치 NPC: 게임 시작 후 120초에 메시지, 그 후 30초 후 (총 150초, 2분 30초 후) 등장
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후에 얼김치의 얼이 울부짖습니다...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          if(!spawnedEolkimchi) {
            let eolkimchi = new NPC(MAP_WIDTH/2, MAP_HEIGHT/2);
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
      
      // [3] 한국고려삼 NPC: 게임 시작 후 210초에 메시지, 그 후 30초 후 (총 240초, 4분 후) 등장
      setTimeout(() => {
        io.emit("gameMessage", { text: "30초 후 한국고려삼이 등장합니다.. 결판을 내세요...", countdown: 30, color: "red", position: "top" });
        setTimeout(() => {
          if(!spawnedGoryeosam) {
            let goryeosam = {
              x: MAP_WIDTH/2,
              y: MAP_HEIGHT/2,
              alive: true,
              type: "goryeosam",
              size: 200, // 초기 크기: 200 (플레이어의 10배)
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
    let p = players[socket.id];
    if(!p || !p.alive || !gameRunning) return;
    let curSpeed = Math.hypot(p.vx, p.vy);
    let speedFactor = 1.0 - (curSpeed / PLAYER_MAX_SPEED) * TURN_DIFFICULTY;
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

  // ----------------------
  // 초기화(reset) 이벤트: 대기실의 "초기화" 버튼을 누르면 전체 게임 상태를 초기화
  socket.on("resetGame", function() {
    gameRunning = false;
    npcs = [];
    spawnedNarang = false;
    spawnedEolkimchi = false;
    spawnedGoryeosam = false;
    for(let pid in players) {
      players[pid].ready = false;
      players[pid].invincibilityUsed = false;
      // 필요시 추가 초기화
    }
    io.emit("gameReset");
  });
});

setInterval(updateGame, 1000 / SERVER_FPS);

function updateGame() {
  try {
    if(!gameRunning) return;
    for(let pid in players) {
      let p = players[pid];
      if(p.alive) p.score = (p.score || 0) + 1;
    }
    let ranking = Object.values(players).filter(p => p.alive).sort((a, b) => b.score - a.score);
    for(let pid in players) {
      let p = players[pid];
      if(!p.alive) continue;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      let spd = Math.hypot(p.vx, p.vy);
      if(spd > PLAYER_MAX_SPEED) {
        let sc = PLAYER_MAX_SPEED / spd;
        p.vx *= sc;
        p.vy *= sc;
      }
      p.x += p.vx;
      p.y += p.vy;
      if(p.x < 0) p.x = 0;
      if(p.y < 0) p.y = 0;
      if(p.x > MAP_WIDTH) p.x = MAP_WIDTH;
      if(p.y > MAP_HEIGHT) p.y = MAP_HEIGHT;
      if(p.invincible && p.freezeTimer > 0) {
        p.vx = 0;
        p.vy = 0;
        p.freezeTimer--;
        if(p.freezeTimer <= 0) p.invincible = false;
      }
    }
    for(let i = 0; i < npcs.length; i++) {
      let n = npcs[i];
      if(!n.alive) continue;
      if(n.type === "narang") {
        if(n.x < 100 || n.x > MAP_WIDTH - 100 || n.y < 100 || n.y > MAP_HEIGHT - 100) {
          if(ranking.length > 0) {
            let target = ranking[ranking.length - 1];
            let d = Math.hypot(n.x - target.x, n.y - target.y);
            if(d > 300) {
              let desiredAngle = Math.atan2(target.y - n.y, target.x - n.x);
              let dashSpeed = PLAYER_MAX_SPEED * 2.5;
              let dashAccel = dashSpeed / SERVER_FPS;
              n.vx += dashAccel * Math.cos(desiredAngle);
              n.vy += dashAccel * Math.sin(desiredAngle);
            } else {
              let desiredAngle = Math.atan2(n.y - target.y, n.x - target.x);
              let specialSpeed = PLAYER_MAX_SPEED * 2;
              let specialAccel = specialSpeed / (2 * SERVER_FPS);
              n.vx += specialAccel * Math.cos(desiredAngle);
              n.vy += specialAccel * Math.sin(desiredAngle);
            }
          }
        } else {
          let closest = null;
          let minD = Infinity;
          for(let pid in players) {
            let pl = players[pid];
            if(!pl.alive) continue;
            let d = Math.hypot(pl.x - n.x, pl.y - n.y);
            if(d < minD) { minD = d; closest = pl; }
          }
          if(closest) {
            let desiredAngle = Math.atan2(n.y - closest.y, n.x - closest.x);
            let specialSpeed = PLAYER_MAX_SPEED * 2;
            let specialAccel = specialSpeed / (2 * SERVER_FPS);
            n.vx += specialAccel * Math.cos(desiredAngle);
            n.vy += specialAccel * Math.sin(desiredAngle);
          }
        }
        n.vx *= FRICTION;
        n.vy *= FRICTION;
        let sp = Math.hypot(n.vx, n.vy);
        if(sp > PLAYER_MAX_SPEED * 2) {
          let sc = (PLAYER_MAX_SPEED * 2) / sp;
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
        let closest = null;
        let minD = Infinity;
        for(let pid in players) {
          let pl = players[pid];
          if(!pl.alive) continue;
          let d = Math.hypot(pl.x - n.x, pl.y - n.y);
          if(d < minD) { minD = d; closest = pl; }
        }
        if(closest) {
          let desiredAngle = Math.atan2(closest.y - n.y, closest.x - n.x);
          let accel = PLAYER_MAX_SPEED / (PLAYER_ACCEL_TIME * SERVER_FPS);
          n.vx += accel * Math.cos(desiredAngle);
          n.vy += accel * Math.sin(desiredAngle);
        }
        n.vx *= FRICTION;
        n.vy *= FRICTION;
        let sp = Math.hypot(n.vx, n.vy);
        if(sp > PLAYER_MAX_SPEED) {
          let sc = PLAYER_MAX_SPEED / sp;
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
          let target = (n.index === 1) ? ranking[0] : (ranking[1] || ranking[0]);
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

setInterval(updateGame, 1000 / SERVER_FPS);

function checkGameOver() {
  let arr = Object.values(players);
  let alive = [];
  for(let i = 0; i < arr.length; i++) {
    if(arr[i].alive) alive.push(arr[i]);
  }
  if(alive.length <= 0 && gameRunning) {
    gameRunning = false;
    io.emit("gameOver", { winner: null });
    console.log("무승부(아무도 안남음)");
    npcs = [];
    for(let pid in players) {
      players[pid].ready = false;
      players[pid].invincibilityUsed = false;
    }
    return;
  }
  if(alive.length <= winnerCount && gameRunning) {
    gameRunning = false;
    if(alive.length > 0) {
      let names = [];
      for(let x = 0; x < alive.length; x++) {
        names.push(alive[x].nickname);
      }
      let winnerNames = names.join(", ");
      io.emit("gameOver", { winner: winnerNames });
      console.log("승자들: " + winnerNames);
    } else {
      io.emit("gameOver", { winner: null });
      console.log("무승부(승자 없음)");
    }
    npcs = [];
    for(let pid in players) {
      players[pid].ready = false;
      players[pid].invincibilityUsed = false;
    }
  }
}

// ----------------------
// Reset 기능: 대기실 우측 상단의 "초기화" 버튼을 누르면 전체 상태 초기화
// ----------------------
io.on("connection", function(socket) {
  socket.on("resetGame", function() {
    gameRunning = false;
    npcs = [];
    spawnedNarang = false;
    spawnedEolkimchi = false;
    spawnedGoryeosam = false;
    for(let pid in players) {
      players[pid].ready = false;
      players[pid].invincibilityUsed = false;
    }
    io.emit("gameReset");
  });
});

var PORT = 3000;
server.listen(PORT, function() {
  console.log("서버 실행 중: http://localhost:" + PORT);
});
