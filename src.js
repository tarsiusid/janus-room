const Janus = window.Janus = require('./janus');

// TODO These values intended to be tied in the class 
// but the nested events in Janus lib make this difficult to implement, so yeah..
var opaqueId = "videoroomtest-" + Janus.randomString(12);
var server = null;
var room = null;
var username = null;
var janus = null;
var handler = null;
var myid = null;
var mystream = null;
var remotestreams = {};
var mypvtid = null;
var feeds = [];
var bitrateTimer = [];
var onLocalJoin = null;
var onRemoteJoin = null;
var onRemoteUnjoin = null;
var onMessage = null;
var onDestroyed = null;
var onError = null;

// TODO Remove unused events / functions
// TODO In promise func, catch any possible errors and pass it to reject()

// Helpers
function getQueryStringValue(name) {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  var regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
  var results = regex.exec(location.search);
  return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function publishOwnFeed(useAudio) {
  // Publish our stream
  handler.createOffer(
    {
      // Add data:true here if you want to publish datachannels as well
      media: {
        audioRecv: false,
        videoRecv: false,
        audioSend: useAudio,
        videoSend: true,
        data: true,
      }, // Publishers are sendonly
      simulcast: doSimulcast,
      success: function(jsep) {
        Janus.debug("Got publisher SDP!");
        Janus.debug(jsep);
        var publish = {
          "request": "configure",
          "audio": useAudio,
          "video": true,
          "data": true
        };
        handler.send({
          "message": publish,
          "jsep": jsep
        });
      },
      error: function(error) {
        Janus.error("WebRTC error:", error);
        if (useAudio) {
          publishOwnFeed(false);
        } else {
          onError("WebRTC error... " + JSON.stringify(error));
        }
      }
    });
}


function unpublishOwnFeed() {
  // Unpublish our stream
  var unpublish = {
    "request": "unpublish"
  };
  handler.send({
    "message": unpublish
  });
}

function newRemoteFeed(id, display, audio, video) {
  // A new feed has been published, create a new plugin handle and attach to it as a subscriber
  var remoteFeed = null;
  janus.attach(
    {
      plugin: "janus.plugin.videoroom",
      opaqueId: opaqueId,
      success: function(pluginHandle) {
        remoteFeed = pluginHandle;
        remoteFeed.simulcastStarted = false;
        Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
        Janus.log("  -- This is a subscriber");
        // We wait for the plugin to send us an offer
        var listen = {
          "request": "join",
          "room": room,
          "ptype": "subscriber",
          "feed": id,
          "private_id": mypvtid
        };
        // In case you don't want to receive audio, video or data, even if the
        // publisher is sending them, set the 'offer_audio', 'offer_video' or
        // 'offer_data' properties to false (they're true by default), e.g.:
        // 		listen["offer_video"] = false;
        // For example, if the publisher is VP8 and this.is Safari, let's avoid video
        if (video !== "h264" && Janus.webRTCAdapter.browserDetails.browser === "safari") {
          if (video) {
            video = video.toUpperCase()
          }
          toastr.warning("Publisher is using " + video + ", but Safari doesn't support it: disabling video");
          listen["offer_video"] = false;
        }
        listen["offer_data"] = true;
        remoteFeed.videoCodec = video;
        remoteFeed.send({
          "message": listen
        });

        // Setup DataChannel
        var body = {
          "request": "setup"
        }
        pluginHandle.send({
          "message": body
        });

      },
      error: function(error) {
        Janus.error("  -- Error attaching plugin...", error);
        onError("Error attaching plugin... " + error);
      },
      onmessage: function(msg, jsep) {
        Janus.debug(" ::: Got a message (subscriber) :::");
        Janus.debug(msg);
        var event = msg["videoroom"];
        Janus.debug("Event: " + event);
        if (msg["error"] !== undefined && msg["error"] !== null) {
          onError(msg["error"]);
        } else if (event != undefined && event != null) {
          if (event === "attached") {
            // Subscriber created and attached
            for (var i = 1; i < 6; i++) {
              if (feeds[i] === undefined || feeds[i] === null) {
                feeds[i] = remoteFeed;
                remoteFeed.rfindex = i;
                break;
              }
            }
            remoteFeed.rfid = msg["id"];
            remoteFeed.rfdisplay = msg["display"];
            if (remoteFeed.spinner === undefined || remoteFeed.spinner === null) {
              var target = document.getElementById('videoremote' + remoteFeed.rfindex);
            // Spinner
            } else {
              remoteFeed.spinner.spin();
            }
            Janus.log("Successfully attached to feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") in room " + msg["room"]);
          } else if (event === "event") {
            // Check if we got an event on a simulcast-related event from publisher
            var substream = msg["substream"];
            var temporal = msg["temporal"];
            if ((substream !== null && substream !== undefined) || (temporal !== null && temporal !== undefined)) {
              if (!remoteFeed.simulcastStarted) {
                remoteFeed.simulcastStarted = true;
                // Add some new buttons
                this.addSimulcastButtons(remoteFeed.rfindex, remoteFeed.videoCodec === "vp8");
              }
              // We just received notice that there's been a switch, update the buttons
              this.updateSimulcastButtons(remoteFeed.rfindex, substream, temporal);
            }
          } else {
            // What has just happened?
          }
        }
        if (jsep !== undefined && jsep !== null) {
          Janus.debug("Handling SDP as well...");
          Janus.debug(jsep);
          // Answer and attach
          remoteFeed.createAnswer(
            {
              jsep: jsep,
              // Add data:true here if you want to subscribe to datachannels as well
              // (obviously only works if the publisher offered them in the first place)
              media: {
                audioSend: false,
                videoSend: false,
                data: true,
              }, // We want recvonly audio/video
              success: function(jsep) {
                Janus.debug("Got SDP!");
                Janus.debug(jsep);
                var body = {
                  "request": "start",
                  "room": room
                };
                remoteFeed.send({
                  "message": body,
                  "jsep": jsep
                });
              },
              error: function(error) {
                Janus.error("WebRTC error:", error);
                onError("WebRTC error... " + JSON.stringify(error));
              }
            });
        }
      },
      webrtcState: function(on) {
        Janus.log("Janus says this.WebRTC PeerConnection (feed #" + remoteFeed.rfindex + ") is " + (on ? "up" : "down") + " now");
      },
      onlocalstream: function(stream) {
        // The subscriber stream is recvonly, we don't expect anything here
      },
      ondata: function(data) {
        try {
          data = JSON.parse(data);
          onMessage(data);
        } catch ( err ) {
          onMessage({
            error: `Failed to parse JSON : ${err}`
          });
        }
      },
      onremotestream: function(stream) {
        Janus.debug("Remote feed #" + remoteFeed.rfindex);
        remotestreams[remoteFeed.rfindex] = stream;
        onRemoteJoin(remoteFeed.rfindex, remoteFeed.rfdisplay);
      },
      oncleanup: function() {
        Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
        if (remoteFeed.spinner !== undefined && remoteFeed.spinner !== null) {
          remoteFeed.spinner.stop();
        }
        remoteFeed.spinner = null;
        delete (remotestreams[remoteFeed.rfindex]);
        onRemoteUnjoin(remoteFeed.rfindex, remoteFeed.rfdisplay);
      }
    });
}

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");

class VideoRoom {

  constructor(options) {
    server = options.server || null;
    opaqueId = "videoroomtest-" + Janus.randomString(12);
    room = options.room || null;
    onLocalJoin = options.onLocalJoin || null;
    onRemoteJoin = options.onRemoteJoin || null;
    onRemoteUnjoin = options.onRemoteUnjoin || null;
    onMessage = options.onMessage || null;
    onDestroyed = options.onDestroyed || null;
    onError = options.onError || null;
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        // Make sure the browser supports WebRTC
        if (!Janus.isWebrtcSupported()) {
          onError("No WebRTC support... ");
          return;
        }
        // Create session
        janus = new Janus(
          {
            server: server,
            success: function() {
              // Attach to video room test plugin
              janus.attach(
                {
                  plugin: "janus.plugin.videoroom",
                  opaqueId: opaqueId,
                  success: function(pluginHandle) {
                    handler = pluginHandle;
                    Janus.log("Plugin attached! (" + handler.getPlugin() + ", id=" + handler.getId() + ")");
                    Janus.log("  -- This is a publisher/manager");
                    resolve();
                  },
                  error: function(error) {
                    Janus.error("  -- Error attaching plugin...", error);
                    onError("Error attaching plugin... " + error);
                  },
                  consentDialog: function(on) {
                    Janus.debug("Consent dialog should be " + (on ? "on" : "off") + " now");
                    if (on) {
                      // Darken screen and show hint
                    } else {
                      // Restore screen
                    }
                  },
                  mediaState: function(medium, on) {
                    Janus.log("Janus " + (on ? "started" : "stopped") + " receiving our " + medium);
                  },
                  webrtcState: function(on) {
                    Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                  },
                  onmessage: function(msg, jsep) {
                    Janus.debug(" ::: Got a message (publisher) :::");
                    Janus.debug(msg);
                    var event = msg["videoroom"];
                    Janus.debug("Event: " + event);
                    if (event != undefined && event != null) {
                      if (event === "joined") {
                        // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                        myid = msg["id"];
                        mypvtid = msg["private_id"];
                        Janus.log("Successfully joined room " + msg["room"] + " with ID " + myid);
                        publishOwnFeed(true);
                        // Any new feed to attach to?
                        if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
                          var list = msg["publishers"];
                          Janus.debug("Got a list of available publishers/feeds:");
                          Janus.debug(list);
                          for (var f in list) {
                            var id = list[f]["id"];
                            var display = list[f]["display"];
                            var audio = list[f]["audio_codec"];
                            var video = list[f]["video_codec"];
                            Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                            newRemoteFeed(id, display, audio, video);
                          }
                        }
                      } else if (event === "destroyed") {
                        // The room has been destroyed
                        Janus.warn("The room has been destroyed!");
                        onDestroyed();
                      } else if (event === "event") {
                        // Any new feed to attach to?
                        if (msg["publishers"] !== undefined && msg["publishers"] !== null) {
                          var list = msg["publishers"];
                          Janus.debug("Got a list of available publishers/feeds:");
                          Janus.debug(list);
                          for (var f in list) {
                            var id = list[f]["id"];
                            var display = list[f]["display"];
                            var audio = list[f]["audio_codec"];
                            var video = list[f]["video_codec"];
                            Janus.debug("  >> [" + id + "] " + display + " (audio: " + audio + ", video: " + video + ")");
                            newRemoteFeed(id, display, audio, video);
                          }
                        } else if (msg["leaving"] !== undefined && msg["leaving"] !== null) {
                          // One of the publishers has gone away?
                          var leaving = msg["leaving"];
                          Janus.log("Publisher left: " + leaving);
                          var remoteFeed = null;
                          for (var i = 1; i < 6; i++) {
                            if (feeds[i] != null && feeds[i] != undefined && feeds[i].rfid == leaving) {
                              remoteFeed = feeds[i];
                              break;
                            }
                          }
                          if (remoteFeed != null) {
                            Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                            feeds[remoteFeed.rfindex] = null;
                            remoteFeed.detach();
                          }
                        } else if (msg["unpublished"] !== undefined && msg["unpublished"] !== null) {
                          // One of the publishers has unpublished?
                          var unpublished = msg["unpublished"];
                          Janus.log("Publisher left: " + unpublished);
                          if (unpublished === 'ok') {
                            // That's us
                            handler.hangup();
                            return;
                          }
                          var remoteFeed = null;
                          for (var i = 1; i < 6; i++) {
                            if (feeds[i] != null && feeds[i] != undefined && feeds[i].rfid == unpublished) {
                              remoteFeed = feeds[i];
                              break;
                            }
                          }
                          if (remoteFeed != null) {
                            Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                            feeds[remoteFeed.rfindex] = null;
                            remoteFeed.detach();
                          }
                        } else if (msg["error"] !== undefined && msg["error"] !== null) {
                          if (msg["error_code"] === 426) {
                            // This is a "no such room" error: give a more meaningful description
                            onError(
                              "<p>Apparently room <code>" + room + "</code> (the one this.demo uses as a test room) " +
                              "does not exist...</p><p>Do you have an updated <code>janus.plugin.videoroom.cfg</code> " +
                              "configuration file? If not, make sure you copy the details of room <code>" + room + "</code> " +
                              "from that sample in your current configuration file, then restart Janus and try again."
                            );
                          } else {
                            onError(msg["error"]);
                          }
                        }
                      }
                    }
                    if (jsep !== undefined && jsep !== null) {
                      Janus.debug("Handling SDP as well...");
                      Janus.debug(jsep);
                      handler.handleRemoteJsep({
                        jsep: jsep
                      });
                      // Check if any of the media we wanted to publish has
                      // been rejected (e.g., wrong or unsupported codec)
                      var audio = msg["audio_codec"];
                      if (mystream && mystream.getAudioTracks() && mystream.getAudioTracks().length > 0 && !audio) {
                        // Audio has been rejected
                        toastr.warning("Our audio stream has been rejected, viewers won't hear us");
                      }
                      var video = msg["video_codec"];
                      if (mystream && mystream.getVideoTracks() && mystream.getVideoTracks().length > 0 && !video) {
                        // Video has been rejected
                        toastr.warning("Our video stream has been rejected, viewers won't see us");
                      // Hide the webcam video
                      }
                    }
                  },
                  onlocalstream: function(stream) {
                    Janus.debug(" ::: Got a local stream :::");
                    mystream = stream;
                    Janus.debug(stream);
                    onLocalJoin();
                  },
                  onremotestream: function(stream) {
                    // The publisher stream is sendonly, we don't expect anything here
                  },
                  ondataopen: function(data) {
                    console.log('ondataopen');
                  },
                  oncleanup: function() {
                    Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
                    this.mystream = null;
                  }
                });
            },
            error: function(error) {
              Janus.error(error);
              reject(e);
            },
            destroyed: function() {
              console.log('Destroyed');
            }
          }
        );
      } catch ( err ) {
        reject(err);
      }
    });
  }

  init() {
    return new Promise((resolve, reject) => {
      try {
        if (!server) {
          throw 'server value is needed.';
        }
        if (!room) {
          throw 'room value is needed.';
        }
        Janus.init({
          debug: "all",
          callback: function() {
            resolve();
          }
        });
      } catch ( err ) {
        reject(err);
      }
    });
  }

  stop() {
    if (janus) {
      // Make sure the webcam and microphone got turned off first
      handler.muteAudio();
      handler.muteVideo();
      // Destroy the session
      janus.destroy();
    }
  }

  register(options) {
    new Promise((resolve, reject) => {
      try {
        if (!options || (options && !options.username)) {
          throw 'username value is needed.';
        }
        username = options.username;
        var register = {
          "request": "join",
          "room": room,
          "ptype": "publisher",
          "display": username
        };
        handler.send({
          "message": register
        });
        resolve();
      } catch ( err ) {
        reject(err);
      }
    });
  }

  toggleMuteAudio() {
    return new Promise((resolve, reject) => {
      try {
        let muted = handler.isAudioMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
        if (muted) {
          handler.unmuteAudio();
        } else {
          handler.muteAudio();
        }
        resolve(handler.isAudioMuted());
      } catch ( err ) {
        reject(err);
      }
    });
  }

  toggleMuteVideo() {
    return new Promise((resolve, reject) => {
      try {
        let muted = handler.isVideoMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
        if (muted) {
          handler.unmuteVideo();
        } else {
          handler.muteVideo();
        }
        resolve(handler.isVideoMuted());
      } catch ( err ) {
        reject(err);
      }
    });
  }

  sendMessage(data) {
    return new Promise((resolve, reject) => {
      try {
        handler.data({
          text: JSON.stringify(data),
          success: function() {
            resolve(data);
          },
          error: function(err) {
            reject(err);
          },
        });
      } catch ( err ) {
        reject(err)
      }
    });
  }

  attachStream(target, index) {
    return new Promise((resolve, reject) => {
      try {
        if (index === 0) {
          Janus.attachMediaStream(target, mystream);
        } else {
          Janus.attachMediaStream(target, remotestreams[index]);
        }
        resolve();
      } catch ( err ) {
        reject(err);
      }
    });
  }

  publishOwnFeed(useAudio) {
    publishOwnFeed(useAudio);
  }

  unpublishOwnFeed() {
    unpublishOwnFeed();
  }

  newRemoteFeed(id, display, audio, video) {
    newRemoteFeed(id, display, audio, video);
  }

  // TODO Fix me.
  // Helpers to create Simulcast-related UI, if enabled
  addSimulcastButtons(feed, temporal) {}

  updateSimulcastButtons(feed, substream, temporal) {}

}

module.exports = VideoRoom;
