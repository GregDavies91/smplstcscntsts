import * as THREE from 'three';

export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.Fog(0x1a1a2e, 30, 80);
    
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 1.7, 0);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    document.getElementById('app').appendChild(this.renderer.domElement);
    
    this.setupLighting();
    this.setupEnvironment();
    this.setupControls();
    
    this.peerMeshes = new Map();
    
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    
    this.animate();
  }
  
  setupLighting() {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);
    
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    this.scene.add(dir);
    
    // Some point lights for atmosphere
    const colors = [0x6366f1, 0x8b5cf6, 0xec4899];
    colors.forEach((c, i) => {
      const light = new THREE.PointLight(c, 2, 15);
      light.position.set(Math.cos(i * 2.1) * 8, 3, Math.sin(i * 2.1) * 8);
      this.scene.add(light);
    });
  }
  
  setupEnvironment() {
    // Ground
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    const groundMat = new THREE.MeshStandardMaterial({ 
      color: 0x2d2d44,
      roughness: 0.9
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    
    // Grid
    const grid = new THREE.GridHelper(100, 50, 0x444466, 0x333355);
    grid.position.y = 0.01;
    this.scene.add(grid);
    
    // Scatter some pillars as landmarks
    for (let i = 0; i < 20; i++) {
      const h = 2 + Math.random() * 4;
      const geo = new THREE.BoxGeometry(1, h, 1);
      const mat = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color().setHSL(Math.random() * 0.2 + 0.6, 0.5, 0.3),
        roughness: 0.7
      });
      const pillar = new THREE.Mesh(geo, mat);
      pillar.position.set(
        (Math.random() - 0.5) * 60,
        h / 2,
        (Math.random() - 0.5) * 60
      );
      this.scene.add(pillar);
    }
    
    // A central platform
    const platformGeo = new THREE.CylinderGeometry(3, 3, 0.3, 32);
    const platformMat = new THREE.MeshStandardMaterial({ 
      color: 0x6366f1,
      emissive: 0x2a2a50,
      roughness: 0.3
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = 0.15;
    this.scene.add(platform);
  }
  
  setupControls() {
    this.keys = {};
    this.yaw = 0;
    this.pitch = 0;
    this.isLocked = false;
    
    document.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    
    document.addEventListener('click', () => {
      if (!this.isLocked) {
        document.body.requestPointerLock();
      }
    });
    
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === document.body;
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.yaw -= e.movementX * 0.002;
      this.pitch -= e.movementY * 0.002;
      this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));
    });
    
    this.velocity = new THREE.Vector3();
  }
  
  update() {
    const speed = 4;
    const dt = 1 / 60;
    
    // Movement direction based on yaw
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    
    const moveDir = new THREE.Vector3();
    if (this.keys['KeyW']) moveDir.add(forward);
    if (this.keys['KeyS']) moveDir.sub(forward);
    if (this.keys['KeyD']) moveDir.add(right);
    if (this.keys['KeyA']) moveDir.sub(right);
    
    if (moveDir.length() > 0) {
      moveDir.normalize().multiplyScalar(speed * dt);
      this.camera.position.add(moveDir);
    }
    
    // Keep at eye height
    this.camera.position.y = 1.7;
    
    // Apply rotation
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
  
  animate() {
    requestAnimationFrame(() => this.animate());
    this.update();
    this.renderer.render(this.scene, this.camera);
  }
  
  createPeerMesh(peerId) {
    const group = new THREE.Group();
    
    // Body
    const bodyGeo = new THREE.CapsuleGeometry(0.4, 1, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ 
      color: new THREE.Color().setHSL(Math.random(), 0.6, 0.5)
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    group.add(body);
    
    // Head
    const headGeo = new THREE.SphereGeometry(0.3, 16, 16);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.7;
    group.add(head);
    
    // Name label (simple sprite)
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 28px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(peerId, 128, 42);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 2.3;
    sprite.scale.set(2, 0.5, 1);
    group.add(sprite);
    
    this.scene.add(group);
    this.peerMeshes.set(peerId, group);
    return group;
  }
  
  updatePeerMesh(mesh, pos, rot) {
    if (!mesh) return;
    mesh.position.set(pos.x, pos.y, pos.z);
    if (rot) {
      mesh.rotation.set(rot.x, rot.y, rot.z);
    }
  }
  
  removePeerMesh(mesh) {
    if (mesh) {
      this.scene.remove(mesh);
    }
  }
  
  getPlayerPosition() {
    return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
  }
  
  getPlayerRotation() {
    return { x: this.camera.rotation.x, y: this.camera.rotation.y, z: this.camera.rotation.z };
  }
}
