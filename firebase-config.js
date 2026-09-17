/* ==========================================================================
   Hisabi - Firebase Project Configuration
   Project: smart-mess-management-app
   App ID: 1:317337524984:web:3555e16017e2cd85f2b90d
   ========================================================================== */

const savedApiKey = localStorage.getItem('hisabi_firebase_api_key') || '';
const hasValidOverride = savedApiKey && savedApiKey.startsWith("AIzaSy") && !savedApiKey.includes("SMART_MESS");

export const firebaseConfig = {
  apiKey: hasValidOverride ? savedApiKey : "AIzaSyCBYtsyUbCadj0Xv506oeiOgVvoQiZJVp0",
  authDomain: "smart-mess-management-app.firebaseapp.com",
  projectId: "smart-mess-management-app",
  storageBucket: "smart-mess-management-app.firebasestorage.app",
  messagingSenderId: "317337524984",
  appId: "1:317337524984:web:3555e16017e2cd85f2b90d"
};
