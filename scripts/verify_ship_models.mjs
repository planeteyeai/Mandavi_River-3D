#!/usr/bin/env node
/**
 * Verify all ship model files exist and are accessible
 */
import { existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MODELS = [
  {
    name: 'Small Ship Detection Model',
    path: 'public/data/mandovi/Ships/Small_Ships/source/model.gltf',
    type: 'GLTF'
  },
  {
    name: 'Silja Serenade Casino Ship',
    path: 'src/data/silja-line-ms-silja-serenade-1990/source/SiljaSerenade.glb',
    type: 'GLB'
  },
  {
    name: 'MS Gabriella Casino Ship',
    path: 'src/data/viking-line-ms-gabriella-19922016/source/Gabriella2016.glb',
    type: 'GLB'
  },
  {
    name: 'Fishing Vessel VII',
    path: 'public/data/fishing-vessel-vii/Fishing Vessel VII.dae',
    type: 'DAE'
  }
];

const DATA_FILES = [
  {
    name: 'Ship Detections GeoJSON',
    path: 'public/data/mandovi/Ships/ship_detections_S1-20261105T054303-2bb1.geojson'
  },
  {
    name: 'Ship Detections KML',
    path: 'public/data/mandovi/Ships/ship_detections_S1-20261105T054303-2bb1.kml'
  },
  {
    name: 'Casino Ships KML',
    path: 'src/data/Casino Ship Kml.kml'
  }
];

console.log('🚢 Verifying Ship Model Files...\n');

let allValid = true;

console.log('📦 3D Model Files:');
for (const model of MODELS) {
  const fullPath = join(ROOT, model.path);
  const exists = existsSync(fullPath);
  
  if (exists) {
    const stats = statSync(fullPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`  ✓ ${model.name} (${model.type})`);
    console.log(`    Path: ${model.path}`);
    console.log(`    Size: ${sizeMB} MB\n`);
  } else {
    console.log(`  ✗ ${model.name} (${model.type}) - NOT FOUND`);
    console.log(`    Expected: ${model.path}\n`);
    allValid = false;
  }
}

console.log('📄 Data Files:');
for (const data of DATA_FILES) {
  const fullPath = join(ROOT, data.path);
  const exists = existsSync(fullPath);
  
  if (exists) {
    const stats = statSync(fullPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`  ✓ ${data.name}`);
    console.log(`    Path: ${data.path}`);
    console.log(`    Size: ${sizeKB} KB\n`);
  } else {
    console.log(`  ✗ ${data.name} - NOT FOUND`);
    console.log(`    Expected: ${data.path}\n`);
    allValid = false;
  }
}

if (allValid) {
  console.log('✅ All ship models and data files are present!\n');
  console.log('💡 Tips for deployment:');
  console.log('   - Vite will bundle GLB/GLTF files from src/ automatically');
  console.log('   - Files in public/ are served as-is');
  console.log('   - Make sure .dockerignore and .vercelignore don\'t exclude these files\n');
  process.exit(0);
} else {
  console.log('❌ Some files are missing! Check paths above.\n');
  process.exit(1);
}
