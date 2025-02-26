var socket = io();

var nicknameInput = document.getElementById("nickname");
var colorInput = document.getElementById("color");
var readyBtn = document.getElementById("readyBtn");
var playerList = document.getElementById("playerList");
var winnerCountInput = document.getElementById("winnerCountInput");
var winnerCountBtn = document.getElementById("winnerCountBtn");

var lobbyDiv = document.getElementById("lobby");
var gameDiv = document.getElementById("game");
var gameCanvas = document.getElementById("gameCanvas");
var ctx = gameCanvas.getContext("2d");

function resizeCanvas() {
  gameCanvas.width = window.innerWidth;
  gameCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

var myId = null;
var localPlayer = { x: 0, y: 0, angle: 0, alive: true };
var mapWidth = 16000;
var mapHeight = 16000;
var explosions = [];

var mousePos = { x: gameCanvas.width / 2, y: gameCanvas.height / 2 };
var mouseDown = false;

socket.on("connect", function () {
  myId = socket.id;
  console.log("내 소켓 ID:" + myId);
});

// 승자수 설정 버튼
winnerCountBtn.addEventListener("click", function () {
  var val = winnerCountInput.value;
  socket.emit("setWinnerCount", val);
});

// Ready 버튼
readyBtn.addEventListener("click", function () {
  socket.emit("setPlayerInfo", {
    nickname: nicknameInput.value,
    color: colorInput.value
  });
  socket.emit("setReady", true);
});

// 대기방 업데이트
socket.on("lobbyUpdate", function (players) {
  playerList.innerHTML = "";
  for (var id in players) {
    var p = players[id];
    var li = document.createElement("li");
    li.innerText = p.nickname + " / " + p.color + " / " + (p.ready ? "Ready" : "Not Ready");
    playerList.appendChild(li);
  }
});

// 게임 시작
socket.on("gameStart", function () {
  lobbyDiv.style.display = "none";
  gameDiv.style.display = "block";
  var bgm = document.getElementById("bgm");
  bgm.currentTime = 0;
  // 볼륨을 1/3로 설정 (0.33)
  bgm.volume = 0.33;
  bgm.play().catch(() => {});
  startGameLoop();
});

// 게임 메시지 수신
socket.on("gameMessage", function (data) {
  if (data.countdown) {
    displayCountdown(data.text, data.countdown, data.color, data.position);
  } else if (data.duration === 0) {
    displayMessage(data.text, 0);
  } else if (data.duration) {
    displayMessage(data.text, data.duration);
  } else {
    displayMessage(data.text, 3);
  }
});

function displayMessage(text, duration) {
  var overlay = document.getElementById("messageOverlay");
  overlay.innerText = text;
  if (duration > 0) {
    setTimeout(function () {
      overlay.innerText = "";
    }, duration * 1000);
  }
}

function displayCountdown(prefix, count, color, position) {
  var overlay = document.getElementById("messageOverlay");
  overlay.style.color = color || "red";
  var current = count;
  overlay.innerText = prefix + " (" + current + ")";
  var interval = setInterval(function () {
    current--;
    if (current < 0) {
      clearInterval(interval);
      overlay.innerText = "";
    } else {
      overlay.innerText = prefix + " (" + current + ")";
    }
  }, 1000);
}

// gameState 업데이트
socket.on("gameState", function (data) {
  var players = data.players;
  var npcs = data.npcs;
  mapWidth = data.mapWidth;
  mapHeight = data.mapHeight;

  if (myId && players[myId]) {
    var me = players[myId];
    localPlayer.x = me.x;
    localPlayer.y = me.y;
    localPlayer.alive = me.alive;
    if (me.explosion) {
      addExplosion(me.x, me.y);
      var deadSound = document.getElementById("deadSound");
      deadSound.currentTime = 0;
      deadSound.play().catch(() => {});
    }
  }
  for (var pid in players) {
    if (players[pid].explosion) {
      addExplosion(players[pid].x, players[pid].y);
      players[pid].explosion = false;
    }
  }
  drawGame(players, npcs);
});

socket.on("gameOver", function (info) {
  var msg = "무승부!";
  if (info.winner) {
    msg = "승자: " + info.winner;
  }
  alert("게임 종료!\n" + msg);
  lobbyDiv.style.display = "flex";
  gameDiv.style.display = "none";
  explosions = [];
});

gameCanvas.addEventListener("mousemove", function (e) {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
});
gameCanvas.addEventListener("mousedown", function (e) {
  if (e.button === 0) mouseDown = true;
});
gameCanvas.addEventListener("mouseup", function (e) {
  if (e.button === 0) mouseDown = false;
});

function startGameLoop() {
  function update() {
    if (localPlayer.alive) {
      var dx = mousePos.x - gameCanvas.width / 2;
      var dy = mousePos.y - gameCanvas.height / 2;
      var angle = Math.atan2(dy, dx);
      socket.emit("playerMove", { angle: angle, mouseDown: mouseDown });
    }
    updateExplosions();
    requestAnimationFrame(update);
  }
  update();
}

function addExplosion(x, y) {
  explosions.push({ x: x, y: y, frame: 0 });
}
function updateExplosions() {
  for (var i = 0; i < explosions.length; i++) {
    explosions[i].frame++;
  }
  explosions = explosions.filter(function (ex) { return ex.frame <= 30; });
}

// 별 그리기 함수 (5각별)
function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  var rot = Math.PI / 2 * 3;
  var x = cx;
  var y = cy;
  var step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for (var i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;
    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
  ctx.fill();
}

function drawGame(players, npcs) {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  var gridSize = 200;
  var offsetX = -localPlayer.x % gridSize;
  var offsetY = -localPlayer.y % gridSize;
  ctx.strokeStyle = "gray";
  for (var xx = offsetX; xx < gameCanvas.width; xx += gridSize) {
    for (var yy = offsetY; yy < gameCanvas.height; yy += gridSize) {
      ctx.strokeRect(xx, yy, gridSize, gridSize);
    }
  }

  var leftEdge = -localPlayer.x + gameCanvas.width / 2;
  var topEdge = -localPlayer.y + gameCanvas.height / 2;
  var rightEdge = leftEdge + mapWidth;
  var bottomEdge = topEdge + mapHeight;
  ctx.strokeStyle = "red";
  ctx.beginPath();
  ctx.moveTo(leftEdge, topEdge);
  ctx.lineTo(rightEdge, topEdge);
  ctx.lineTo(rightEdge, bottomEdge);
  ctx.lineTo(leftEdge, bottomEdge);
  ctx.closePath();
  ctx.stroke();

  for (var pid in players) {
    var pl = players[pid];
    if (!pl.alive) continue;
    var px = pl.x - localPlayer.x + gameCanvas.width / 2;
    var py = pl.y - localPlayer.y + gameCanvas.height / 2;
    ctx.fillStyle = pl.color;
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.fill();

    var needleLength = pl.needleLength || 40;
    // bonus일 경우 두께를 기본 2에서 10배(20)로 설정
    ctx.strokeStyle = "red";
    ctx.lineWidth = pl.needleBonus ? 20 : 2;
    var startX = px + 20 * Math.cos(pl.angle);
    var startY = py + 20 * Math.sin(pl.angle);
    var endX = px + needleLength * Math.cos(pl.angle);
    var endY = py + needleLength * Math.sin(pl.angle);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    var balloonX = px - 30 * Math.cos(pl.angle);
    var balloonY = py - 30 * Math.sin(pl.angle);
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(balloonX, balloonY, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "36px Arial";
    ctx.fillStyle = "lime";
    ctx.fillText(pl.nickname, px - 40, py - 40);
  }

  for (var i = 0; i < npcs.length; i++) {
    var nn = npcs[i];
    if (!nn.alive) continue;
    var nx = nn.x - localPlayer.x + gameCanvas.width / 2;
    var ny = nn.y - localPlayer.y + gameCanvas.height / 2;
    if (nn.type === "narang") {
      var hue = (Date.now() / 10) % 360;
      ctx.fillStyle = "hsl(" + hue + ", 100%, 50%)";
      ctx.fillRect(nx - 20, ny - 20, 40, 40);
    } else if (nn.type === "eolkimchi") {
      var hue = (Date.now() / 10) % 360;
      ctx.fillStyle = "hsl(" + hue + ", 100%, 50%)";
      drawStar(ctx, nx, ny, 5, 40, 20);
      var needleLen = 100;
      var endX = nx + needleLen * Math.cos(nn.needleAngle);
      var endY = ny + needleLen * Math.sin(nn.needleAngle);
      ctx.strokeStyle = "red";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    } else if (nn.type === "goryeosam") {
      var hue = (Date.now() / 10) % 360;
      ctx.fillStyle = "hsl(" + hue + ", 100%, 50%)";
      ctx.beginPath();
      ctx.arc(nx, ny, nn.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 5;
      ctx.stroke();
    } else {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(nx, ny, 20, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  var miniSize = 200;
  var miniX = gameCanvas.width - miniSize - 20;
  var miniY = gameCanvas.height - miniSize - 20;
  ctx.fillStyle = "rgba(100,100,100,0.5)";
  ctx.fillRect(miniX, miniY, miniSize, miniSize);
  ctx.strokeStyle = "white";
  ctx.strokeRect(miniX, miniY, miniSize, miniSize);

  var scaleX = miniSize / mapWidth;
  var scaleY = miniSize / mapHeight;
  for (var pid2 in players) {
    var p2 = players[pid2];
    if (!p2.alive) continue;
    var mmx = miniX + (p2.x * scaleX);
    var mmy = miniY + (p2.y * scaleY);
    ctx.fillStyle = p2.color;
    ctx.beginPath();
    ctx.arc(mmx, mmy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (var j2 = 0; j2 < npcs.length; j2++) {
    var npc2 = npcs[j2];
    if (!npc2.alive) continue;
    var mmx2 = miniX + (npc2.x * scaleX);
    var mmy2 = miniY + (npc2.y * scaleY);
    if (npc2.type === "narang") ctx.fillStyle = "magenta";
    else if (npc2.type === "eolkimchi") ctx.fillStyle = "yellow";
    else if (npc2.type === "goryeosam") ctx.fillStyle = "hsl(" + ((Date.now()/10)%360) + ",100%,50%)";
    else ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(mmx2, mmy2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
