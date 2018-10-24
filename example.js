window.Room = require('./src');

var room;
var server = 'https://localhost:8089/janus';
var roomId = 1234; // Demo room
var username = window.prompt('username : ');
if (!username) {
  return alert('Username is needed. Please refresh');
}
document.getElementById('username').innerHTML = username;

// Event handlers
var onLocalJoin = function(username, cb) {
  var htmlStr = '<div>' + username + '</div>';
  htmlStr += '<button id="local-toggle-mute-audio" onclick="localToggleMuteAudio()">Mute</button>';
  htmlStr += '<button id="local-toggle-mute-video" onclick="localToggleMuteVideo()">Pause ebcam</button>';
  htmlStr += '<video id="myvideo" style="width:inherit;" autoplay muted="muted"/>';
  document.getElementById('videolocal').innerHTML = htmlStr;
  let target = document.getElementById('myvideo');
  room.attachLocalStream(target);
}

var onRemoteJoin = function(index, username, cb) {
  document.getElementById('videoremote' + index).innerHTML = '<div>' + username + '</div><video style="width:inherit;" id="remotevideo' + index + '" autoplay/>';
  let target = document.getElementById('remotevideo' + index);
  room.attachStream(target, index);
}

var onRemoteUnjoin = function(index) {
  document.getElementById('videoremote' + index).innerHTML = '<div>videoremote' + index + '</div>';
}

var onMessage = function(data) {
  if (!data) return;
  console.log(data);
  if (data.type && data.type === 'chat') {
    document.getElementById("chatbox").innerHTML += '<p>' + data.sender + ' : ' + data.message + '</p><hr>';
  } else if (data.type && data.type === 'request') {
    if (data.action && data.action === 'muteAudio') {
    }
  }
}

var options = {
  server: server,
  room: roomId,
  onLocalJoin: onLocalJoin,
  onRemoteJoin: onRemoteJoin,
  onRemoteUnjoin: onRemoteUnjoin,
  onMessage: onMessage,
}

room = window.room = new window.Room(options);

room.init()
.then(function(){
  return room.start();
})
.then(function(){
  setTimeout(function(){
    room.register({username:username});
  }, 1000);
});

document.getElementById('stop').onclick = function() {
  room.stop();
}

document.getElementById('register').onclick = function() {
  room.register({username:username});
}

document.getElementById('chatsend').onclick = function() {
  var message = document.getElementById('chatinput').value;
  room.sendMessage({type : 'chat', sender:username, message : message})
  .then(function(data){
    document.getElementById("chatbox").innerHTML += '<p>' + username + ' : ' + message + '</p><hr>';
  });
}

window.localToggleMuteAudio = function() {
  room.toggleMuteAudio()
  .then((muted) => {
    var el = document.getElementById('local-toggle-mute-audio');
    if (muted) {
      el.innerHTML = "Unmute";
    } else {
      el.innerHTML = "Mute";
    }
  });
}

window.localToggleMuteVideo = function() {
  room.toggleMuteVideo()
  .then((muted) => {
    var el = document.getElementById('local-toggle-mute-video');
    if (muted) {
      el.innerHTML = "Resume webcam";
    } else {
      el.innerHTML = "Pause webcam";
    }
  });
}
