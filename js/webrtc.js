'use strict';
const clientIdP = document.getElementById('clientId');
const peerConnectionStatusP = document.getElementById('peerConnectionStatus');
const calleeIdInput = document.getElementById('calleeIdInput');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 1,
};

calleeIdInput.disabled = false;
callButton.disabled = false;
hangupButton.disabled = true;

let startTime;
let localStream;
let peerConnection;

const CLIENT_ID_EVENT = 'client-id-event';
const OFFER_EVENT = 'offer-event';
const ANSWER_EVENT = 'answer-event';
const ICE_CANDIDATE_EVENT = 'ice-candidate-event';

let currentClientId = null;
let calleeId = null;
let initLocalMedia = false;

const socket = io('https://socket-webrtc.herokuapp.com');

socket.on('connect', function() {
  console.log('Connected');

  socket.on(CLIENT_ID_EVENT, function(_clientId) {
    console.log(CLIENT_ID_EVENT, _clientId);
    currentClientId = _clientId;
    clientIdP.innerHTML = `Client ID: ${_clientId}`;
  });

  socket.on(OFFER_EVENT, async (description) => {
    console.log(OFFER_EVENT, description);
    // Auto start get local media
    if (!initLocalMedia) {
      await loadLocalMedia();
    }

    console.log('Created remote peer connection object');
    createPeerConnection();

    // Set remote offer
    console.log('setRemoteDescription start');
    try {
      await peerConnection.setRemoteDescription(description);
      console.log(`setRemoteDescription complete`);
    } catch (e) {
      onSetSessionDescriptionError(e);
    }

    console.log(currentClientId + ' createAnswer start');
    // Since the 'remote' side has no media stream we need
    // to pass in the right constraints in order for it to
    // accept the incoming offer of audio and video.
    try {
      const answer = await peerConnection.createAnswer();
      await onCreateAnswerSuccess(answer);
      emitAnswerEvent(answer);
    } catch (e) {
      onCreateSessionDescriptionError(e);
    }
  });

  socket.on(ANSWER_EVENT, async (description) => {
    console.log(ANSWER_EVENT, description);
    console.log('setRemoteDescription start');
    try {
      await peerConnection.setRemoteDescription(description);
      console.log(`setRemoteDescription complete`);
    } catch (e) {
      onSetSessionDescriptionError(e);
    }
  });

  socket.on(ICE_CANDIDATE_EVENT, async (candidate) => {
    console.log(ICE_CANDIDATE_EVENT, candidate);
    try {
      await peerConnection.addIceCandidate(candidate);
      console.log(`peerConnection addIceCandidate success`);
    } catch (e) {
      onAddIceCandidateError(e);
    }
    console.log(
      `ICE candidate:\n${candidate ? candidate.candidate : '(null)'}`
    );
  });

  socket.on('exception', function(exception) {
    console.log('exception', exception);
  });
  socket.on('disconnect', function() {
    console.log('Disconnected');
  });
});

function emitOfferEvent(peerId, description) {
  if (socket && socket.connected) {
    socket.emit(OFFER_EVENT, { peerId: peerId, description: description });
  }
}

function emitAnswerEvent(description) {
  if (socket && socket.connected) {
    socket.emit(ANSWER_EVENT, { description: description });
  }
}

function emitIceCandidateEvent(isHost, candidate) {
  if (socket && socket.connected) {
    socket.emit(ICE_CANDIDATE_EVENT, { isHost: isHost, candidate: candidate });
  }
}

localVideo.addEventListener('loadedmetadata', function() {
  console.log(
    `Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`
  );
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(
    `Remote video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`
  );
});

remoteVideo.addEventListener('resize', () => {
  console.log(
    `Remote video size changed to ${remoteVideo.videoWidth}x${remoteVideo.videoHeight}`
  );
  if (startTime) {
    const elapsedTime = window.performance.now() - startTime;
    console.log('Setup time: ' + elapsedTime.toFixed(3) + 'ms');
    startTime = null;
  }
});

