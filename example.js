window.Room = require('./room');

//var server = 'https://pleasefillthis:8089/janus';
var server = 'https://gw.tarsius.id:8089/janus';
var room = 1234; // Demo room
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
  cb(target);
  alert('Joined!')
}

var onRemoteJoin = function(index, username, cb) {
  document.getElementById('videoremote' + index).innerHTML = '<div>' + username + '</div><video style="width:inherit;" id="remotevideo' + index + '" autoplay/>';
  let target = document.getElementById('remotevideo' + index);
  cb(target);
  alert('Other participant joined!')
}

var onRemoteUnjoin = function(index) {
  document.getElementById('videoremote' + index).innerHTML = '<div>videoremote' + index + '</div>';
}

var options = {
  server: server,
  room: room,
  onLocalJoin: onLocalJoin,
  onRemoteJoin: onRemoteJoin,
  onRemoteUnjoin: onRemoteUnjoin,
}

var room = window.room = new window.Room(options);

room.init();
room.start();

document.getElementById('stop').onclick = function() {
  room.stop();
}

document.getElementById('register').onclick = function() {
  room.register({username:username});
}

window.localToggleMuteAudio = function() {
  room.toggleMuteAudio(function(muted){
    var el = document.getElementById('local-toggle-mute-audio');
    if (muted) {
      el.innerHTML = "Unmute";
    } else {
      el.innerHTML = "Mute";
    }
  });
}

window.localToggleMuteVideo = function() {
  room.toggleMuteVideo(function(muted){
    var el = document.getElementById('local-toggle-mute-video');
    if (muted) {
      el.innerHTML = "Resume webcam";
    } else {
      el.innerHTML = "Pause webcam";
    }
  });
}
