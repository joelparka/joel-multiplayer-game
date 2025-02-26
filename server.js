const express = require("express");
const http = require("http");
const socketIO = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static("public")); // index.html, client.js

// ----------------------
// Global
// ----------------------
var players = {};
var gameRunning = false;

var MAP_WIDTH = 16000;
var MAP_HEIGHT= 16000;

var SERVER_FPS = 30;

// 승자의 수
var winnerCount= 1; // 기본값

// 플레이어
var PLAYER_MAX_SPEED= 30; // 2초만에 0->30
var PLAYER_ACCEL_TIME= 2;
var PLAYER_ACCEL= PLAYER_MAX_SPEED/(PLAYER_ACCEL_TIME*SERVER_FPS);
var TURN_DIFFICULTY= 0.2;
var FRICTION= 0.99;
var PLAYER_RADIUS= 20;
var NEEDLE_LENGTH= 40;
var BALLOON_OFFSET= PLAYER_RADIUS+10;
var BALLOON_RADIUS= 20;

// NPC: 플레이어의 2배 => 60
var NPC_MAX_SPEED= PLAYER_MAX_SPEED *2; // 60
var NPC_ACCEL_TIME= 8;
var NPC_ACCEL= NPC_MAX_SPEED/(NPC_ACCEL_TIME*SERVER_FPS);

// 안전스폰
var SAFE_RADIUS= 200;

// 충돌
var BODY_RADIUS= 20;
var BODY_DIAMETER= 40;
var BOUNCE_FACTOR= 0.5;

// NPC class
function NPC(x,y){
  this.x= x;
  this.y= y;
  this.vx=0;
  this.vy=0;
  this.alive= true;
}
NPC.prototype.update= function(players){
  var closest= null;
  var minD= Infinity;
  for(var pid in players){
    var pl= players[pid];
    if(!pl.alive) continue;
    var dist= Math.hypot(pl.x- this.x, pl.y- this.y);
    if(dist< minD){
      minD= dist;
      closest= pl;
    }
  }
  if(closest){
    var desiredAngle= Math.atan2(closest.y- this.y, closest.x- this.x);
    var curSpeed= Math.hypot(this.vx, this.vy);
    var speedFactor= 1.0 - (curSpeed/ NPC_MAX_SPEED)* TURN_DIFFICULTY;
    if(speedFactor<0) speedFactor=0;
    this.vx+= NPC_ACCEL* Math.cos(desiredAngle)* speedFactor;
    this.vy+= NPC_ACCEL* Math.sin(desiredAngle)* speedFactor;
  }
  this.vx*= FRICTION;
  this.vy*= FRICTION;
  var sp= Math.hypot(this.vx, this.vy);
  if(sp> NPC_MAX_SPEED){
    var sc= NPC_MAX_SPEED/sp;
    this.vx*= sc;
    this.vy*= sc;
  }
  this.x+= this.vx;
  this.y+= this.vy;
  if(this.x<0) this.x=0;
  if(this.y<0) this.y=0;
  if(this.x> MAP_WIDTH) this.x= MAP_WIDTH;
  if(this.y> MAP_HEIGHT)this.y= MAP_HEIGHT;
};

var npcs= [];

// 안전 스폰
function getSafeSpawn(npcs, players){
  for(var attempt=0; attempt<100; attempt++){
    var x= Math.random()* MAP_WIDTH;
    var y= Math.random()* MAP_HEIGHT;
    var valid= true;
    // NPC
    for(var i=0;i<npcs.length;i++){
      var npc= npcs[i];
      var dist= Math.hypot(npc.x- x, npc.y- y);
      if(dist< SAFE_RADIUS){ valid=false; break; }
    }
    // players
    if(valid){
      for(var pid in players){
        var p= players[pid];
        if(!p.alive) continue;
        if(p.x===undefined) continue;
        var dd= Math.hypot(p.x- x, p.y- y);
        if(dd< SAFE_RADIUS){ valid=false; break; }
      }
    }
    if(valid){
      return { x:x, y:y };
    }
  }
  return { x: Math.random()* MAP_WIDTH, y: Math.random()* MAP_HEIGHT };
}

