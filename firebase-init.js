/* ============================================================
   NightShiftPH Planner — Firebase initialization
   This file just connects to your Firebase project. It's safe for
   this config to be visible in public code — that's normal for any
   Firebase web app. What actually protects your data is the
   Firestore security rules (see firestore.rules in this repo) plus
   the login system, not secrecy of these values.
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyBzzYERRcJhSWB_1Qy09qKytmiVdYogZaE",
  authDomain: "ronw-nightshiftph.firebaseapp.com",
  projectId: "ronw-nightshiftph",
  storageBucket: "ronw-nightshiftph.firebasestorage.app",
  messagingSenderId: "318698160724",
  appId: "1:318698160724:web:cf4cb39974f0a56ae463c1",
};

firebase.initializeApp(firebaseConfig);

// Shared handles used throughout app.js
const db = firebase.firestore();
const auth = firebase.auth();
