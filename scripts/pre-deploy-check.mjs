#!/usr/bin/env node
/**
 * Pre-deployment checklist for Mandavi River 3D
 */
import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('🚀 Pre-Deployment Checklist for Mandavi River 3D\n');

const checks = [];

// 1. Check ship models
console.log('1️⃣  Checking ship models...');
try {
  execSync('npm run verify:ships', { stdio: 'pipe' });
  checks.push({ name: 'Ship models', status: 'PASS', icon: '✅' });
} catch (error) {
  checks.push({ name: 'Ship models', status: 'FAIL', icon: '❌' });
}

// 2. Check configuration files
console.log('2️⃣  Checking configuration files...');
const configFiles = [
  'vite.config.js',
  'package.json',
  'Dockerfile',
  'docker-compose.yml',
  'nginx.conf',
  'vercel.json'
];
const missingConfigs = configFiles.filter(f => !existsSync(f));
if (missingConfigs.length === 0) {
  checks.push({ name: 'Configuration files', status: 'PASS', icon: '✅' });
} else {
  checks.push({ 
    name: 'Configuration files', 
    status: 'FAIL', 
    icon: '❌',
    details: `Missing: ${missingConfigs.join(', ')}`
  });
}

// 3. Check node_modules
console.log('3️⃣  Checking dependencies...');
if (existsSync('node_modules')) {
  checks.push({ name: 'Dependencies installed', status: 'PASS', icon: '✅' });
} else {
  checks.push({ 
    name: 'Dependencies installed', 
    status: 'FAIL', 
    icon: '❌',
    details: 'Run: npm install'
  });
}

// 4. Try to build
console.log('4️⃣  Testing build...');
try {
  execSync('npm run build', { stdio: 'pipe' });
  checks.push({ name: 'Build succeeds', status: 'PASS', icon: '✅' });
  
  // Check if models are in dist
  if (existsSync('dist/assets/models')) {
    checks.push({ name: 'Models in build output', status: 'PASS', icon: '✅' });
  } else {
    checks.push({ 
      name: 'Models in build output', 
      status: 'WARN', 
      icon: '⚠️',
      details: 'No models/ directory in dist/assets'
    });
  }
} catch (error) {
  checks.push({ 
    name: 'Build succeeds', 
    status: 'FAIL', 
    icon: '❌',
    details: 'Build failed - check error above'
  });
}

// 5. Check Docker files
console.log('5️⃣  Checking Docker setup...');
if (existsSync('Dockerfile') && existsSync('.dockerignore')) {
  checks.push({ name: 'Docker files', status: 'PASS', icon: '✅' });
} else {
  checks.push({ 
    name: 'Docker files', 
    status: 'WARN', 
    icon: '⚠️',
    details: 'Docker deployment may not work'
  });
}

// 6. Check Vercel files
console.log('6️⃣  Checking Vercel setup...');
if (existsSync('vercel.json') && existsSync('.vercelignore')) {
  checks.push({ name: 'Vercel files', status: 'PASS', icon: '✅' });
} else {
  checks.push({ 
    name: 'Vercel files', 
    status: 'WARN', 
    icon: '⚠️',
    details: 'Vercel deployment may not be optimized'
  });
}

// Print results
console.log('\n' + '='.repeat(60));
console.log('📋 CHECKLIST RESULTS\n');

checks.forEach(check => {
  console.log(`${check.icon} ${check.name}: ${check.status}`);
  if (check.details) {
    console.log(`   └─ ${check.details}`);
  }
});

console.log('='.repeat(60) + '\n');

// Summary
const passed = checks.filter(c => c.status === 'PASS').length;
const failed = checks.filter(c => c.status === 'FAIL').length;
const warned = checks.filter(c => c.status === 'WARN').length;

console.log(`Summary: ${passed} passed, ${failed} failed, ${warned} warnings\n`);

if (failed === 0) {
  console.log('✨ Ready to deploy!\n');
  console.log('Next steps:');
  console.log('  • Docker:  docker-compose up -d');
  console.log('  • Vercel:  vercel --prod\n');
  process.exit(0);
} else {
  console.log('❌ Fix the issues above before deploying\n');
  process.exit(1);
}
