const Janus = require('./janus');

// These values intended to be tied in the class 
// but the nested events in Janus lib make this difficult to implement, so yeah..
var opaqueId = "videoroomtest-" + Janus.randomString(12);
var server = null;
var room = null;
var username = null;
var janus = null;
var handler = null;
var myid = null;
var mystream = null;
var mypvtid = null;
var feeds = [];
var bitrateTimer = [];
var onLocalJoin = null;
var onRemoteJoin = null;
var onRemoteUnjoin = null;

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
        videoSend: true
      }, // Publishers are sendonly
      simulcast: doSimulcast,
      success: function(jsep) {
        Janus.debug("Got publisher SDP!");
        Janus.debug(jsep);
        var publish = {
          "request": "configure",
          "audio": useAudio,
          "video": true
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
          alert("WebRTC error... " + JSON.stringify(error));
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
        remoteFeed.videoCodec = video;
        remoteFeed.send({
          "message": listen
        });
      },
      error: function(error) {
        Janus.error("  -- Error attaching plugin...", error);
        alert("Error attaching plugin... " + error);
      },
      onmessage: function(msg, jsep) {
        Janus.debug(" ::: Got a message (subscriber) :::");
        Janus.debug(msg);
        var event = msg["videoroom"];
        Janus.debug("Event: " + event);
        if (msg["error"] !== undefined && msg["error"] !== null) {
          alert(msg["error"]);
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
                videoSend: false
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
                alert("WebRTC error... " + JSON.stringify(error));
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
      onremotestream: function(stream) {
        Janus.debug("Remote feed #" + remoteFeed.rfindex);
        onRemoteJoin(remoteFeed.rfindex, remoteFeed.rfdisplay, (el) => {
          Janus.attachMediaStream(el, stream);
        });
      },
      oncleanup: function() {
        Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
        if (remoteFeed.spinner !== undefined && remoteFeed.spinner !== null) {
          remoteFeed.spinner.stop();
        }
        remoteFeed.spinner = null;
        onRemoteUnjoin(remoteFeed.rfindex);
      }
    });
}

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");

class VideoRoom {

  constructor(options) {
    console.log(options);
    server = options.server;
    opaqueId = "videoroomtest-" + Janus.randomString(12);
    room = options.room;
    onLocalJoin = options.onLocalJoin;
    onRemoteJoin = options.onRemoteJoin;
    onRemoteUnjoin = options.onRemoteUnjoin;
  }

  onStartSuccess() {
    // Attach to video room test plugin
    let self = this;
    janus.attach(
      {
        plugin: "janus.plugin.videoroom",
        opaqueId: opaqueId,
        success: function(pluginHandle) {
          handler = pluginHandle;
          console.log(handler);
          Janus.log("Plugin attached! (" + handler.getPlugin() + ", id=" + handler.getId() + ")");
          Janus.log("  -- This is a publisher/manager");
        },
        error: function(error) {
          Janus.error("  -- Error attaching plugin...", error);
          alert("Error attaching plugin... " + error);
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
              alert("The room has been destroyed", function() {
                window.location.reload();
              });
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
                  alert(
                    "<p>Apparently room <code>" + room + "</code> (the one this.demo uses as a test room) " +
                    "does not exist...</p><p>Do you have an updated <code>janus.plugin.videoroom.cfg</code> " +
                    "configuration file? If not, make sure you copy the details of room <code>" + room + "</code> " +
                    "from that sample in your current configuration file, then restart Janus and try again."
                  );
                } else {
                  alert(msg["error"]);
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
          onLocalJoin(username, (el) => {
            Janus.attachMediaStream(el, stream);
            var videoTracks = stream.getVideoTracks();
            if (videoTracks === null || videoTracks === undefined || videoTracks.length === 0) {
              alert('no webcam');
            // No webcam
            } else {
              console.log('There is webcam');
            }
          });
        },
        onremotestream: function(stream) {
          // The publisher stream is sendonly, we don't expect anything here
        },
        oncleanup: function() {
          Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
          alert('Hang up. Got a cleanup notif. Unpublishing.');
          this.mystream = null;
        }
      });
  }

  start() {
    let self = this;
    // Make sure the browser supports WebRTC
    if (!Janus.isWebrtcSupported()) {
      alert("No WebRTC support... ");
      return;
    }
    // Create session
    janus = new Janus(
      {
        server: server,
        success: this.onStartSuccess,
        error: function(error) {
          Janus.error(error);
          alert(error, function() {
            window.location.reload();
          });
        },
        destroyed: function() {
          window.location.reload();
        }
      });
  }

  init() {
    Janus.init({
      debug: "all",
      callback: function() {}
    });
  }

  stop() {
    if (janus) {
      janus.destroy();
    }
  }

  register(options) {
    username = options.username;
    var register = {
      "request": "join",
      "room": room,
      "ptype": "publisher",
      "display": username
    };
    console.log(register);
    handler.send({
      "message": register
    });
  }

  toggleMute(cb) {
    let muted = handler.isAudioMuted();
    Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
    if (muted) {
      handler.unmuteAudio();
    } else {
      handler.muteAudio();
    }
    if (cb) {
      cb(handler.isAudioMuted());
    }
  }

  checkEnter(field, event) {
    var theCode = event.keyCode ? event.keyCode : event.which ? event.which : event.charCode;
    if (theCode == 13) {
      registerUsername();
      return false;
    } else {
      return true;
    }
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
  // Helpers to create Simulcast-related UI, if enabled
  addSimulcastButtons(feed, temporal) {}

  updateSimulcastButtons(feed, substream, temporal) {}

}

module.exports = VideoRoom;
