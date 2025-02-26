const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public"));

var players = {};
var gameRunning = false;

var MAP_WIDTH = 16000;
var MAP_HEIGHT= 16000;

var SERVER_FPS = 30;
var winnerCount = 1;

var PLAYER_MAX_SPEED = 30;
var PLAYER_ACCEL_TIME = 2;
var PLAYER_ACCEL = PLAYER_MAX_SPEED/(PLAYER_ACCEL_TIME*SERVER_FPS);
var TURN_DIFFICULTY = 0.2;
var FRICTION = 0.99;
var PLAYER_RADIUS = 20;
var NEEDLE_LENGTH = 40;
var BALLOON_OFFSET = PLAYER_RADIUS + 10;
var BALLOON_RADIUS = 20;

var NPC_MAX_SPEED = PLAYER_MAX_SPEED * 2;
var NPC_ACCEL_TIME = 8;
var NPC_ACCEL = NPC_MAX_SPEED/(NPC_ACCEL_TIME*SERVER_FPS);

var SAFE_RADIUS = 200;

var BODY_RADIUS = 20;
var BODY_DIAMETER = 40;
var BOUNCE_FACTOR = 0.5;

var npcs = [];
var gameTimer = 0;
var countdownStarted = false;

function NPC(x, y) {
  this.x = x;
  this.y = y;
  this.vx = 0;
  this.vy = 0;
  this.alive = true;
  this.type = "";
  this.size = 20; // 기본 크기
}

NPC.prototype.update = function(players) {
  var closest = null;
  var minD = Infinity;
  for (var pid in players) {
    var pl = players[pid];
    if (!pl.alive) continue;
    var dist = Math.hypot(pl.x - this.x, pl.y - this.y);
    if (dist < minD) {
      minD = dist;
      closest = pl;
    }
  }
  if (closest) {
    var desiredAngle = Math.atan2(closest.y - this.y, closest.x - this.x);
    var curSpeed = Math.hypot(this.vx, this.vy);
    var speedFactor = 1.0 - (curSpeed / NPC_MAX_SPEED) * TURN_DIFFICULTY;
    if (speedFactor < 0) speedFactor = 0;
    this.vx += NPC_ACCEL * Math.cos(desiredAngle) * speedFactor;
    this.vy += NPC_ACCEL * Math.sin(desiredAngle) * speedFactor;
  }
  this.vx *= FRICTION;
  this.vy *= FRICTION;
  var sp = Math.hypot(this.vx, this.vy);
  if (sp > NPC_MAX_SPEED) {
    var sc = NPC_MAX_SPEED / sp;
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

// 타이머 및 메시지 출력
setInterval(function() {
  if (gameRunning) {
    gameTimer++;

    // 2분 뒤 나랑드의 현신 예고
    if (gameTimer === 120 && !countdownStarted) {
      io.emit("message", "30초 후에 나랑드의 현신이 등장합니다..");
      countdownStarted = true;
      startCountdown();
    }

    // 나랑드의 현신 등장
    if (gameTimer === 150) {
      io.emit("message", "나랑드의 현신이 등장했습니다. 처치하면 캐릭터가 강화됩니다.");
      spawnNarangdeShin();
    }

    // 얼김치 등장
    if (gameTimer === 240) {
      io.emit("message", "30초 후에 얼김치의 얼이 울부짖습니다..");
      spawnEolkimchi();
    }

    // 한국고려삼 등장
    if (gameTimer === 360) {
      io.emit("message", "100초 후 한국고려삼이 등장합니다.. 결판을 내세요..");
      spawnKoreanGoryeoSam();
    }
  }
}, 1000); // 서버 FPS 설정

function startCountdown() {
  let countdown = 30;
  let countdownInterval = setInterval(function() {
    io.emit("countdown", countdown);
    countdown--;
    if (countdown < 0) {
      clearInterval(countdownInterval);
    }
  }, 1000);
}

function spawnNarangdeShin() {
  let npc = new NPC(Math.random() * MAP_WIDTH, Math.random() * MAP_HEIGHT);
  npc.type = "narangde_shin";
  npc.size = PLAYER_RADIUS;  // 기본 크기
  npcs.push(npc);
}

function spawnEolkimchi() {
  let npc = new NPC(Math.random() * MAP_WIDTH, Math.random() * MAP_HEIGHT);
  npc.type = "eolkimchi";
  npc.size = 4 * PLAYER_RADIUS;  // 얼김치 크기
  npcs.push(npc);
  io.emit("message", "얼김치가 포효합니다. 좆됐군요.. 도망치세요..");
}

function spawnKoreanGoryeoSam() {
  let npc = new NPC(Math.random() * MAP_WIDTH, Math.random() * MAP_HEIGHT);
  npc.type = "korean_goryeo_sam";
  npc.size = 20;  // 기본 크기
  npcs.push(npc);
  io.emit("message", "10초 후 브랜드가 2배 커집니다.");
  startKoreanGoryeoSamGrowth();
}

function startKoreanGoryeoSamGrowth() {
  let growthInterval = setInterval(function() {
    npcs.forEach(function(npc) {
      if (npc.type === "korean_goryeo_sam") {
        npc.size *= 2;  // 크기 증가
      }
    });
  }, 10000);  // 10초마다 크기 증가
}

// 소켓 이벤트 처리
io.on("connection", function(socket) {
  // 기존 소켓 연결 코드...

  // 게임 시작 후 타이머 및 NPC 관련 기능 업데이트
  socket.on("setReady", function(rdy) {
    // 게임 준비가 완료되면 NPC 및 타이머 시작
    if (rdy) {
      gameRunning = true;
      io.emit("gameStart");
      console.log("게임 시작!");
    }
  });

  // 게임 상태 업데이트
  socket.on("gameState", function(data) {
    io.emit("gameState", {
      players: players,
      npcs: npcs,
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT
    });
  });
});

var PORT = 3000;
server.listen(PORT, function() {
  console.log("서버 실행 중: http://localhost:" + PORT);
});
