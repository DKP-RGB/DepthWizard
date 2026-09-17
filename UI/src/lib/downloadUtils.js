import * as THREE from 'three';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export function downloadCanvas(filename = 'depthwizard_render.png') {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function downloadMetadata(geoData, stats) {
  const data = { geoData, stats, generatedAt: new Date().toISOString() };
  saveString(JSON.stringify(data, null, 2), 'depthwizard_metadata.json');
}

export function saveString(text, filename) {
  save(new Blob([text], { type: 'text/plain' }), filename);
}

export function saveArrayBuffer(buffer, filename) {
  save(new Blob([buffer], { type: 'application/octet-stream' }), filename);
}

export function save(blob, filename) {
  const link = document.createElement('a');
  link.style.display = 'none';
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function downloadMesh(meshRef, format = 'obj') {
  if (!meshRef || !meshRef.current) return;
  const mesh = meshRef.current;
  
  if (format === 'obj') {
    const exporter = new OBJExporter();
    const result = exporter.parse(mesh);
    saveString(result, 'terrain_mesh.obj');
  } else if (format === 'glb') {
    const exporter = new GLTFExporter();
    exporter.parse(mesh, (gltf) => {
      saveArrayBuffer(gltf, 'terrain_mesh.glb');
    }, (err) => {
      console.error('GLTF Export error:', err);
    }, { binary: true });
  }
}

