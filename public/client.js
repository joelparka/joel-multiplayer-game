var socket = io();

var nicknameInput = document.getElementById("nickname");
var colorInput = document.getElementById("color");
var readyBtn = document.getElementById("readyBtn");
var startBtn = document.getElementById("startBtn");
var playerList = document.getElementById("playerList");
var winnerCountInput = document.getElementById("winnerCountInput");

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
var isReady = false;
var invincibilityActivated = false;

socket.on("connect", function() {
  myId = socket.id;
  console.log("내 소켓 ID:" + myId);
});

// 대기방에서는 무적 스킬 UI 숨김
readyBtn.addEventListener("click", function() {
  isReady = !isReady;
  socket.emit("setPlayerInfo", { nickname: nicknameInput.value, color: colorInput.value });
  socket.emit("setReady", isReady);
  readyBtn.innerText = isReady ? "Cancel Ready" : "Ready";
});

startBtn.addEventListener("click", function() {
  socket.emit("startGame");
});

socket.on("lobbyUpdate", function(playersData) {
  playerList.innerHTML = "";
  var allReady = true;
  for(var id in playersData) {
    var p = playersData[id];
    var li = document.createElement("li");
    li.innerText = p.nickname + " / " + p.color + " / " + (p.ready ? "Ready" : "Not Ready");
    playerList.appendChild(li);
    if(!p.ready) allReady = false;
  }
  startBtn.style.display = allReady ? "block" : "none";
});

socket.on("gameStart", function() {
  lobbyDiv.style.display = "none";
  gameDiv.style.display = "block";
  // 게임 시작 시 무적 스킬 UI 보임
  document.getElementById("skillDisplay").style.display = "block";
  var bgm = document.getElementById("bgm");
  bgm.currentTime = 0;
  bgm.volume = 0.33;
  bgm.play().catch(() => {});
  startGameLoop();
});

socket.on("gameMessage", function(data) {
  if(data.countdown) {
    displayCountdown(data.text, data.countdown, data.color, data.position);
  } else if(data.duration === 0) {
    displayMessage(data.text, 0);
  } else if(data.duration) {
    displayMessage(data.text, data.duration);
  } else {
    displayMessage(data.text, 3);
  }
});

function displayMessage(text, duration) {
  var overlay = document.getElementById("messageOverlay");
  overlay.innerText = text;
  if(duration > 0) {
    setTimeout(function() {
      overlay.innerText = "";
    }, duration * 1000);
  }
}

function displayCountdown(prefix, count, color, position) {
  var overlay = document.getElementById("messageOverlay");
  overlay.style.color = color || "red";
  var current = count;
  overlay.innerText = prefix + " (" + current + ")";
  var interval = setInterval(function() {
    current--;
    if(current < 0) {
      clearInterval(interval);
      overlay.innerText = "";
    } else {
      overlay.innerText = prefix + " (" + current + ")";
    }
  }, 1000);
}

// 무적 스킬: 대기방에서는 무시, 게임 중에만
document.addEventListener("keydown", function(e) {
  if(e.key === "1") {
    if(lobbyDiv.style.display !== "none") return;
    if(!invincibilityActivated) {
      invincibilityActivated = true;
      socket.emit("activateInvincibility");
      var skillDisplay = document.getElementById("skillDisplay");
      // 스킬 UI 전체를 회색으로 변경
      skillDisplay.style.color = "gray";
      skillDisplay.style.borderColor = "gray";
      skillDisplay.style.backgroundColor = "gray";
    }
  }
});

socket.on("zoneSound", function() {
  var zone = document.getElementById("zoneSound");
  if(zone) {
    zone.currentTime = 0;
    zone.play().catch(() => {});
  }
});

socket.on("gameState", function(data) {
  var playersData = data.players;
  var npcs = data.npcs;
  mapWidth = data.mapWidth;
  mapHeight = data.mapHeight;
  if(myId && playersData[myId]) {
    var me = playersData[myId];
    localPlayer.x = me.x;
    localPlayer.y = me.y;
    localPlayer.alive = me.alive;
  }
  for(var pid in playersData) {
    if(playersData[pid].explosion) {
      addExplosion(playersData[pid].x, playersData[pid].y);
      playersData[pid].explosion = false;
    }
  }
  drawGame(playersData, npcs);
});

socket.on("gameOver", function(info) {
  var msg = info.winner ? "승자: " + info.winner : "무승부!";
  alert("게임 종료!\n" + msg);
  lobbyDiv.style.display = "flex";
  gameDiv.style.display = "none";
  explosions = [];
  invincibilityActivated = false;
});

gameCanvas.addEventListener("mousemove", function(e) {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
});
gameCanvas.addEventListener("mousedown", function(e) {
  if(e.button === 0) mouseDown = true;
});
gameCanvas.addEventListener("mouseup", function(e) {
  if(e.button === 0) mouseDown = false;
});

