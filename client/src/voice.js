export class VoiceChat {
  constructor() {
    this.localStream = null;
    this.onLocalStream = null;
  }
  
  async init() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      if (this.onLocalStream) {
        this.onLocalStream(this.localStream);
      }
    } catch (err) {
      console.warn('Microphone access denied:', err);
    }
  }
  
  getLocalStream() {
    return this.localStream;
  }
  
  toggleMute() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return audioTrack.enabled;
      }
    }
    return false;
  }
}
