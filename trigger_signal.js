#!/usr/bin/env node

/**
 * Sahyog Signal Simulator CLI
 * Usage:
 *   node trigger_signal.js
 *   node trigger_signal.js --type medical
 *   node trigger_signal.js --type flood
 *   node trigger_signal.js --type blue
 */

const http = require('http');

const typeArg = process.argv.find((a, i) => process.argv[i - 1] === '--type') || 'blue';

const presets = {
  blue: {
    uuid: 'ble-cli-' + Date.now(),
    reporter_name: 'Aarav Deshmukh (Blue Signal Mesh)',
    reporter_phone: '+91 98230 44551',
    type: 'Blue Signal Ping',
    description: 'BLE beacon mesh pulse detected from isolated zone. Hop count: 3.',
    priority: 88,
    lat: 18.5204,
    lng: 73.8567,
    source: 'mesh_ble',
    hop_count: 3,
    family_contacts: [
      { name: 'Suresh Deshmukh', phone: '+91 99221 00000', status: 'pending' }
    ]
  },
  medical: {
    uuid: 'med-cli-' + Date.now(),
    reporter_name: 'Pooja Kulkarni (Medical Emergency)',
    reporter_phone: '+91 97654 32109',
    type: 'Severe Medical Emergency',
    description: 'Elderly person requires immediate oxygen cylinder assistance at Shaniwar Peth.',
    priority: 95,
    lat: 18.5195,
    lng: 73.8553,
    source: 'app_direct',
    hop_count: 1,
    family_contacts: []
  },
  flood: {
    uuid: 'flood-cli-' + Date.now(),
    reporter_name: 'Aniket Shinde (Flood Trap)',
    reporter_phone: '+91 98888 77777',
    type: 'Flood Water Level Rising',
    description: 'Ground floor submerged. 4 people trapped on terrace near Mutha river.',
    priority: 92,
    lat: 18.5140,
    lng: 73.8420,
    source: 'mesh_ble',
    hop_count: 2,
    family_contacts: [
      { name: 'Neeta Shinde', phone: '+91 98888 66666', status: 'pending' }
    ]
  }
};

const packet = presets[typeArg] || presets.blue;
const payload = JSON.stringify({ packets: [packet] });

console.log('\n========================================');
console.log('📡 Sahyog Simulator: Triggering Signal');
console.log('========================================');
console.log(`Type:       ${packet.type}`);
console.log(`Reporter:   ${packet.reporter_name}`);
console.log(`Source:     ${packet.source} (Hops: ${packet.hop_count})`);
console.log(`Location:   ${packet.lat}, ${packet.lng}`);
console.log('----------------------------------------');

const req = http.request(
  {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/api/mesh/sync',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (res.statusCode === 200 && json.synced > 0) {
          console.log('✅ SUCCESS: Signal saved to PostgreSQL & broadcast live via Socket.io!');
          console.log('📲 Look at your iOS Simulator — red emergency popup will appear immediately!\n');
        } else {
          console.log(`⚠️ Server responded with status ${res.statusCode}:`, json);
        }
      } catch (_) {
        console.log(`Response: ${data}`);
      }
    });
  }
);

req.on('error', (e) => {
  console.error('❌ Connection error to http://127.0.0.1:3000:', e.message);
  console.log('Make sure backend server is running.\n');
});

req.write(payload);
req.end();
