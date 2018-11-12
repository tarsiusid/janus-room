const Janus = window.Janus = require('./janus');
const volumeMeter = require('volume-meter-skip');

var config = {
  remotestreams: {},
  feeds: [],
  bitrateTimer: []
}

// TODO Remove unused events / functions

// Helpers
function getQueryStringValue(name) {
  name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
  var regex = new RegExp("[\\?&]" + name + "=([^&#]*)");
  var results = regex.exec(location.search);
  return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
}

function publishOwnFeed(opts, cb) {
  opts = opts || {}
  // Publish our stream
  config.isShareScreenActive = false;
  config.videoRoomHandler.createOffer(
    {
      // Add data:true here if you want to publish datachannels as well
      media: {
        audioRecv: false,
        videoRecv: false,
        audioSend: opts.audioSend,
        replaceAudio: opts.replaceAudio,
        videoSend: true,
        replaceVideo: opts.replaceVideo,
        data: true,
      }, // Publishers are sendonly
      simulcast: doSimulcast,
      success: function(jsep) {
        Janus.debug("Got publisher SDP!");
        Janus.debug(jsep);
        var publish = {
          "request": "configure",
          "audio": opts.audioSend,
          "video": true,
          "data": true,
        };
        if (config.token) publish.token = config.token;
        config.videoRoomHandler.send({
          "message": publish,
          "jsep": jsep
        });
        if (cb) {
          cb();
        }
      },
      error: function(error) {
        Janus.error("WebRTC error:", error);
        if (opts && opts.audioSend) {
          publishOwnFeed({
            audioSend: false
          });
        } else {
          config.onError("WebRTC error... " + JSON.stringify(error));
        }
      }
    });
}


function unpublishOwnFeed() {
  // Unpublish our stream
  var unpublish = {
    "request": "unpublish",
  };
  if (config.token) unpublish.token = config.token;
  config.videoRoomHandler.send({
    "message": unpublish
  });
}

function shareScreen(cb) {
  // Publish our stream
  config.videoRoomHandler.createOffer(
    {
      // Add data:true here if you want to publish datachannels as well
      media: {
        video: 'screen',
        videoRecv: false,
        audioSend: true,
        videoSend: true,
      }, // Publishers are sendonly
      success: function(jsep) {
        Janus.debug("Got publisher SDP!");
        Janus.debug(jsep);
        var publish = {
          "request": "configure",
          "audio": true,
          "video": true,
          "data": true
        };
        if (config.token) publish.token = config.token;
        config.isShareScreenActive = true;
        config.videoRoomHandler.send({
          "message": publish,
          "jsep": jsep
        });
      },
      error: function(error) {
        Janus.error("WebRTC error:", error);
        if (cb) {
          cb(error);
        }
      }
    });
}

function startRecording(options) {
  config.recordPlayHandler.send({
    'message': {
      'request': 'configure',
      'video-bitrate-max': 1024 * 1024, // a quarter megabit
      'video-keyframe-interval': 15000 // 15 seconds
    }
  });
  config.recordPlayHandler.createOffer(
    {
      // By default, it's sendrecv for audio and video... no datachannels
      // If you want to test simulcasting (Chrome and Firefox only), then
      // pass a ?simulcast=true when opening this demo page: it will turn
      // the following 'simulcast' property to pass to janus.js to true
      simulcast: doSimulcast,
      success: function(jsep) {
        Janus.debug("Got SDP!");
        Janus.debug(jsep);
        var body = {
          "request": "record",
          "name": options.name || 'janus-room-test-' + (new Date()).valueOf(),
        };
        config.recordPlayHandler.send({
          "message": body,
          "jsep": jsep
        });
      },
      error: function(error) {
        Janus.error("WebRTC error...", error);
        bootbox.alert("WebRTC error... " + error);
        config.recordPlayHandler.hangup();
      }
    });
}

function stopPlayback() {
  return new Promise((resolve, reject) => {
    var stop = {
      "request": "stop",
    };
    config.recordPlayHandler.send({
      "message": stop,
      success: function() {
        resolve();
      },
      error: function(err) {
        reject(err);
      }
    });
  });
}

