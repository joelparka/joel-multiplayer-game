var socket = io("https://joel-multiplayer-game-production.up.railway.app");

var bgm = new Audio('bgm.mp3');
bgm.loop = true;
bgm.play();

var deadSound = new Audio('dead.mp3');

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
var localPlayer = {
  x: 0, y: 0,
  angle: 0,
  alive: true
};

socket.on("connect", function() {
  myId = socket.id;
  console.log("내 소켓 ID:" + myId);
});

winnerCountBtn.addEventListener("click", function() {
  var val = winnerCountInput.value;
  socket.emit("setWinnerCount", val);
});

readyBtn.addEventListener("click", function() {
  socket.emit("setPlayerInfo", {
    nickname: nicknameInput.value,
    color: colorInput.value
  });
  socket.emit("setReady", true);
});

socket.on("gameStart", function() {
  lobbyDiv.style.display = "none";
  gameDiv.style.display = "block";
  startGameLoop();
});

socket.on("gameState", function(data) {
  var players = data.players;
  var npcs = data.npcs;

  drawGame(players, npcs);
});

function startGameLoop() {
  function update() {
    if (localPlayer.alive) {
      var dx = mousePos.x - gameCanvas.width / 2;
      var dy = mousePos.y - gameCanvas.height / 2;
      var angle = Math.atan2(dy, dx);
      socket.emit("playerMove", {
        angle: angle,
        mouseDown: mouseDown
      });
    }
    updateExplosions();
    requestAnimationFrame(update);
  }
  update();
}

function drawGame(players, npcs) {
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // npc 표시
  npcs.forEach(function(npc) {
    if (npc.type === "narangde_shin") {
      ctx.fillStyle = "purple";
      ctx.beginPath();
      ctx.arc(npc.x - localPlayer.x + gameCanvas.width / 2, npc.y - localPlayer.y + gameCanvas.height / 2, 20, 0, Math.PI * 2);
      ctx.fill();
    } else if (npc.type === "eolkimchi") {
      ctx.fillStyle = "cyan";
      ctx.beginPath();
      ctx.arc(npc.x - localPlayer.x + gameCanvas.width / 2, npc.y - localPlayer.y + gameCanvas.height / 2, 30, 0, Math.PI * 2);
      ctx.fill();
    } else if (npc.type === "korean_goryeo_sam") {
      ctx.fillStyle = "black";
      ctx.beginPath();
      ctx.arc(npc.x - localPlayer.x + gameCanvas.width / 2, npc.y - localPlayer.y + gameCanvas.height / 2, npc.size, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
