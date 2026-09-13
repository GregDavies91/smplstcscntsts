export class Network {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.roomId = null;
    this.peerId = null;
    this.handlers = {};
  }
  
  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
  }
  
  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(h => h(data));
    }
  }
  
  join(roomId, name, password) {
    this.roomId = roomId;
    this.peerId = name + '-' + Math.random().toString(36).slice(2, 8);
    
    this.ws = new WebSocket(this.serverUrl);
    
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'join',
        roomId: this.roomId,
        peerId: this.peerId,
        password: password || null
      }));
    };
    
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'joined':
          this.emit('joined', msg.peers);
          break;
        case 'peer-joined':
          this.emit('peer-joined', msg.peerId);
          break;
        case 'peer-left':
          this.emit('peer-left', msg.peerId);
          break;
        case 'signal':
          this.emit('signal', { from: msg.from, signal: msg.signal });
          break;
        case 'error':
          this.emit('error', msg.reason);
          break;
      }
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from signaling server');
    };
  }
  
  sendSignal(peerId, signal) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'signal',
        target: peerId,
        signal: signal
      }));
    }
  }
}
