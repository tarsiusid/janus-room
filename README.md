### Janus Room

A Janus client library that provides simple interface to create a minimal-complete conference video room. This is adopted from Janus demo example code but it's JQuery-less and React/Vue friendly.

### Install

```
$ yarn add janus-room
```

### Usage

```
import Room from 'janus-room';

...

var options = {
  server: server,
  room: room,
  // Event handlers
  onLocalJoin: onLocalJoin,
  onRemoteJoin: onRemoteJoin,
  onRemoteUnjoin: onRemoteUnjoin,
  onMessage: onMessage,
}

var room = new Room(options);
room.init()
.then(function(){
  return room.start();
})
.then(function(){
  room.register({username:username});
});
```

### Methods

- `room.toggleMuteAudio()` - Toggle local mic
- `room.toggleMuteVideo()` - Toggle local video stream
- `room.sendMessage(data)` - Send message throught Janus's DataChannel (active by default)
- `room.attachStream(element, streamIndex)` - Attach a remote stream to a `<video>` element
- `room.attachLocalStream(element)` - Attach local stream to a `<video>` element

### Events

- `onLocalJoin(() => { ...`
- `onRemoteJoin((streamIndex, username) => { ...`
- `onRemoteUnjoin((streamIndex) => { ...`
- `onMessage((data) => { ...`

### Working example

Adjust the Janus gateway URL in `example.js`, then,

- `yarn`
- `npm run build`
- Open `example.html` with your web browser.