async function loadLocalMedia() {
  console.log('Requesting local stream');
  try {
    if (navigator.mediaDevices === undefined) {
      navigator.mediaDevices = {};
    }

    if (navigator.mediaDevices.getUserMedia === undefined) {
      navigator.mediaDevices.getUserMedia = function(constraints) {
        let getUserMedia =
          navigator.mozGetUserMedia ||
          navigator.webkitGetUserMedia ||
          navigator.msGetUserMedia;

        if (!getUserMedia) {
          return Promise.reject(
            new Error('getUserMedia is not implemented in this browser')
          );
        }

        return new Promise(function(resolve, reject) {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      };
    }

    // const constraints = { audio: true, video: true };
    const constraints = { audio: true, video: { facingMode: 'user' } };
    // const constraints = {audio: true, video: {facingMode: {exact: "environment"}}};
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('Received local stream');
    localVideo.srcObject = stream;
    localStream = stream;
  } catch (e) {
    alert(`getUserMedia() error: ${e.message}`);
    console.error(e);
  }
  initLocalMedia = true;
}

function createPeerConnection() {
  startTime = window.performance.now();

  peerConnection = new RTCPeerConnection({});
  peerConnection.addEventListener('icecandidate', (e) => onIceCandidate(e));
  peerConnection.addEventListener('iceconnectionstatechange', (e) =>
    onIceStateChange(e)
  );
  peerConnection.addEventListener('track', gotRemoteStream);

  if (localStream) {
    const videoTracks = localStream.getVideoTracks();
    const audioTracks = localStream.getAudioTracks();
    if (videoTracks.length > 0) {
      console.log(`Using video device: ${videoTracks[0].label}`);
    }
    if (audioTracks.length > 0) {
      console.log(`Using audio device: ${audioTracks[0].label}`);
    }
    localStream
      .getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));
  }
  console.log('Added local stream');
}

function onCreateSessionDescriptionError(error) {
  console.log(`Failed to create session description: ${error.toString()}`);
}

async function onCreateOfferSuccess(desc) {
  console.log(`Offer from local`, desc);
  console.log('setLocalDescription start');
  try {
    await peerConnection.setLocalDescription(desc);
    console.log(`setLocalDescription complete`);
    emitOfferEvent(calleeId, desc);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
}

function onSetSessionDescriptionError(error) {
  console.log(`Failed to set session description: ${error.toString()}`);
}

async function onCreateAnswerSuccess(desc) {
  console.log(`Answer from peer:`, desc);
  console.log('Peer setLocalDescription start');
  try {
    await peerConnection.setLocalDescription(desc);
    console.log(`peerConnection setLocalDescription complete`);
  } catch (e) {
    onSetSessionDescriptionError(e);
  }
}

async function onIceCandidate(event) {
  try {
    emitIceCandidateEvent(!(calleeId == null), event.candidate);
    console.log(
      `${!(calleeId == null)} peerConnection addIceCandidate success`
    );
  } catch (e) {
    onAddIceCandidateError(e);
  }
  console.log(
    `peerConnection ICE candidate:\n${
      event.candidate ? event.candidate.candidate : '(null)'
    }`
  );
}

function onAddIceCandidateError(error) {
  console.log(
    `peerConnection failed to add ICE Candidate: ${error.toString()}`
  );
}

function onIceStateChange(event) {
  if (peerConnection) {
    // checking, connected, disconnected
    peerConnectionStatusP.innerHTML = peerConnection.iceConnectionState;
    console.log(
      `peerConnection ICE state: ${peerConnection.iceConnectionState}`
    );
    console.log('ICE state change event: ', event);
    if (peerConnection.iceConnectionState === 'disconnected') {
      peerConnection.close();
      peerConnection = null;
      remoteVideo.srcObject = null;
      hangup();
    } else if (peerConnection.iceConnectionState === 'connected') {
      callButton.disabled = true;
      calleeIdInput.disabled = true;
      hangupButton.disabled = false;
    }
  }
}

function gotRemoteStream(e) {
  const remoteStream = e.streams[0];
  if (remoteVideo.srcObject !== remoteStream) {
    remoteVideo.srcObject = remoteStream;
    remoteStream
      .getTracks()
      .forEach((track) => peerConnection.addTrack(track, remoteStream));
    console.log('peerConnection received remote stream');
  }
}

callButton.addEventListener('click', call);
hangupButton.addEventListener('click', hangup);

async function call() {
  console.log('Starting call');
  if (!initLocalMedia) {
    await loadLocalMedia();
  }

  calleeId = calleeIdInput.value;
  console.log('Created local peer connection object');
  createPeerConnection();

  try {
    console.log('CreateOffer start');
    const offer = await peerConnection.createOffer(offerOptions);
    await onCreateOfferSuccess(offer);
  } catch (e) {
    onCreateSessionDescriptionError(e);
  }
}

function hangup() {
  console.log('Ending call');
  try {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    calleeId = null;
    remoteVideo.srcObject = null;
    // Reset control state
    calleeIdInput.disabled = false;
    callButton.disabled = false;
    hangupButton.disabled = true;
  } catch (e) {
    console.error(e);
  }
}
