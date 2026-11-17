import * as THREE from 'three';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 5);

scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(3, 4, 5);
scene.add(light);

// Placeholder object — will be replaced with the real scene.
const mesh = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.2, 1),
  new THREE.MeshStandardMaterial({ color: 0x6c8cff, flatShading: true })
);
scene.add(mesh);

function resize() {
  const { innerWidth: w, innerHeight: h } = window;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop((t) => {
  mesh.rotation.x = t * 0.0002;
  mesh.rotation.y = t * 0.0003;
  renderer.render(scene, camera);
});
