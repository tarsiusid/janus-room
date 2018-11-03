[![npm version](https://badge.fury.io/js/janus-room.png)](https://badge.fury.io/js/janus-room)

### Janus Room

A Janus client library that provides simple interface to create a minimal-complete conference video room. This is adopted from Janus demo example code but it's JQuery-less and React/Vue friendly.

### Install

```
$ yarn add janus-room
```

### Basic usage

```
import Room from 'janus-room';

...

var options = {
  server: server, // required
  room: room, // required

  // Event handlers
  onLocalJoin: onLocalJoin,
  onRemoteJoin: onRemoteJoin,
  onRemoteUnjoin: onRemoteUnjoin,
  onMessage: onMessage,
  onError: onError,
}

var room = new Room(options);
room.init()
.then(function(){
  room.register({
    username:username // required
  });
})
.catch(function(err){
  alert(err);
});
```

### Methods

- `room.initt()` - Initialize the session.
- `room.toggleMuteAudio()` - Toggle local mic.
- `room.toggleMuteVideo()` - Toggle local video stream.
- `room.sendMessage(data)` - Send message throught Janus's DataChannel (activated by default).
- `room.attachStream(element, streamIndex)` - Attach a remote stream to a `<video>` element. Local stream is on 0.
- `room.shareScreen()` - Share screen.
- `room.createRoom({room:1337})` - Create new room.
- `room.removeRoom()` - Remove current room.

### Events (passed as params)

- `onLocalJoin(() => { ...`
- `onRemoteJoin((streamIndex, username) => { ...`
- `onRemoteUnjoin((streamIndex) => { ...`
- `onMessage((data) => { ...`
- `onError((err) => { ...`

### Working example

Adjust the Janus gateway URL in `example.js`, then,

- `yarn`
- `npm run build`
- Open `example.html` with your web browser.

-----

![tarsier](https://user-images.githubusercontent.com/2534060/47661055-e06e4580-dbca-11e8-96f4-30dcdcb14c81.png)