// 소켓
io.on("connection", function(socket){
  console.log("플레이어 접속:"+ socket.id);

  players[socket.id]= {
    nickname:"Guest",
    color:"#00AAFF",
    ready:false,
    x:999999, y:999999,
    vx:0, vy:0,
    angle:0,
    alive:true,
    explosion:false
  };

  socket.on("setPlayerInfo", function(data){
    var p= players[socket.id];
    if(p){
      p.nickname= data.nickname;
      p.color= data.color;
    }
    io.emit("lobbyUpdate", players);
  });

  // winnerCount 설정
  socket.on("setWinnerCount", function(num){
    var wCount= parseInt(num);
    if(!isNaN(wCount)&& wCount>=1){
      winnerCount= wCount;
      console.log("승자의 수 설정: "+ winnerCount);
    }
    io.emit("lobbyUpdate", players);
  });

  socket.on("setReady", function(rdy){
    var p= players[socket.id];
    if(p) p.ready= rdy;

    var allReady= true;
    for(var pid in players){
      if(!players[pid].ready){
        allReady= false; 
        break;
      }
    }
    if(allReady && !gameRunning){
      gameRunning= true;
      npcs=[];
      for(var i=0;i<2;i++){
        var spn= getSafeSpawn(npcs, players);
        var npc= new NPC(spn.x, spn.y);
        npcs.push(npc);
      }
      // respawn players
      for(var pid2 in players){
        var pl= players[pid2];
        pl.alive= true;
        pl.explosion= false;
        pl.vx=0; pl.vy=0;
        var s= getSafeSpawn(npcs, players);
        pl.x= s.x; pl.y= s.y;
      }
      io.emit("gameStart");
      console.log("모든 플레이어가 준비 완료. 게임 시작! (승자수:"+ winnerCount +")");
    } else {
      io.emit("lobbyUpdate", players);
    }
  });

  socket.on("playerMove", function(data){
    var p= players[socket.id];
    if(!p|| !p.alive|| !gameRunning)return;
    var curSpeed= Math.hypot(p.vx, p.vy);
    var speedFactor= 1.0 - (curSpeed/ PLAYER_MAX_SPEED)* TURN_DIFFICULTY;
    if(speedFactor<0) speedFactor=0;

    if(data.mouseDown){
      p.vx+= PLAYER_ACCEL* Math.cos(data.angle)* speedFactor;
      p.vy+= PLAYER_ACCEL* Math.sin(data.angle)* speedFactor;
    }
    p.angle= data.angle;
  });

  socket.on("disconnect", function(){
    console.log("플레이어 나감:"+ socket.id);
    delete players[socket.id];
    io.emit("lobbyUpdate", players);
  });
});

// 포인트->선분 거리
function pointLineDist(px,py, x1,y1,x2,y2){
  var A= px- x1;
  var B= py- y1;
  var C= x2- x1;
  var D= y2- y1;
  var dot= A*C + B*D;
  var len2= C*C + D*D;
  var param= dot/ len2;
  if(param<0) param=0; else if(param>1) param=1;
  var xx= x1+ param*C;
  var yy= y1+ param*D;
  var dx= px- xx;
  var dy= py- yy;
  return Math.hypot(dx,dy);
}

// needle vs balloon
function arrowBalloonCollision(){
  var plist= Object.entries(players);
  for(var i=0;i< plist.length; i++){
    var A= plist[i][1];
    if(!A.alive) continue;
    var startX= A.x+ PLAYER_RADIUS*Math.cos(A.angle);
    var startY= A.y+ PLAYER_RADIUS*Math.sin(A.angle);
    var endX= A.x+ NEEDLE_LENGTH*Math.cos(A.angle);
    var endY= A.y+ NEEDLE_LENGTH*Math.sin(A.angle);

    for(var j=0;j< plist.length;j++){
      if(i=== j) continue;
      var B= plist[j][1];
      if(!B.alive) continue;
      var balloonX= B.x- BALLOON_OFFSET*Math.cos(B.angle);
      var balloonY= B.y- BALLOON_OFFSET*Math.sin(B.angle);

      var dist= pointLineDist(balloonX, balloonY, startX,startY, endX,endY);
      if(dist< BALLOON_RADIUS){
        B.alive=false;
        B.explosion=true;
      }
    }
  }
}

