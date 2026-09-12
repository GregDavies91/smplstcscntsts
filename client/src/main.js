import * as THREE from 'three';
import { World } from './world.js';
import { Network } from './network.js';
import { VoiceChat } from './voice.js';
import { ModelImporter } from './modelImporter.js';

const SIGNALING_SERVER = import.meta.env.VITE_SIGNALING_SERVER || 'ws://localhost:8080';

class App {
  constructor() {
    this.world = new World();
    this.network = new Network(SIGNALING_SERVER);
    this.voice = new VoiceChat();
    this.importer = new ModelImporter(this.world);
    this.peers = new Map(); // peerId -> { connection, audioEl, mesh }
    
    this.setupNetwork();
    this.setupUI();
  }
  
  setupNetwork() {
    this.network.on('joined', (peers) => {
      document.getElementById('join-modal').style.display = 'none';
      document.getElementById('room-display').textContent = `Room: ${this.network.roomId}`;
      
      // Initiate connections to all existing peers
      for (const peerId of peers) {
        this.createPeerConnection(peerId, true);
      }
    });
    
    this.network.on('peer-joined', (peerId) => {
      // Someone new joined — they'll initiate, but we also create the data channel
      this.createPeerConnection(peerId, false);
      this.addPeerToList(peerId);
    });
    
    this.network.on('peer-left', (peerId) => {
      this.removePeer(peerId);
    });
    
    this.network.on('signal', async ({ from, signal }) => {
      let pc = this.peers.get(from)?.connection;
      if (!pc) {
        pc = this.createPeerConnection(from, false);
      }
      
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(signal);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.network.sendSignal(from, answer);
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(signal);
      } else if (signal.candidate) {
        await pc.addIceCandidate(signal);
      }
    });
  }
  
  createPeerConnection(peerId, isInitiator) {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };
    
    const pc = new RTCPeerConnection(config);
    
    // Create mesh for this peer
    const mesh = this.world.createPeerMesh(peerId);
    
    const peerData = { connection: pc, mesh, isInitiator };
    this.peers.set(peerId, peerData);
    
    // ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.network.sendSignal(peerId, e.candidate);
      }
    };
    
    // Data channel for position updates
    if (isInitiator) {
      const channel = pc.createDataChannel('position');
      this.setupDataChannel(channel, peerData);
    } else {
      pc.ondatachannel = (e) => {
        this.setupDataChannel(e.channel, peerData);
      };
    }
    
    // Audio track for voice
    pc.ontrack = (e) => {
      const audio = new Audio();
      audio.srcObject = e.streams[0];
      audio.autoplay = true;
      peerData.audioEl = audio;
      peerData.audioStream = e.streams[0];
      this.updatePeerVolume(peerId);
    };
    
    // If initiator, create offer
    if (isInitiator) {
      this.initiateCall(peerId, pc);
    }
    
    this.addPeerToList(peerId);
    return pc;
  }
  
  async initiateCall(peerId, pc) {
    // Add our local audio track
    const stream = this.voice.getLocalStream();
    if (stream) {
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.network.sendSignal(peerId, offer);
  }
  
  setupDataChannel(channel, peerData) {
    peerData.channel = channel;
    
    channel.onopen = () => {
      peerData.connected = true;
      // Start sending position updates
      this.startPositionUpdates(peerData);
    };
    
    channel.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'position') {
          this.world.updatePeerMesh(peerData.mesh, data.pos, data.rot);
        }
      } catch {}
    };
  }
  
  startPositionUpdates(peerData) {
    const send = () => {
      if (!peerData.connected) return;
      const pos = this.world.getPlayerPosition();
      const rot = this.world.getPlayerRotation();
      peerData.channel.send(JSON.stringify({
        type: 'position',
        pos, rot
      }));
      setTimeout(send, 50); // 20 updates/sec
    };
    send();
  }
  
  updatePeerVolume(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer?.audioEl) return;
    
    const myPos = this.world.getPlayerPosition();
    const peerPos = peer.mesh.position;
    const dist = myPos.distanceTo(peerPos);
    
    // Proximity: full volume at 0m, silent at 20m
    const maxDist = 20;
    const volume = Math.max(0, 1 - (dist / maxDist));
    peer.audioEl.volume = volume * volume; // quadratic falloff
  }
  
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connection.close();
      this.world.removePeerMesh(peer.mesh);
      this.peers.delete(peerId);
    }
    this.removePeerFromList(peerId);
  }
  
  addPeerToList(peerId) {
    const list = document.getElementById('peers-list');
    const div = document.createElement('div');
    div.className = 'peer';
    div.id = `peer-${peerId}`;
    div.textContent = `● ${peerId}`;
    list.appendChild(div);
  }
  
  removePeerFromList(peerId) {
    const el = document.getElementById(`peer-${peerId}`);
    if (el) el.remove();
  }
  
  setupUI() {
    const joinBtn = document.getElementById('join-btn');
    joinBtn.addEventListener('click', () => {
      const roomId = document.getElementById('room-input').value.trim();
      const name = document.getElementById('name-input').value.trim() || 'Player';
      if (roomId) {
        this.join(roomId, name);
      }
    });
    
    // Update volumes periodically
    setInterval(() => {
      for (const [peerId] of this.peers) {
        this.updatePeerVolume(peerId);
      }
    }, 100);
  }
  
  async join(roomId, name) {
    this.voice.onLocalStream = (stream) => {
      // Add track to all existing peer connections
      for (const [, peer] of this.peers) {
        if (peer.connection.connectionState === 'connected') {
          stream.getTracks().forEach(track => {
            peer.connection.addTrack(track, stream);
          });
        }
      }
      document.getElementById('mic-indicator').classList.remove('muted');
    };
    
    await this.voice.init();
    this.network.join(roomId, name);
  }
}

// Start
const app = new App();
window.__app = app; // for debugging
