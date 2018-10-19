window.VideoRoom = require('./videoroom');

var server = 'https://pleasefillthis:8089/janus';
var myroom = 1234; // Demo room
var myusername = window.prompt('username : ');
if (!myusername) {
  return alert('Username is needed. Please refresh');
}
document.getElementById('username').innerHTML = myusername;

// Event handlers
var onLocalJoin = function(username, cb) {
  document.getElementById('videolocal').innerHTML = '<div>' + username + '</div><video id="myvideo" style="width:inherit;" autoplay muted="muted"/>';
  cb();
  alert('Joined!')
}

var onRemoteJoin = function(index, username, cb) {
  document.getElementById('videoremote' + index).innerHTML = '<div>' + username + '</div><video style="width:inherit;" id="remotevideo' + index + '" autoplay/>';
  cb();
}

var onRemoteUnjoin = function(index) {
  document.getElementById('videoremote' + index).innerHTML = '<div>videoremote' + index + '</div>';
}

var options = {
  server: server,
  room: myroom,
  username: myusername,
  localVideoElementId: 'videolocal',
  remoteVideoElementIdPrefix: 'videoremote',
  onLocalJoin: onLocalJoin,
  onRemoteJoin: onRemoteJoin,
  onRemoteUnjoin: onRemoteUnjoin,
}

var videoRoom = new window.VideoRoom(options);

videoRoom.init();
videoRoom.start();

document.getElementById('stop').onclick = function() {
  videoRoom.stop();
}

document.getElementById('register').onclick = function() {
  videoRoom.register();
}