function start() {
  return new Promise((resolve, reject) => {
    try {
      // Make sure the browser supports WebRTC
      if (!Janus.isWebrtcSupported()) {
        config.onError("No WebRTC support... ");
        return;
      }
      // Create session
      config.janus = new Janus(
        {
          server: config.server,
          token: config.token,
          success: function() {

            // Attach to video room plugin
            config.janus.attach(
              {
                plugin: "janus.plugin.videoroom",
                opaqueId: config.opaqueId,
                success: function(pluginHandle) {
                  config.videoRoomHandler = pluginHandle;
                  Janus.log("Plugin attached! (" + config.videoRoomHandler.getPlugin() + ", id=" + config.videoRoomHandler.getId() + ")");
                  Janus.log("  -- This is a publisher/manager");
                  resolve();
                },
                error: function(error) {
                  Janus.error("  -- Error attaching plugin...", error);
                  config.onError("Error attaching plugin... " + error);
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
                  if (medium === 'video' && !on && config.isShareScreenActive && !config.mystream.active) {
                    console.log('Put back the webcam');
                    publishOwnFeed({
                      audioSend: true,
                      replaceVideo: true,
                      replaceAudio: true,
                    });
                  }
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
                    if (event === "joined" && !config.isShareScreenActive) {
                      // Publisher/manager created, negotiate WebRTC and attach to existing feeds, if any
                      config.myid = msg["id"];
                      config.mypvtid = msg["private_id"];
                      Janus.log("Successfully joined room " + msg["room"] + " with ID " + config.myid);
                      publishOwnFeed({
                        audioSend: true
                      });
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
                      config.onDestroyed();
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
                          if (config.feeds[i] != null && config.feeds[i] != undefined && config.feeds[i].rfid == leaving) {
                            remoteFeed = config.feeds[i];
                            break;
                          }
                        }
                        if (remoteFeed != null) {
                          Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                          config.feeds[remoteFeed.rfindex] = null;
                          remoteFeed.detach();
                        }
                      } else if (msg["unpublished"] !== undefined && msg["unpublished"] !== null) {
                        // One of the publishers has unpublished?
                        var unpublished = msg["unpublished"];
                        Janus.log("Publisher left: " + unpublished);
                        if (unpublished === 'ok') {
                          // That's us
                          config.videoRoomHandler.hangup();
                          return;
                        }
                        var remoteFeed = null;
                        for (var i = 1; i < 6; i++) {
                          if (config.feeds[i] != null && config.feeds[i] != undefined && config.feeds[i].rfid == unpublished) {
                            remoteFeed = config.feeds[i];
                            break;
                          }
                        }
                        if (remoteFeed != null) {
                          Janus.debug("Feed " + remoteFeed.rfid + " (" + remoteFeed.rfdisplay + ") has left the room, detaching");
                          config.feeds[remoteFeed.rfindex] = null;
                          remoteFeed.detach();
                        }
                      } else if (msg["error"] !== undefined && msg["error"] !== null) {
                        if (msg["error_code"] === 426) {
                          config.onError('The room is unavailable. Please create one.');
                        } else {
                          config.onError(msg["error"]);
                        }
                      }
                    }
                  }
                  if (jsep !== undefined && jsep !== null) {
                    Janus.debug("Handling SDP as well...");
                    Janus.debug(jsep);
                    config.videoRoomHandler.handleRemoteJsep({
                      jsep: jsep
                    });
                    // Check if any of the media we wanted to publish has
                    // been rejected (e.g., wrong or unsupported codec)
                    var audio = msg["audio_codec"];
                    if (config.mystream && config.mystream.getAudioTracks() && config.mystream.getAudioTracks().length > 0 && !audio) {
                      // Audio has been rejected
                      toastr.warning("Our audio stream has been rejected, viewers won't hear us");
                    }
                    var video = msg["video_codec"];
                    if (config.mystream && config.mystream.getVideoTracks() && config.mystream.getVideoTracks().length > 0 && !video) {
                      // Video has been rejected
                      toastr.warning("Our video stream has been rejected, viewers won't see us");
                    // Hide the webcam video
                    }
                  }
                },
                onlocalstream: function(stream) {
                  Janus.debug(" ::: Got a local stream :::");
                  config.mystream = window.mystream = stream; // attach to global for debugging purpose
                  Janus.debug(stream);
                  config.onLocalJoin();
                  if (config.onVolumeMeterUpdate) {
                    let ctx = new AudioContext();
                    let meter = volumeMeter(ctx, { tweenIn:2, tweenOut:6, skip:config.volumeMeterSkip}, (volume) => {
                      config.onVolumeMeterUpdate(0, volume);
                    });
                    let src = ctx.createMediaStreamSource(config.mystream);
                    src.connect(meter);
                    config.mystream.onended = meter.stop.bind(meter);
                  }
                },
                onremotestream: function(stream) {
                  // The publisher stream is sendonly, we don't expect anything here
                },
                ondataopen: function(data) {
                  console.log('ondataopen');
                },
                oncleanup: function() {
                  Janus.log(" ::: Got a cleanup notification: we are unpublished now :::");
                  config.mystream = null;
                }
              });

            if (config.useRecordPlugin) {
              // Attach to config.recordPlayHandler plugin
              config.janus.attach(
                {
                  plugin: "janus.plugin.recordplay",
                  opaqueId: config.opaqueId,
                  success: function(pluginHandle) {
                    config.recordPlayHandler = pluginHandle;
                    Janus.log("Plugin attached! (" + config.recordPlayHandler.getPlugin() + ", id=" + config.recordPlayHandler.getId() + ")");
                  // Now ready for recording. See startRecording()
                  },
                  error: function(error) {
                    Janus.error("  -- Error attaching plugin...", error);
                    onError(error)
                  },
                  consentDialog: function(on) {
                    // Handle consentDialog
                  },
                  webrtcState: function(on) {
                    Janus.log("Janus says our WebRTC PeerConnection is " + (on ? "up" : "down") + " now");
                  },
                  onmessage: function(msg, jsep) {
                    Janus.debug(" ::: Got a message :::");
                    Janus.debug(msg);
                    var result = msg["result"];
                    if (result !== null && result !== undefined) {
                      if (result["status"] !== undefined && result["status"] !== null) {
                        var event = result["status"];
                        if (event === 'preparing' || event === 'refreshing') {
                          Janus.log("Preparing the recording playout");
                          config.recordPlayHandler.createAnswer(
                            {
                              jsep: jsep,
                              media: {
                                audioSend: false,
                                videoSend: false
                              }, // We want recvonly audio/video
                              success: function(jsep) {
                                Janus.debug("Got SDP!");
                                Janus.debug(jsep);
                                var body = {
                                  "request": "start"
                                };
                                config.recordPlayHandler.send({
                                  "message": body,
                                  "jsep": jsep
                                });
                              },
                              error: function(error) {
                                Janus.error("WebRTC error:", error);
                                alert(JSON.stringify(error));
                              }
                            });
                          if (result["warning"]) {
                            alert(result["warning"]);
                          }
                        } else if (event === 'recording') {
                          // Got an ANSWER to our recording OFFER
                          if (jsep !== null && jsep !== undefined) {
                            config.recordPlayHandler.handleRemoteJsep({
                              jsep: jsep
                            });
                          }
                          var id = result["id"];
                          if (id !== null && id !== undefined) {
                            Janus.log("The ID of the current recording is " + id);
                            config.recordingId = id;
                          }
                        } else if (event === 'slow_link') {
                          var uplink = result["uplink"];
                          if (uplink !== 0) {
                            // Janus detected issues when receiving our media, let's slow down
                            let bandwidth = parseInt(bandwidth / 1.5);
                            config.recordPlayHandler.send({
                              'message': {
                                'request': 'configure',
                                'video-bitrate-max': bandwidth, // Reduce the bitrate
                                'video-keyframe-interval': 15000 // Keep the 15 seconds key frame interval
                              }
                            });
                          }
                        } else if (event === 'stopped') {
                          Janus.log("Session has stopped!");
                          var id = result["id"];
                          if (config.recordingId !== null && config.recordingId !== undefined) {
                            if (config.recordingId !== id) {
                              Janus.warn("Not a stop to our recording?");
                              return;
                            }
                            alert('Recording completed! Check the list of recordings to replay it.')
                          }
                        // TODO reset recording session
                        }
                      }
                    } else {
                      // FIXME Error?
                      var error = msg["error"];
                      alert(error)
                    //updateRecsList();
                    }
                  },
                  onlocalstream: function(stream) {
                    Janus.debug(" ::: Got a local stream :::");
                    Janus.debug(stream);
                    config.onRecordedPlay()
                  },
                  onremotestream: function(stream) {
                    config.recordedplaystream = stream;
                    Janus.debug(" ::: Got a remote stream :::");
                    Janus.debug(stream);
                    config.onRecordedPlay()
                  },
                  oncleanup: function() {
                    Janus.log(" ::: Got a cleanup notification :::");
                  // TODO reset recording session
                  }
                });

            }
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

function newRemoteFeed(id, display, audio, video) {
  // A new feed has been published, create a new plugin handle and attach to it as a subscriber
  var remoteFeed = null;
  config.janus.attach(
    {
      plugin: "janus.plugin.videoroom",
      opaqueId: config.opaqueId,
      success: function(pluginHandle) {
        remoteFeed = pluginHandle;
        remoteFeed.simulcastStarted = false;
        Janus.log("Plugin attached! (" + remoteFeed.getPlugin() + ", id=" + remoteFeed.getId() + ")");
        Janus.log("  -- This is a subscriber");
        // We wait for the plugin to send us an offer
        var listen = {
          "request": "join",
          "room": config.room,
          "ptype": "subscriber",
          "feed": id,
          "private_id": config.mypvtid
        };
        if (config.token) listen.token = config.token;
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
          "request": "setup",
        }
        if (config.token) body.token = config.token;
        pluginHandle.send({
          "message": body
        });

      },
      error: function(error) {
        Janus.error("  -- Error attaching plugin...", error);
        config.onError("Error attaching plugin... " + error);
      },
      onmessage: function(msg, jsep) {
        Janus.debug(" ::: Got a message (subscriber) :::");
        Janus.debug(msg);
        var event = msg["videoroom"];
        Janus.debug("Event: " + event);
        if (msg["error"] !== undefined && msg["error"] !== null) {
          config.onError(msg["error"]);
        } else if (event != undefined && event != null) {
          if (event === "attached") {
            // Subscriber created and attached
            for (var i = 1; i < 6; i++) {
              if (config.feeds[i] === undefined || config.feeds[i] === null) {
                config.feeds[i] = remoteFeed;
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
                  "room": config.room
                };
                if (config.token) body.token = config.token;
                remoteFeed.send({
                  "message": body,
                  "jsep": jsep
                });
              },
              error: function(error) {
                Janus.error("WebRTC error:", error);
                config.onError("WebRTC error... " + JSON.stringify(error));
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
          config.onMessage(data);
        } catch ( err ) {
          config.onMessage({
            error: `Failed to parse JSON : ${err}`
          });
        }
      },
      onremotestream: function(stream) {
        Janus.debug("Remote feed #" + remoteFeed.rfindex);
        config.remotestreams[remoteFeed.rfindex] = stream;
        config.onRemoteJoin(remoteFeed.rfindex, remoteFeed.rfdisplay);
        if (config.onVolumeMeterUpdate) {
          let ctx = new AudioContext();
          let meter = volumeMeter(ctx, { tweenIn:2, tweenOut:6, skip:config.volumeMeterSkip}, (volume) => {
            config.onVolumeMeterUpdate(remoteFeed.rfindex, volume);
          });
          let src = ctx.createMediaStreamSource(config.remotestreams[remoteFeed.rfindex]);
          src.connect(meter);
          src.connect(ctx.destination);
          config.remotestreams[remoteFeed.rfindex].onended = meter.stop.bind(meter);
        }
      },
      oncleanup: function() {
        Janus.log(" ::: Got a cleanup notification (remote feed " + id + ") :::");
        if (remoteFeed.spinner !== undefined && remoteFeed.spinner !== null) {
          remoteFeed.spinner.stop();
        }
        remoteFeed.spinner = null;
        delete (config.remotestreams[remoteFeed.rfindex]);
        config.onRemoteUnjoin(remoteFeed.rfindex, remoteFeed.rfdisplay);
      }
    });
}

var doSimulcast = (getQueryStringValue("simulcast") === "yes" || getQueryStringValue("simulcast") === "true");

class Room {

  constructor(options) {
    // Make sure the entire configuration get flushed first
    config = {
      remotestreams: {},
      feeds: [],
      bitrateTimer: []
    }
    // Assign the values
    config.server = options.server || null;
    config.opaqueId = "videoroomtest-" + Janus.randomString(12);
    config.room = options.room || null;
    config.extensionId = options.extensionId || null;
    config.token = options.token || null;
    config.useRecordPlugin = options.useRecordPlugin || false;
    config.volumeMeterSkip = options.volumeMeterSkip || 0;
    // Events
    config.onLocalJoin = options.onLocalJoin || null;
    config.onRemoteJoin = options.onRemoteJoin || null;
    config.onRemoteUnjoin = options.onRemoteUnjoin || null;
    config.onRecordedPlay = options.onRecordedPlay || null;
    config.onMessage = options.onMessage || null;
    config.onDestroyed = options.onDestroyed || null;
    config.onError = options.onError || null;
    config.onVolumeMeterUpdate = options.onVolumeMeterUpdate || null;
  }


  init() {
    return new Promise((resolve, reject) => {
      try {
        if (!config.server) {
          throw 'server value is needed.';
        }
        Janus.init({
          debug: "all",
          extensionId: config.extensionId,
          callback: function() {
            start()
              .then(() => {
                resolve();
              })
              .catch((err) => {
                reject(err);
              });
          }
        });
      } catch ( err ) {
        reject(err);
      }
    });
  }

  stop() {
    if (config.janus) {
      this.stopRecording();
      // Make sure the webcam and microphone got turned off first
      if (config.mystream) {
        let tracks = config.mystream.getTracks();
        for (let i in tracks) {
          if (tracks[i]) {
            tracks[i].stop();
          }
        }
      }
      // Destroy the session
      config.janus.destroy();
    }
  }

  register(options) {
    new Promise((resolve, reject) => {
      try {
        if (!options || (options && !options.username)) {
          throw 'username value is needed.';
        }
        if (!options || (options && !options.room)) {
          throw 'room value is needed.';
        }
        config.username = options.username || config.username;
        config.room = options.room || config.room;
        var register = {
          "request": "join",
          "room": config.room,
          "ptype": "publisher",
          "display": config.username
        };
        if (config.token) register.token = config.token;
        config.videoRoomHandler.send({
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
        let muted = config.videoRoomHandler.isAudioMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
        if (muted) {
          config.videoRoomHandler.unmuteAudio();
        } else {
          config.videoRoomHandler.muteAudio();
        }
        resolve(config.videoRoomHandler.isAudioMuted());
      } catch ( err ) {
        reject(err);
      }
    });
  }

  toggleMuteVideo() {
    return new Promise((resolve, reject) => {
      try {
        let muted = config.videoRoomHandler.isVideoMuted();
        Janus.log((muted ? "Unmuting" : "Muting") + " local stream...");
        if (muted) {
          config.videoRoomHandler.unmuteVideo();
        } else {
          config.videoRoomHandler.muteVideo();
        }
        resolve(config.videoRoomHandler.isVideoMuted());
      } catch ( err ) {
        reject(err);
      }
    });
  }

  sendMessage(data) {
    return new Promise((resolve, reject) => {
      try {
        config.videoRoomHandler.data({
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
          Janus.attachMediaStream(target, config.mystream);
        } else {
          Janus.attachMediaStream(target, config.remotestreams[index]);
        }
        resolve();
      } catch ( err ) {
        reject(err);
      }
    });
  }

  isShareScreenStream(index) {
    return new Promise((resolve, reject) => {
      var res = false;
      var tracks;
      try {
        if (index === 0) {
          tracks = config.mystream.getVideoTracks()
        } else if (config.remotestreams[index]) {
          tracks = config.remotestreams[index].getVideoTracks()
        }
        if (tracks && tracks[0] && tracks[0].label &&
          // Video tracks from webcam got labeled as "Integrated Camera" or "iSight"
          // TODO collect this label value from various browsers/devices
          (tracks[0].label.toLowerCase().indexOf('monitor') > -1 || // Firefox, "Primary Monitor"
          tracks[0].label.toLowerCase().indexOf('screen') > -1 // Chrome, "screen:0:0"
          )
        ) {
          res = true;
        }
        resolve(res)
      } catch ( err ) {
        reject(err);
      }
    });
  }

  attachRecordedPlayStream(target) {
    return new Promise((resolve, reject) => {
      try {
        Janus.attachMediaStream(target, config.recordedplaystream);
        resolve();
      } catch ( err ) {
        reject(err);
      }
    });
  }

  shareScreen() {
    return new Promise((resolve, reject) => {
      try {
        unpublishOwnFeed()
        setTimeout(() => {
          shareScreen((err) => {
            if (err) {
              reject(err)
              return;
            }
            resolve();
          });
        }, 500);
      } catch ( err ) {
        reject(err);
      }
    });
  }

  stopShareScreen() {
    return new Promise((resolve, reject) => {
      try {
        unpublishOwnFeed()
        setTimeout(() => {
          publishOwnFeed({
            audioSend: true,
            replaceVideo: true,
            replaceAudio: true,
          }, () => {
            resolve()
          });
        }, 500);
      } catch ( err ) {
        reject(err);
      }
    });
  }

  publishOwnFeed(opts, cb) {
    publishOwnFeed(opts, cb);
  }

  unpublishOwnFeed() {
    unpublishOwnFeed();
  }

  newRemoteFeed(id, display, audio, video) {
    newRemoteFeed(id, display, audio, video);
  }

  createRoom(options) {
    return new Promise((resolve, reject) => {
      try {
        options = options || {}
        config.room = options.room || null
        // TODO handle room's secret
        var body = {
          "request": "create",
          "room": config.room,
        };
        if (config.token) body.token = config.token;
        config.videoRoomHandler.send({
          "message": body,
        });
        // TODO catch the response
        resolve();
      } catch ( err ) {
        reject(err);
      }
    });
  }

  removeRoom() {
    return new Promise((resolve, reject) => {
      try {
        // TODO handle room's secret
        var body = {
          "request": "destroy",
          "room": config.room,
        };
        if (config.token) body.token = config.token;
        config.videoRoomHandler.send({
          "message": body,
        });
        resolve();
      } catch ( err ) {
        reject(err);
      }
    });
  }

  getRecordedList() {
    return new Promise((resolve, reject) => {
      var body = {
        "request": "list"
      };
      Janus.debug("Sending message (" + JSON.stringify(body) + ")");
      config.recordPlayHandler.send({
        "message": body,
        success: function(result) {
          resolve(result);
        },
        error: function(err) {
          reject(err);
        }
      });
    });
  }

  stopPlayback() {
    return stopPlayback()
  }

  recordedPlayback(recordId) {
    return new Promise((resolve, reject) => {
      var play = {
        "request": "play",
        "id": parseInt(recordId, 10)
      };
      if (config.recordedplaystream) {
        let tracks = config.recordedplaystream.getTracks();
        for (let i in tracks) {
          if (tracks[i]) {
            tracks[i].stop();
          }
        }
        config.recordedplaystream = null;
        stopPlayback()
          .then(() => {
            config.recordPlayHandler.send({
              "message": play,
              success: function() {
                resolve();
              },
              error: function(err) {
                reject(err);
              }
            });
          })
          .catch((err) => {
            reject(err);
          });
      } else {
        config.recordPlayHandler.send({
          "message": play,
          success: function() {
            resolve();
          },
          error: function(err) {
            reject(err);
          }
        });
      }
    });
  }

  startRecording(options) {
    return startRecording(options)
  }

  stopRecording() {
    return new Promise((resolve, reject) => {
      if (config.recordPlayHandler) {
        var stop = {
          "request": "stop"
        };
        config.recordPlayHandler.send({
          "message": stop,
          success: function() {
            resolve();
          },
          error: function(err) {
            reject(err);
          }
        });
      }
    });
  }
  getStream(streamIndex) {
    return new Promise((resolve, reject) => {
      try {
        if (streamIndex === 0) {
          resolve(config.mystream);
        } else {
          resolve(config.remotestreams[streamIndex]);
        }
      } catch(e) {
        reject(e);
      }
    });
  }

  // TODO Fix me.
  // Helpers to create Simulcast-related UI, if enabled
  addSimulcastButtons(feed, temporal) {}

  updateSimulcastButtons(feed, substream, temporal) {}

}

module.exports = Room;
