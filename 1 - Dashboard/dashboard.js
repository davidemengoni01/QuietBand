import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, set, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCOG1pqQFvfiIi10Pu9WByBCO1rbRTBMpc",
  authDomain: "quietband-d452c.firebaseapp.com",
  databaseURL: "https://quietband-d452c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "quietband-d452c",
  storageBucket: "quietband-d452c.firebasestorage.app",
  messagingSenderId: "371880303132",
  appId: "1:371880303132:web:d0a44a5420169e41a75dd9"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Unique ID for this dashboard instance
const myRecId = localStorage.getItem('qb_rec_id') || 'rec_' + Date.now();
localStorage.setItem('qb_rec_id', myRecId);

let map = null;
let alerts = [];
let previousStatus = "safe";
let sensorMarkers = {}; // Track multiple map markers

// --- PRESENCE SYSTEM ---
const recRef = ref(db, '/receivers/' + myRecId);
set(recRef, { online: true, lastSeen: new Date().toLocaleTimeString() });
onDisconnect(recRef).remove();

// --- MAP INIT ---
function initMap() {
  map = L.map('map', { center: [41.9028, 12.4964], zoom: 14, zoomControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

// --- MAIN FIREBASE LISTENER ---
onValue(ref(db, '/'), (snap) => {
  const data = snap.val();
  if (!data) return;

  // 1. Global Status
  const status = data.status || {};
  const level = status.level || 'safe';
  updateStatusUI(level);

  // 2. Sensors / Multi-Device Tracking
  const sensors = data.sensors || {};
  const sensorListUI = document.getElementById('sensorListUI');
  sensorListUI.innerHTML = '';
  
  // Clear old markers
  for (let id in sensorMarkers) { map.removeLayer(sensorMarkers[id]); }
  sensorMarkers = {};

  for (let id in sensors) {
    const s = sensors[id];
    
    // Add to List UI
    sensorListUI.innerHTML += `<div class="sensor-list-item"><div class="sensor-id">${id}</div><div class="sensor-data">Batt: ${s.battery}% | Loc: ${parseFloat(s.lat).toFixed(3)}, ${parseFloat(s.lng).toFixed(3)}</div></div>`;
    
    // Add to Map
    const cls = level === 'emergency' ? 'pin emergency' : 'pin safe';
    const marker = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: cls, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
    marker.bindPopup(`<b>Sensor:</b> ${id}<br><b>Battery:</b> ${s.battery}%`);
    sensorMarkers[id] = marker;
  }
  
  if (Object.keys(sensors).length > 0) {
    const firstSensor = Object.values(sensors)[0];
    document.getElementById('mLat').textContent = parseFloat(firstSensor.lat).toFixed(4);
    document.getElementById('mLng').textContent = parseFloat(firstSensor.lng).toFixed(4);
  }

  // 3. Contacts
  const contacts = data.contacts || {};
  const firstKey = Object.keys(contacts)[0];
  if (firstKey) {
    const c = contacts[firstKey];
    document.getElementById('cName').textContent = c.name || 'Not set';
    document.getElementById('cPhone').textContent = c.phone || 'Not set';
  }

  // 4. Settings
  const settings = data.settings || {};
  document.getElementById('editMessage').value = settings.customMessage || '';
  window._customMessage = settings.customMessage;

  // 5. Modal Contact List
  const listUI = document.getElementById('contactListUI');
  listUI.innerHTML = '';
  for (let key in contacts) {
    const c = contacts[key];
    listUI.innerHTML += `<div class="contact-list-item"><div class="contact-info">${c.name} <span>${c.phone}</span></div><button class="m-btn m-btn-danger" onclick="deleteContact('${key}')">Delete</button></div>`;
  }

  document.getElementById('connDot').className = 'indicator-dot';

  // 6. AUTOMATIC ALARMS
  if (level === 'emergency' && previousStatus !== 'emergency') {
    playBeep(); pushNotify('emergency');
    addAlert('danger', 'SOS DETECTED from ' + (Object.keys(sensors).length) + ' device(s)!');
    showToast('danger', 'EMERGENCY ACTIVATED');
  } else if (level === 'safe' && previousStatus !== 'safe') {
    const resolvedBy = status.resolvedBy || 'System';
    addAlert('safe', `Incident resolved by ${resolvedBy}`);
    showToast('safe', 'System Safe');
  }
  previousStatus = level;
});

// --- RECEIVER ACTIONS ---
window.resolveIncident = function() {
  set(ref(db, '/status'), { level: 'safe', triggeredAt: '', resolvedBy: myRecId });
  document.body.classList.remove('emergency-mode');
};

// --- UI FUNCTIONS ---
function updateStatusUI(status) {
  const isEm = status === 'emergency';
  document.getElementById('statusRing').className = 'status-ring ' + (isEm ? 'emergency' : 'safe');
  document.getElementById('ringWrap').className = 'status-ring-wrap' + (isEm ? ' emergency' : '');
  document.getElementById('statusIcon').className = 'fas ' + (isEm ? 'fa-exclamation-circle' : 'fa-shield-halved') + ' status-icon ' + (isEm ? 'emergency' : 'safe');
  document.getElementById('statusLabel').className = 'status-label ' + (isEm ? 'emergency' : 'safe');
  document.getElementById('statusLabel').textContent = isEm ? 'EMERGENCY' : 'SAFE';
  document.getElementById('statusSub').textContent = isEm ? 'SOS signal active' : 'All systems normal';
  document.getElementById('statusCard').className = 'status-card' + (isEm ? ' emergency' : '');
  if (isEm) document.body.classList.add('emergency-mode'); else document.body.classList.remove('emergency-mode');
  document.getElementById('resolveBtn').style.display = isEm ? 'flex' : 'none';
}

function pushNotify(s) { if (!('Notification' in window)) return; if (Notification.permission === 'granted') new Notification('QuietBand', { body: s === 'emergency' ? 'SOS EMERGENCY triggered!' : 'User is safe.' }); }
function playBeep() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 880; osc.type = 'sine'; gain.gain.value = 0.3; osc.start(); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8); osc.stop(ctx.currentTime + 0.8); } catch (e) {} }

function addAlert(type, message) { alerts.unshift({ type, message, time: new Date().toLocaleTimeString() }); renderAlerts(); }
function renderAlerts() { document.getElementById('alertCount').textContent = alerts.length; document.getElementById('alertList').innerHTML = alerts.map(a => `<div class="alert-item"><div class="alert-dot ${a.type}"></div><div><div class="alert-msg">${a.message}</div><div class="alert-time">${a.time}</div></div></div>`).join(''); }
function showToast(type, message) { const c = document.getElementById('toasts'); const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<i class="fas fa-${type==='danger'?'exclamation-circle':'check-circle'} toast-icon ${type}"></i><span class="toast-msg">${message}</span>`; c.appendChild(t); setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 300); }, 4000); }
function tick() { document.getElementById('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

window.saveMessage = function() { set(ref(db, '/settings/customMessage'), document.getElementById('editMessage').value); showToast('info', 'Saved'); document.getElementById('settingsModal').classList.remove('active'); };
window.addContact = function() { const n = document.getElementById('newName').value; const p = document.getElementById('newPhone').value; if(!n||!p) return; set(ref(db, '/contacts/contact_' + Date.now()), { name: n, phone: p }); document.getElementById('newName').value=''; document.getElementById('newPhone').value=''; showToast('safe', 'Added'); };
window.deleteContact = function(key) { set(ref(db, '/contacts/' + key), null); showToast('danger', 'Deleted'); };

initMap(); tick(); setInterval(tick, 10000); addAlert('info', 'Monitoring station active');
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();