function startGameLoop() {
  function update() {
    if(localPlayer.alive) {
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
  for(var i = 0; i < explosions.length; i++) {
    explosions[i].frame++;
  }
  explosions = explosions.filter(function(ex) { return ex.frame <= 30; });
}

function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  var rot = Math.PI / 2 * 3;
  var x = cx, y = cy;
  var step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  for(var i = 0; i < spikes; i++) {
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

function drawGame(playersData, npcs) {
  ctx.lineWidth = 2;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  var gridSize = 200;
  var offsetX = -localPlayer.x % gridSize;
  var offsetY = -localPlayer.y % gridSize;
  ctx.strokeStyle = "gray";
  for(var xx = offsetX; xx < gameCanvas.width; xx += gridSize) {
    for(var yy = offsetY; yy < gameCanvas.height; yy += gridSize) {
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

  // 플레이어 그리기 – 무적 시 깜빡임 효과 및 "존야!!!!!" 텍스트
  for(var pid in playersData) {
    var pl = playersData[pid];
    if(!pl.alive) continue;
    var px = pl.x - localPlayer.x + gameCanvas.width / 2;
    var py = pl.y - localPlayer.y + gameCanvas.height / 2;
    if(pl.invincible) {
      var flash = Math.floor(Date.now()/100) % 2 === 0;
      ctx.fillStyle = flash ? "yellow" : "orange";
    } else {
      ctx.fillStyle = pl.color;
    }
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI * 2);
    ctx.fill();

    var needleLength = pl.needleLength || NEEDLE_LENGTH;
    ctx.strokeStyle = "red";
    ctx.lineWidth = pl.needleBonus ? 20 : 2;
    if(pl.invincible) {
      ctx.strokeStyle = (Math.floor(Date.now()/100) % 2 === 0) ? "yellow" : "orange";
    }
    var startX = px + 20 * Math.cos(pl.angle);
    var startY = py + 20 * Math.sin(pl.angle);
    var endX = px + needleLength * Math.cos(pl.angle);
    var endY = py + needleLength * Math.sin(pl.angle);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.lineWidth = 2;

    ctx.fillStyle = pl.invincible ? ((Math.floor(Date.now()/100) % 2 === 0) ? "yellow" : "orange") : "orange";
    var balloonX = px - 30 * Math.cos(pl.angle);
    var balloonY = py - 30 * Math.sin(pl.angle);
    ctx.beginPath();
    ctx.arc(balloonX, balloonY, 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "36px Arial";
    ctx.fillStyle = "lime";
    ctx.fillText(pl.nickname, px - 40, py - 40);
    if(pl.invincible) {
      ctx.font = "bold 32px Arial";
      ctx.fillStyle = "yellow";
      ctx.textAlign = "center";
      ctx.fillText("존야!!!!!", px, py - 50);
    }
  }

  // NPC 그리기 – 특수 NPC는 무지개색 및 이름 표시
  for(var i = 0; i < npcs.length; i++) {
    var nn = npcs[i];
    if(!nn.alive) continue;
    var nx = nn.x - localPlayer.x + gameCanvas.width / 2;
    var ny = nn.y - localPlayer.y + gameCanvas.height / 2;
    if(nn.type === "narang") {
      var hue = (Date.now()/2) % 360;
      ctx.fillStyle = "hsl(" + hue + ",100%,50%)";
      var size = nn.size || 40;
      ctx.fillRect(nx - size/2, ny - size/2, size, size);
      ctx.font = "20px Arial";
      ctx.fillStyle = "hsl(" + hue + ",100%,50%)";
      ctx.textAlign = "center";
      ctx.fillText("나랑드의 현신", nx, ny - size/2 - 5);
    } else if(nn.type === "eolkimchi") {
      var hue = (Date.now()/2) % 360;
      ctx.fillStyle = "hsl(" + hue + ",100%,50%)";
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
      ctx.font = "20px Arial";
      ctx.fillStyle = "hsl(" + hue + ",100%,50%)";
      ctx.textAlign = "center";
      ctx.fillText("얼김치", nx, ny - 45);
    } else if(nn.type === "goryeosam") {
      var hue = (Date.now()/2) % 360;
      ctx.fillStyle = "hsl(" + hue + ",100%,50%)";
      ctx.beginPath();
      ctx.arc(nx, ny, nn.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.font = "20px Arial";
      ctx.fillStyle = "hsl(" + hue + ",100%,50%)";
      ctx.textAlign = "center";
      ctx.fillText("한국고려삼", nx, ny - nn.size - 5);
    } else {
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(nx, ny, 20, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 미니맵 그리기
  var miniSize = 200;
  var miniX = gameCanvas.width - miniSize - 20;
  var miniY = gameCanvas.height - miniSize - 20;
  ctx.fillStyle = "rgba(100,100,100,0.5)";
  ctx.fillRect(miniX, miniY, miniSize, miniSize);
  ctx.strokeStyle = "white";
  ctx.strokeRect(miniX, miniY, miniSize, miniSize);
  var scaleX = miniSize / MAP_WIDTH;
  var scaleY = miniSize / MAP_HEIGHT;
  for(var pid2 in playersData) {
    var p2 = playersData[pid2];
    if(!p2.alive) continue;
    var mmx = miniX + (p2.x * scaleX);
    var mmy = miniY + (p2.y * scaleY);
    ctx.fillStyle = p2.color;
    ctx.beginPath();
    ctx.arc(mmx, mmy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for(var j2 = 0; j2 < npcs.length; j2++) {
    var npc2 = npcs[j2];
    if(!npc2.alive) continue;
    var mmx2 = miniX + (npc2.x * scaleX);
    var mmy2 = miniY + (npc2.y * scaleY);
    if(npc2.type === "goryeosam") {
      let miniRadius = npc2.size / 5;
      ctx.fillStyle = "hsl(" + ((Date.now()/2)%360) + ",100%,50%)";
      ctx.beginPath();
      ctx.arc(mmx2, mmy2, miniRadius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      if(npc2.type === "narang") ctx.fillStyle = "magenta";
      else if(npc2.type === "eolkimchi") ctx.fillStyle = "yellow";
      else ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(mmx2, mmy2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