// 플레이어끼리 몸통 충돌
function bodyCollisionPlayers(){
  var plist= Object.entries(players);
  for(var i=0;i< plist.length;i++){
    var A= plist[i][1];
    if(!A.alive) continue;
    for(var j=i+1;j< plist.length;j++){
      var B= plist[j][1];
      if(!B.alive) continue;
      var dx= B.x- A.x;
      var dy= B.y- A.y;
      var dist= Math.hypot(dx,dy);
      if(dist< BODY_DIAMETER){
        var overlap= (BODY_DIAMETER- dist)*0.5;
        var nx= dx/dist; var ny= dy/dist;
        if(dist===0){ nx=1; ny=0;}
        A.x-= nx* overlap; A.y-= ny* overlap;
        B.x+= nx* overlap; B.y+= ny* overlap;
        A.vx*= BOUNCE_FACTOR; A.vy*= BOUNCE_FACTOR;
        B.vx*= BOUNCE_FACTOR; B.vy*= BOUNCE_FACTOR;
      }
    }
  }
}

// NPC vs player => out
function npcCollision(){
  var npcRad= 20;
  for(var i=0;i<npcs.length;i++){
    var npc= npcs[i];
    if(!npc.alive) continue;
    for(var pid in players){
      var p= players[pid];
      if(!p.alive) continue;
      var dist= Math.hypot(npc.x- p.x, npc.y- p.y);
      if(dist< npcRad+ PLAYER_RADIUS){
        p.alive=false;
        p.explosion=true;
      }
    }
  }
}

// check gameover or multi-winner
function checkGameOver(){
  var arr= Object.values(players);
  var alive= [];
  for(var i=0;i<arr.length;i++){
    if(arr[i].alive) alive.push(arr[i]);
  }
  if(alive.length<=0 && gameRunning){
    // no one
    gameRunning= false;
    io.emit("gameOver", { winner:null });
    console.log("무승부(아무도 안남음)");
    return;
  }
  // if alive.length <= winnerCount => multi-winner
  if(alive.length <= winnerCount && gameRunning){
    gameRunning= false;
    if(alive.length>0){
      var names= [];
      for(var x=0;x< alive.length;x++){
        names.push(alive[x].nickname);
      }
      var winnerNames= names.join(", ");
      io.emit("gameOver", { winner: winnerNames});
      console.log("승자들: "+ winnerNames);
    } else {
      io.emit("gameOver", { winner:null });
      console.log("무승부(승자 없음)");
    }
  }
}

function updateGame(){
  if(!gameRunning) return;
  // friction, speed limit
  for(var pid in players){
    var p= players[pid];
    if(!p.alive) continue;
    p.vx*= FRICTION;
    p.vy*= FRICTION;
    var spd= Math.hypot(p.vx,p.vy);
    if(spd> PLAYER_MAX_SPEED){
      var sc= PLAYER_MAX_SPEED/spd;
      p.vx*= sc; p.vy*= sc;
    }
    p.x+= p.vx;
    p.y+= p.vy;
    if(p.x<0)p.x=0;
    if(p.y<0)p.y=0;
    if(p.x>MAP_WIDTH)p.x=MAP_WIDTH;
    if(p.y>MAP_HEIGHT)p.y=MAP_HEIGHT;
  }
  // npc
  for(var i=0;i<npcs.length;i++){
    var n= npcs[i];
    if(!n.alive) continue;
    n.update(players);
  }

  arrowBalloonCollision();
  bodyCollisionPlayers();
  npcCollision();
  checkGameOver();

  io.emit("gameState", {
    players: players,
    npcs: npcs,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT
  });
}

setInterval(updateGame, 1000/SERVER_FPS);

var PORT=3000;
server.listen(PORT, function(){
  console.log("서버 실행 중: http://localhost:"+ PORT);
});
