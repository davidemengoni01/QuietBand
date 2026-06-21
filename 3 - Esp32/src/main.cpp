#include <Arduino.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>

// ================= WIFI =================
#define WIFI_SSID "GalaxyMengo"
#define WIFI_PASSWORD "CiaoBello"

// ================= FIREBASE =================
#define API_KEY "AIzaSyCOG1pqQFvfiIi10Pu9WByBCO1rbRTBMpc"
#define DATABASE_URL "quietband-d452c-default-rtdb.europe-west1.firebasedatabase.app"

// ================= FIREBASE OBJECTS =================
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ================= PIN =================
const int triggerPin = 4;   // pogo / input
const int motorPin = 26;

// ================= PATH =================
String path = "";
String sensorId = "";

// ================= WIFI =================
void connectWiFi() {

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("WiFi connecting");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi OK");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ================= FIREBASE =================
void initFirebase() {
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  config.signer.test_mode = true;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  Serial.println("Firebase OK");
}

// ================= SEND STATUS =================
bool sendStatus(const String &state) {
  Serial.print("Sending status: ");
  Serial.println(state);
  Serial.print("To path: ");
  Serial.println(path);


  if (Firebase.RTDB.setString(&fbdo, path, state)) {
    Serial.print("Firebase → ");
    Serial.println(state);
    return true;
  } else {
    Serial.println("Firebase ERROR");
    Serial.println(fbdo.errorReason());
    return false;
  }
}

// ================= CHECK RECEIVERS =================
bool receiversOnline = false;

void checkReceivers() {

  if (Firebase.RTDB.getJSON(&fbdo, "/receivers")) {

    FirebaseJson &json = fbdo.jsonObject();
    size_t len = json.iteratorBegin();

    for (size_t i = 0; i < len; i++) {

      int type;
      String key, value;
      json.iteratorGet(i, type, key, value);

      if (value.indexOf("true") != -1) {
        receiversOnline = true;
        break;
      }
    }

    json.iteratorEnd();

    Serial.print("Receivers online: ");
    Serial.println(receiversOnline ? "YES" : "NO");

  } else {
    receiversOnline = false;
  }
}

// ================= CHECK SAFETY =================
bool safetyStatus = true;

void checkSafety() {
  String newPath = "/sensors/";
  newPath += sensorId;
  newPath += "/status";

  Serial.print("Checking safety status at path: ");
  Serial.println(newPath);
  
  if (Firebase.RTDB.getString(&fbdo, newPath)) {
    String status = fbdo.stringData();
    safetyStatus = (status != "emergency");
    Serial.print("Safety status: ");
    Serial.println(safetyStatus ? "SAFE" : "EMERGENCY");
  } else {
    safetyStatus = true; // default safe
    Serial.println("Firebase ERROR");
    Serial.println(fbdo.errorReason());
  }
}

// ================= SETUP =================
bool triggered;

void setup() {

  Serial.begin(115200);

  pinMode(triggerPin, INPUT_PULLUP);
  pinMode(motorPin, OUTPUT);
  digitalWrite(motorPin, LOW);

  connectWiFi();
  initFirebase();

  if (Firebase.RTDB.getString(&fbdo, "/hardware_bridge/activeSessionId")) {
    sensorId = fbdo.stringData();
    Serial.println("ActiveSessionId: ");
    Serial.println(sensorId);

    path = "/sensors/";
    path += sensorId;
    path += "/status";
  } else {
    Serial.println("Failed to get activeSessionId");
  }

  triggered = false;
}

// ================= LOOP =================

void loop() {
  if (sensorId != "") {
    Serial.println("EMERGENCY TRIGGERED");

    if (triggered) 
      checkSafety();

    if (!(safetyStatus && triggered) && sendStatus("emergency")) {
      triggered = true;

      // stampa il safety status prima di attivare il motore
      Serial.print("Safety status: ");
      Serial.println(safetyStatus ? "SAFE" : "EMERGENCY");
      Serial.print("Triggered: ");
      Serial.println(triggered ? "YES" : "NO");

      digitalWrite(motorPin, HIGH);
      delay(50);
      digitalWrite(motorPin, LOW);

      delay(500);

      checkReceivers();
      if (receiversOnline) {
        Serial.println("RECEIVERS ONLINE");
        digitalWrite(motorPin, HIGH);
        delay(50);
        digitalWrite(motorPin, LOW);
      } else {
        Serial.println("NO RECEIVERS ONLINE");
      }
    }

    delay(5000);
  } else {
    if (Firebase.RTDB.getString(&fbdo, "/hardware_bridge/activeSessionId")) {
      sensorId = fbdo.stringData();
      Serial.println("ActiveSessionId: ");
      Serial.println(sensorId);

      path = "/sensors/";
      path += sensorId;
      path += "/status";
    } else {
      Serial.println("Failed to get activeSessionId");
    }

    delay(1000);
  }

}