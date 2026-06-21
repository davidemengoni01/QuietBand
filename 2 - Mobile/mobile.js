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

const mySensorId = localStorage.getItem('qb_sensor_id') || 'sensor_' + Date.now();
localStorage.setItem('qb_sensor_id', mySensorId);

let currentLat = 41.9028;
let currentLng = 12.4964;
let whatsappSentForThisIncident = false;
let myCurrentStatus = "safe";
let currentBattery = 'N/A';

const sensorRef = ref(db, '/sensors/' + mySensorId);
set(sensorRef, { id: mySensorId, lat: currentLat, lng: currentLng, battery: 'N/A', status: 'safe', lastUpdate: new Date().toLocaleTimeString() });
onDisconnect(sensorRef).remove();

// --- WAKE LOCK (Prevents phone from sleeping) ---
let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    });
  } catch (err) {}
}
requestWakeLock();

// --- REAL BATTERY ---
async function updateBattery() {
  if (!navigator.getBattery) {
    currentBattery = 'Unsupported';
    writeDeviceData();
    return;
  }
  try {
    const battery = await navigator.getBattery();
    function update() {
      currentBattery = Math.round(battery.level * 100);
      writeDeviceData();
    }
    update();
    battery.addEventListener('levelchange', update);
  } catch (e) {}
}

// --- MOBILE GPS ---
function writeDeviceData() {
  set(ref(db, '/sensors/' + mySensorId), {
    id: mySensorId,
    lat: currentLat,
    lng: currentLng,
    battery: currentBattery,
    status: myCurrentStatus,
    lastUpdate: new Date().toLocaleTimeString()
  });
}

if (navigator.geolocation) {
  navigator.geolocation.watchPosition(
    (pos) => {
      currentLat = pos.coords.latitude;
      currentLng = pos.coords.longitude;
      writeDeviceData(); 
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

  const allSensors = data.sensors || {};
  const myData = allSensors[mySensorId] || {};
  myCurrentStatus = myData.status || 'safe';

  const badge = document.getElementById('mobileStatusBadge');
  const safeBtn = document.getElementById('mobileSafeBtn');

  if (myCurrentStatus === 'emergency') {
    badge.textContent = 'SOS ACTIVE'; badge.className = 'm-status-badge emergency';
    document.body.classList.add('emergency-mode');
    safeBtn.classList.add('visible');
    
    if (!whatsappSentForThisIncident) { 
      sendWhatsAppAlert(data); 
      whatsappSentForThisIncident = true; 
    }
  } else {
    badge.textContent = 'SAFE'; badge.className = 'm-status-badge safe';
    document.body.classList.remove('emergency-mode');
    safeBtn.classList.remove('visible');
    whatsappSentForThisIncident = false;
  }

  // Check for OTHER sensors in emergency
  let otherEmergency = null;
  for (let id in allSensors) {
    if (id !== mySensorId && allSensors[id].status === 'emergency') {
      otherEmergency = id;
      break;
    }
  }
  const banner = document.getElementById('otherEmergencyBanner');
  if (banner) { // Null check to prevent crashes
    if (otherEmergency) {
      banner.style.display = 'block';
      document.getElementById('otherEmergencyText').textContent = `Sensor ${otherEmergency} is in danger`;
    } else {
      banner.style.display = 'none';
    }
  }

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

  // --- HANDLE ALL CONTACTS ---
  const contacts = data.contacts || {};
  const contactKeys = Object.keys(contacts);
  
  window._allContacts = [];
  contactKeys.forEach(key => {
    window._allContacts.push({
      name: contacts[key].name,
      phone: contacts[key].phone
    });
  });

  if (contactKeys.length > 0) {
    const c = contacts[contactKeys[0]];
    document.getElementById('mCName').textContent = c.name;
    document.getElementById('mCPhone').textContent = c.phone;
    document.getElementById('inputName').value = c.name;
    document.getElementById('inputPhone').value = c.phone;
    window._contactKey = contactKeys[0];
  } else {
    document.getElementById('mCName').textContent = 'Not set';
    document.getElementById('mCPhone').textContent = 'Not set';
  }

  const settings = data.settings || {};
  window._customMessage = settings.customMessage || 'I am in danger, please send help!';
  document.getElementById('inputMessage').value = window._customMessage;
});

// --- WHATSAPP ALERT (SEND TO ALL) ---
function sendWhatsAppAlert(data) {
  if (!window._allContacts || window._allContacts.length === 0) return;
  
  const customMsg = window._customMessage;
  const baseMsg = '🚨 QUIETBAND SOS EMERGENCY\n\n' + customMsg + '\n\nLocation: https://www.google.com/maps?q=' + currentLat + ',' + currentLng + '\nTime: ' + new Date().toLocaleString();
  
  window._allContacts.forEach(contact => {
    const clean = contact.phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
    const msg = encodeURIComponent(baseMsg);
    window.open('https://wa.me/' + clean + '?text=' + msg, '_blank');
  });
}

// --- BUTTONS ---
document.getElementById('simulateBandBtn').addEventListener('click', () => {
  myCurrentStatus = "emergency";
  writeDeviceData();
});

document.getElementById('mobileSafeBtn').addEventListener('click', () => {
  myCurrentStatus = "safe";
  writeDeviceData();
});

// --- SETTINGS ---
window.saveMobileSettings = function() { set(ref(db, '/settings/customMessage'), document.getElementById('inputMessage').value); alert("Saved!"); };
window.saveMobileContact = function() { const n = document.getElementById('inputName').value; const p = document.getElementById('inputPhone').value; set(ref(db, '/contacts/' + (window._contactKey||'contact1')), { name: n, phone: p }); alert("Saved!"); closeSettings(); };
window.openSettings = function() { document.getElementById('settingsModal').classList.add('active'); };
window.closeSettings = function() { document.getElementById('settingsModal').classList.remove('active'); };

updateBattery(); 