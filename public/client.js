var socket = io("https://joel-multiplayer-game-production.up.railway.app");


var nicknameInput= document.getElementById("nickname");
var colorInput= document.getElementById("color");
var readyBtn= document.getElementById("readyBtn");
var playerList= document.getElementById("playerList");
var winnerCountInput= document.getElementById("winnerCountInput");
var winnerCountBtn= document.getElementById("winnerCountBtn");

var lobbyDiv= document.getElementById("lobby");
var gameDiv= document.getElementById("game");
var gameCanvas= document.getElementById("gameCanvas");
var ctx= gameCanvas.getContext("2d");

function resizeCanvas(){
  gameCanvas.width= window.innerWidth;
  gameCanvas.height= window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

var myId= null;
var localPlayer= {
  x:0, y:0,
  angle:0,
  alive:true
};
var mapWidth=16000;
var mapHeight=16000;
var explosions= [];

var mousePos= { x: gameCanvas.width/2, y: gameCanvas.height/2 };
var mouseDown= false;

socket.on("connect", function(){
  myId= socket.id;
  console.log("내 소켓 ID:"+ myId);
});

// 승자수 설정 버튼
winnerCountBtn.addEventListener("click", function(){
  var val= winnerCountInput.value;
  socket.emit("setWinnerCount", val);
});

// Ready
readyBtn.addEventListener("click", function(){
  socket.emit("setPlayerInfo", {
    nickname: nicknameInput.value,
    color: colorInput.value
  });
  socket.emit("setReady", true);
});

// 대기방 업데이트
socket.on("lobbyUpdate", function(players){
  playerList.innerHTML="";
  for(var id in players){
    var p= players[id];
    var li= document.createElement("li");
    li.innerText= p.nickname+" / "+ p.color+" / "+(p.ready? "Ready":"Not Ready");
    playerList.appendChild(li);
  }
});

// 게임 시작
socket.on("gameStart", function(){
  lobbyDiv.style.display= "none";
  gameDiv.style.display= "block";
  startGameLoop();
});

// gameState
socket.on("gameState", function(data){
  var players= data.players;
  var npcs= data.npcs;
  mapWidth= data.mapWidth;
  mapHeight=data.mapHeight;

  if(myId && players[myId]){
    var me= players[myId];
    localPlayer.x= me.x;
    localPlayer.y= me.y;
    localPlayer.alive= me.alive;
    if(me.explosion){
      addExplosion(me.x, me.y);
    }
  }
  // other player's explosion
  for(var pid in players){
    if(players[pid].explosion){
      addExplosion(players[pid].x, players[pid].y);
      players[pid].explosion= false;
    }
  }

  drawGame(players, npcs);
});

socket.on("gameOver", function(info){
  var msg= "무승부!";
  if(info.winner){
    msg= "승자: "+ info.winner;
  }
  alert("게임 종료!\n"+ msg);
  lobbyDiv.style.display= "flex";
  gameDiv.style.display= "none";
  explosions= [];
});

gameCanvas.addEventListener("mousemove", function(e){
  mousePos.x= e.clientX;
  mousePos.y= e.clientY;
});
gameCanvas.addEventListener("mousedown", function(e){
  if(e.button===0) mouseDown= true;
});
gameCanvas.addEventListener("mouseup", function(e){
  if(e.button===0) mouseDown=false;
});

function startGameLoop(){
  function update(){
    if(localPlayer.alive){
      var dx= mousePos.x - gameCanvas.width/2;
      var dy= mousePos.y - gameCanvas.height/2;
      var angle= Math.atan2(dy,dx);
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

// explosion effect
function addExplosion(x,y){
  explosions.push({ x:x, y:y, frame:0 });
}
function updateExplosions(){
  for(var i=0;i<explosions.length;i++){
    explosions[i].frame++;
  }
  explosions= explosions.filter(function(ex){return ex.frame<=30;});
}

function drawGame(players, npcs){
  ctx.fillStyle="black";
  ctx.fillRect(0,0, gameCanvas.width, gameCanvas.height);

  // 격자(회색)
  var gridSize= 200;
  var offsetX= -localPlayer.x % gridSize;
  var offsetY= -localPlayer.y % gridSize;
  ctx.strokeStyle="gray";
  for(var xx= offsetX; xx< gameCanvas.width; xx+=gridSize){
    for(var yy= offsetY; yy< gameCanvas.height; yy+=gridSize){
      ctx.strokeRect(xx,yy, gridSize, gridSize);
    }
  }

  // 빨간 테두리 => 맵 경계
  var leftEdge= -localPlayer.x + gameCanvas.width/2;
  var topEdge= -localPlayer.y + gameCanvas.height/2;
  var rightEdge= leftEdge+ mapWidth;
  var bottomEdge= topEdge+ mapHeight;
  ctx.strokeStyle="red";
  ctx.beginPath();
  ctx.moveTo(leftEdge, topEdge);
  ctx.lineTo(rightEdge, topEdge);
  ctx.lineTo(rightEdge, bottomEdge);
  ctx.lineTo(leftEdge, bottomEdge);
  ctx.closePath();
  ctx.stroke();

  // players
  for(var pid in players){
    var pl= players[pid];
    if(!pl.alive) continue;

    var px= pl.x- localPlayer.x + gameCanvas.width/2;
    var py= pl.y- localPlayer.y + gameCanvas.height/2;

    // 본체
    ctx.fillStyle= pl.color;
    ctx.beginPath();
    ctx.arc(px, py, 20, 0, Math.PI*2);
    ctx.fill();

    // needle
    var startX= px+ 20*Math.cos(pl.angle);
    var startY= py+ 20*Math.sin(pl.angle);
    var endX= px+ 40*Math.cos(pl.angle);
    var endY= py+ 40*Math.sin(pl.angle);
    ctx.strokeStyle="red";
    ctx.lineWidth= 2;
    ctx.beginPath();
    ctx.moveTo(startX,startY);
    ctx.lineTo(endX,endY);
    ctx.stroke();

    // 풍선
    var balloonX= px- 30*Math.cos(pl.angle);
    var balloonY= py- 30*Math.sin(pl.angle);
    ctx.fillStyle="orange";
    ctx.beginPath();
    ctx.arc(balloonX, balloonY, 20, 0,Math.PI*2);
    ctx.fill();

    // 닉네임
    ctx.font="36px Arial";
    ctx.fillStyle="lime";
    ctx.fillText(pl.nickname, px-40, py-40);
  }

  // npc
  for(var i=0;i<npcs.length;i++){
    var nn= npcs[i];
    if(!nn.alive) continue;
    var nx= nn.x- localPlayer.x + gameCanvas.width/2;
    var ny= nn.y- localPlayer.y + gameCanvas.height/2;
    ctx.fillStyle="white";
    ctx.beginPath();
    ctx.arc(nx, ny, 20,0,Math.PI*2);
    ctx.fill();
  }

  // explosions
  for(var e=0;e< explosions.length;e++){
    var ex= explosions[e];
    ex.frame++;
    var scale= ex.frame/30;
    var exX= ex.x- localPlayer.x + gameCanvas.width/2;
    var exY= ex.y- localPlayer.y + gameCanvas.height/2;
    var radius= 50* scale;
    ctx.fillStyle= "rgba(255,255,0,"+(1-scale)+")";
    ctx.beginPath();
    ctx.arc(exX, exY, radius, 0, Math.PI*2);
    ctx.fill();
  }

  // 미니맵
  var miniSize=200;
  var miniX= gameCanvas.width- miniSize-20;
  var miniY= gameCanvas.height- miniSize-20;
  ctx.fillStyle= "rgba(100,100,100,0.5)";
  ctx.fillRect(miniX, miniY, miniSize,miniSize);
  ctx.strokeStyle="white";
  ctx.strokeRect(miniX,miniY, miniSize,miniSize);

  var scaleX= miniSize/ mapWidth;
  var scaleY= miniSize/ mapHeight;

  // player dots
  for(var pid2 in players){
    var p2= players[pid2];
    if(!p2.alive) continue;
    var mmx= miniX+ (p2.x* scaleX);
    var mmy= miniY+ (p2.y* scaleY);
    ctx.fillStyle= p2.color;
    ctx.beginPath();
    ctx.arc(mmx,mmy,4,0,Math.PI*2);
    ctx.fill();
  }
  // npc dots
  for(var j2=0;j2<npcs.length;j2++){
    var npc2= npcs[j2];
    if(!npc2.alive) continue;
    var mmx2= miniX+ (npc2.x* scaleX);
    var mmy2= miniY+ (npc2.y* scaleY);
    ctx.fillStyle="white";
    ctx.beginPath();
    ctx.arc(mmx2,mmy2,4,0,Math.PI*2);
    ctx.fill();
  }
}