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

const myRecId = localStorage.getItem('qb_rec_id') || 'rec_' + Date.now();
localStorage.setItem('qb_rec_id', myRecId);

let map = null;
let alerts = [];
let previousEmergencySensors = new Set(); 
let sensorMarkers = {}; 

// Timer Variables
let emergencyStartTime = null;
let timerInterval = null;

const recRef = ref(db, '/receivers/' + myRecId);
set(recRef, { online: true, lastSeen: new Date().toLocaleTimeString() });
onDisconnect(recRef).remove();

function initMap() {
  map = L.map('map', { center: [41.9028, 12.4964], zoom: 14, zoomControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', maxZoom: 19 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

onValue(ref(db, '/'), (snap) => {
  const data = snap.val();
  if (!data) return;

  const sensors = data.sensors || {};
  const sensorListUI = document.getElementById('sensorListUI');
  sensorListUI.innerHTML = '';
  
  for (let id in sensorMarkers) { map.removeLayer(sensorMarkers[id]); }
  sensorMarkers = {};

  let currentEmergencySensors = new Set();

  for (let id in sensors) {
    const s = sensors[id];
    const sensorStatus = s.status || 'safe';

    if (sensorStatus === 'emergency') {
      currentEmergencySensors.add(id);
    }

    // 1. Map Marker
    const cls = sensorStatus === 'emergency' ? 'pin emergency' : 'pin safe';
    const marker = L.marker([s.lat, s.lng], { icon: L.divIcon({ className: cls, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
    marker.bindPopup(`<b>Sensor:</b> ${id}<br><b>Battery:</b> ${s.battery}%`);
    sensorMarkers[id] = marker;

    // 2. Action HTML (Must be defined BEFORE using it in sensorListUI.innerHTML)
    let actionHTML = '';
    if (sensorStatus === 'emergency') {
      actionHTML = `<div class="sensor-right">
        <div class="emergency-dot"></div>
        <button class="resolve-btn-inline" onclick="resolveIncident('${id}')">Resolve</button>
      </div>`;
    } else {
      actionHTML = `<div class="sensor-right"><div class="safe-dot"></div></div>`;
    }

    // 3. Battery Display Fix
    const battDisplay = (s.battery && s.battery !== 'N/A' && s.battery !== 'Unsupported') ? `${s.battery}%` : s.battery;

    // 4. Sidebar UI
    sensorListUI.innerHTML += `
      <div class="sensor-list-item">
        <div class="sensor-left">
          <div class="sensor-id">${id}</div>
          <div class="sensor-data">Batt: ${battDisplay} | Loc: ${parseFloat(s.lat).toFixed(3)}, ${parseFloat(s.lng).toFixed(3)}</div>
        </div>
        ${actionHTML}
      </div>
    `;
  }
  
  if (Object.keys(sensors).length > 0) {
    const firstSensor = Object.values(sensors)[0];
    document.getElementById('mLat').textContent = parseFloat(firstSensor.lat).toFixed(4);
    document.getElementById('mLng').textContent = parseFloat(firstSensor.lng).toFixed(4);
  }

  // Update Global Dashboard UI
  updateStatusUI(currentEmergencySensors.size);

  // Fix Wearer Contact
  const contacts = data.contacts || {};
  const firstKey = Object.keys(contacts)[0];
  if (firstKey) {
    const c = contacts[firstKey];
    document.getElementById('cName').textContent = c.name || 'Not set';
    document.getElementById('cPhone').textContent = c.phone || 'Not set';
  } else {
    document.getElementById('cName').textContent = 'Not set';
    document.getElementById('cPhone').textContent = 'Not set';
  }

  const settings = data.settings || {};
  document.getElementById('editMessage').value = settings.customMessage || '';
  window._customMessage = settings.customMessage;

  const listUI = document.getElementById('contactListUI');
  listUI.innerHTML = '';
  for (let key in contacts) {
    const c = contacts[key];
    listUI.innerHTML += `<div class="contact-list-item"><div class="contact-info">${c.name} <span>${c.phone}</span></div><button class="m-btn m-btn-danger" onclick="deleteContact('${key}')">Delete</button></div>`;
  }

  document.getElementById('connDot').className = 'indicator-dot';

  // --- EMERGENCY TIMER LOGIC ---
  if (currentEmergencySensors.size > 0 && previousEmergencySensors.size === 0) {
      emergencyStartTime = Date.now();
      document.getElementById('emergencyTimer').style.display = 'block';
      startTimer();
  } else if (currentEmergencySensors.size === 0 && previousEmergencySensors.size > 0) {
      emergencyStartTime = null;
      document.getElementById('emergencyTimer').style.display = 'none';
      clearInterval(timerInterval);
      document.getElementById('emergencyTimer').textContent = '00:00:00';
  }

  // --- ACTIVITY LOG & ALARMS ---
  currentEmergencySensors.forEach(id => {
    if (!previousEmergencySensors.has(id)) {
      playBeep(); pushNotify('emergency');
      addAlert('danger', `SOS DETECTED from ${id}!`);
      showToast('danger', `EMERGENCY: ${id}`);
    }
  });

  previousEmergencySensors.forEach(id => {
    if (!currentEmergencySensors.has(id)) {
      addAlert('safe', `${id} resolved.`);
    }
  });

  if (currentEmergencySensors.size === 0 && previousEmergencySensors.size > 0) {
    showToast('safe', 'All systems safe');
  }

  previousEmergencySensors = currentEmergencySensors;
});

// Resolve button ONLY resets the specific sensor
window.resolveIncident = function(sensorId) {
  set(ref(db, '/sensors/' + sensorId + '/status'), 'safe');
};

function updateStatusUI(activeEmergencyCount) {
  const isEm = activeEmergencyCount > 0;
  document.getElementById('statusRing').className = 'status-ring ' + (isEm ? 'emergency' : 'safe');
  document.getElementById('ringWrap').className = 'status-ring-wrap' + (isEm ? ' emergency' : '');
  document.getElementById('statusIcon').className = 'fas ' + (isEm ? 'fa-exclamation-circle' : 'fa-shield-halved') + ' status-icon ' + (isEm ? 'emergency' : 'safe');
  document.getElementById('statusLabel').className = 'status-label ' + (isEm ? 'emergency' : 'safe');
  document.getElementById('statusLabel').textContent = isEm ? 'EMERGENCY' : 'SAFE';
  document.getElementById('statusSub').textContent = isEm ? `${activeEmergencyCount} active SOS signal(s)` : 'All systems normal';
  document.getElementById('statusCard').className = 'status-card' + (isEm ? ' emergency' : '');
  if (isEm) document.body.classList.add('emergency-mode'); else document.body.classList.remove('emergency-mode');
}

// --- TIMER FUNCTION ---
function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!emergencyStartTime) return;
        let elapsed = Math.floor((Date.now() - emergencyStartTime) / 1000);
        let hrs = String(Math.floor(elapsed / 3600)).padStart(2, '0');
        let mins = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
        let secs = String(elapsed % 60).padStart(2, '0');
        document.getElementById('emergencyTimer').textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);
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