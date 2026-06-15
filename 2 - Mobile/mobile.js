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

// Generate unique ID for this specific phone, save to localStorage so it persists
const mySensorId = localStorage.getItem('qb_sensor_id') || 'sensor_' + Date.now();
localStorage.setItem('qb_sensor_id', mySensorId);

let currentLat = 41.9028;
let currentLng = 12.4964;
let whatsappSentForThisIncident = false;

// --- PRESENCE SYSTEM ---
// Tell Firebase this phone is online. If it closes the tab, Firebase removes it automatically.
const sensorRef = ref(db, '/sensors/' + mySensorId);
set(sensorRef, { id: mySensorId, lat: currentLat, lng: currentLng, battery: 'N/A', lastUpdate: new Date().toLocaleTimeString() });
onDisconnect(sensorRef).remove();

// --- REAL BATTERY ---
async function updateBattery() {
  if (!navigator.getBattery) return;
  const battery = await navigator.getBattery();
  function update() {
    const pct = Math.round(battery.level * 100);
    // Update just the battery field in our sensor object
    set(ref(db, '/sensors/' + mySensorId + '/battery'), pct);
  }
  update();
  battery.addEventListener('levelchange', update);
}

// --- MOBILE GPS ---
function writeDeviceData() {
  set(ref(db, '/sensors/' + mySensorId), {
    id: mySensorId,
    lat: currentLat,
    lng: currentLng,
    battery: 'N/A', // Battery will overwrite this
    lastUpdate: new Date().toLocaleTimeString()
  });
}

if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
        (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      writeDeviceData(); 
      
      // FIX: Update UI immediately instead of waiting for Firebase
      document.getElementById('mCoords').textContent = currentLat.toFixed(4) + ', ' + currentLng.toFixed(4);
      document.getElementById('mTime').textContent = new Date().toLocaleTimeString();
    },
    (err) => console.warn('GPS error:', err),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

// --- LISTEN TO FIREBASE ---
onValue(ref(db, '/'), (snap) => {
  const data = snap.val();
  if (!data) return;

  // 1. Check Global Status
  const status = data.status || {};
  const level = status.level || 'safe';
  const badge = document.getElementById('mobileStatusBadge');
  const safeBtn = document.getElementById('mobileSafeBtn');

  if (level === 'emergency') {
    badge.textContent = 'SOS ACTIVE'; badge.className = 'm-status-badge emergency';
    document.body.classList.add('emergency-mode');
    safeBtn.classList.add('visible');
    if (!whatsappSentForThisIncident) { sendWhatsAppAlert(data); whatsappSentForThisIncident = true; }
  } else {
    badge.textContent = 'SAFE'; badge.className = 'm-status-badge safe';
    document.body.classList.remove('emergency-mode');
    safeBtn.classList.remove('visible');
    whatsappSentForThisIncident = false;
  }

  // 2. Check Who is receiving (Receivers List)
  const receivers = data.receivers || {};
  const receiverCount = Object.keys(receivers).length;
  const recStatusEl = document.getElementById('receiverStatus');
  if (receiverCount > 0) {
    recStatusEl.textContent = receiverCount + ' Receiver(s) Online';
    recStatusEl.className = 'receiver-status';
  } else {
    recStatusEl.textContent = 'No Receivers Online';
    recStatusEl.className = 'receiver-status offline';
  }

  // 3. Load Contacts/Settings
  const contacts = data.contacts || {};
  const firstKey = Object.keys(contacts)[0];
  if (firstKey) {
    const c = contacts[firstKey];
    document.getElementById('mCName').textContent = c.name;
    document.getElementById('mCPhone').textContent = c.phone;
    document.getElementById('inputName').value = c.name;
    document.getElementById('inputPhone').value = c.phone;
    window._contactPhone = c.phone;
    window._contactKey = firstKey;
  }
  const settings = data.settings || {};
  window._customMessage = settings.customMessage || 'I am in danger, please send help!';
  document.getElementById('inputMessage').value = window._customMessage;
});

// --- WHATSAPP ALERT ---
function sendWhatsAppAlert(data) {
  const phone = window._contactPhone;
  if (!phone) return;
  const customMsg = window._customMessage;
  const msg = encodeURIComponent('🚨 QUIETBAND SOS EMERGENCY\n\n' + customMsg + '\n\nLocation: https://www.google.com/maps?q=' + currentLat + ',' + currentLng + '\nTime: ' + new Date().toLocaleString());
  const clean = phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  window.open('https://wa.me/' + clean + '?text=' + msg, '_blank');
}

// --- BUTTONS ---
document.getElementById('mobileSosBtn').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  set(ref(db, '/status'), { level: 'emergency', triggeredAt: new Date().toLocaleString(), resolvedBy: '' });
});

document.getElementById('mobileSafeBtn').addEventListener('click', () => {
  set(ref(db, '/status'), { level: 'safe', triggeredAt: '', resolvedBy: '' });
});

// --- SETTINGS ---
window.saveMobileSettings = function() { set(ref(db, '/settings/customMessage'), document.getElementById('inputMessage').value); alert("Saved!"); };
window.saveMobileContact = function() { const n = document.getElementById('inputName').value; const p = document.getElementById('inputPhone').value; set(ref(db, '/contacts/' + (window._contactKey||'contact1')), { name: n, phone: p }); alert("Saved!"); closeSettings(); };
window.openSettings = function() { document.getElementById('settingsModal').classList.add('active'); };
window.closeSettings = function() { document.getElementById('settingsModal').classList.remove('active'); };

updateBattery(); // Init battery tracking