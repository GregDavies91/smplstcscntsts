import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ModelImporter {
  constructor(world) {
    this.world = world;
    this.loader = new GLTFLoader();
    this.placedModels = [];
    this.pendingModel = null;
    this.placementMode = false;
    
    this.setupDragDrop();
    this.setupPlacementControls();
  }
  
  setupDragDrop() {
    const app = document.getElementById('app');
    
    app.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    
    app.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      for (const file of files) {
        if (file.name.match(/\.(glb|gltf)$/i)) {
          this.loadModel(file);
        }
      }
    });
    
    // Also support file picker via key 'I'
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyI' && !e.repeat) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.glb,.gltf';
        input.onchange = (ev) => {
          if (ev.target.files[0]) {
            this.loadModel(ev.target.files[0]);
          }
        };
        input.click();
      }
    });
  }
  
  loadModel(file) {
    const url = URL.createObjectURL(file);
    
    this.loader.load(url, (gltf) => {
      const model = gltf.scene;
      
      // Normalize scale — fit within 2 units
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      model.scale.setScalar(scale);
      
      // Center it
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center.multiplyScalar(scale));
      model.position.y += size.y * scale / 2;
      
      // Enable shadows
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      this.pendingModel = { model, name: file.name };
      this.placementMode = true;
      
      // Show placement UI
      this.showPlacementUI();
      
      URL.revokeObjectURL(url);
    });
  }
  
  showPlacementUI() {
    let ui = document.getElementById('placement-ui');
    if (!ui) {
      ui = document.createElement('div');
      ui.id = 'placement-ui';
      ui.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(22, 33, 62, 0.95); border-radius: 12px; padding: 24px;
        color: #fff; font-family: system-ui; z-index: 200;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5); text-align: center;
      `;
      document.body.appendChild(ui);
    }
    ui.innerHTML = `
      <h3 style="margin-bottom: 12px;">Placing: ${this.pendingModel.name}</h3>
      <p style="opacity: 0.7; margin-bottom: 16px; font-size: 13px;">
        Move with WASD · Mouse to look · Click to place
      </p>
      <button id="place-confirm" style="
        padding: 10px 24px; border-radius: 8px; border: none;
        background: #6366f1; color: #fff; cursor: pointer;
        font-size: 14px; margin-right: 8px;
      ">Place Here</button>
      <button id="place-cancel" style="
        padding: 10px 24px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2);
        background: transparent; color: #fff; cursor: pointer; font-size: 14px;
      ">Cancel</button>
    `;
    ui.style.display = 'block';
    
    document.getElementById('place-confirm').onclick = () => this.confirmPlacement();
    document.getElementById('place-cancel').onclick = () => this.cancelPlacement();
  }
  
  confirmPlacement() {
    if (!this.pendingModel) return;
    
    // Place model at camera position offset forward
    const camera = this.world.camera;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const placePos = camera.position.clone().add(forward.multiplyScalar(3));
    placePos.y = 0;
    
    this.pendingModel.model.position.copy(placePos);
    this.world.scene.add(this.pendingModel.model);
    
    this.placedModels.push({
      model: this.pendingModel.model,
      name: this.pendingModel.name
    });
    
    this.exitPlacementMode();
  }
  
  cancelPlacement() {
    this.exitPlacementMode();
  }
  
  exitPlacementMode() {
    this.placementMode = false;
    this.pendingModel = null;
    const ui = document.getElementById('placement-ui');
    if (ui) ui.style.display = 'none';
  }
  
  setupPlacementControls() {
    // In placement mode, show a ghost preview at placement position
    document.addEventListener('click', () => {
      if (this.placementMode && this.pendingModel && this.world.isLocked) {
        this.confirmPlacement();
      }
    });
  }
  
  // Sync placed models to peers via the network
  getPlacedModelsData() {
    return this.placedModels.map(m => ({
      name: m.name,
      position: { x: m.model.position.x, y: m.model.position.y, z: m.model.position.z },
      rotation: { x: m.model.rotation.x, y: m.model.rotation.y, z: m.model.rotation.z },
      scale: m.model.scale.x
    }));
  }
}
