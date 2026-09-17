/* ==========================================================================
   Hisabi - Smart Mess Management System
   Phase 2, 3 & 4 + Multi-Mess Onboarding, Owner/Admin Delegation & Join Requests
   ========================================================================== */

// Import Firebase Web Modular SDK from Google's official CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { 
  getAuth, 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup, 
  GoogleAuthProvider, 
  RecaptchaVerifier, 
  signInWithPhoneNumber, 
  signOut,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { 
  getFirestore, 
  collection,
  doc, 
  getDoc, 
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Import project configuration
import { firebaseConfig } from "./firebase-config.js";

/* ==========================================================================
   Global State
   ========================================================================== */
let app;
let auth;
let db;
let currentUser = null;
let currentRole = "member";   // 'owner', 'admin', 'manager', 'member'
let currentStatus = "active"; // 'active', 'pending', 'none'
let currentMess = null;       // { id, name, code, owner_uid, fixed_cost_share }
let selectedMealDate = "";    // Active date for meal toggles and roommate board
let isSignUpMode = false;
let confirmationResult = null;

// In-Memory Data Store (Synchronized with Firestore or Local Fallback)
let state = {
  users: [],
  expenses: [],
  deposits: [],
  meals: [],
  bazarSchedule: [],
  joinRequests: []
};

// Initialize Firebase
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  console.log("Firebase initialized for:", firebaseConfig.projectId);
  if (auth && browserLocalPersistence) {
    setPersistence(auth, browserLocalPersistence).catch(err => {
      console.warn("Storage persistence setting note:", err.message);
    });
  }
} catch (error) {
  console.warn("Firebase initialization notice:", error.message);
}

/* ==========================================================================
   Date, Code & Cut-off Helpers
   ========================================================================== */
function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodayStr() {
  return formatDateKey(new Date());
}

function getTomorrowStr() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateKey(tomorrow);
}

function getFutureDateStr(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return formatDateKey(d);
}

function getPastDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return formatDateKey(d);
}

function getReadableDate(dateStr) {
  if (!dateStr) return "";
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length < 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function generateMessCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SM";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function checkCutoff() {
  const now = new Date();
  // Cut-off rule: 11:00 PM (23:00)
  const isCutoff = now.getHours() >= 23;

  const cutoffStatusBadge = document.getElementById("cutoff-status-badge");
  const dashCutoffBadge = document.getElementById("dash-cutoff-badge");
  const btnSaveMeals = document.getElementById("btn-save-meals");
  const toggleBreakfast = document.getElementById("toggle-breakfast");
  const toggleLunch = document.getElementById("toggle-lunch");
  const toggleDinner = document.getElementById("toggle-dinner");

  if (isCutoff) {
    if (cutoffStatusBadge) {
      cutoffStatusBadge.textContent = "Locked (11:00 PM Passed)";
      cutoffStatusBadge.className = "badge badge-warning";
    }
    if (dashCutoffBadge) {
      dashCutoffBadge.textContent = "Locked (11:00 PM Passed)";
      dashCutoffBadge.className = "badge badge-warning";
    }
    if (btnSaveMeals) {
      btnSaveMeals.disabled = true;
      btnSaveMeals.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        Locked (Cut-off Reached at 11:00 PM)
      `;
    }
    if (toggleBreakfast) toggleBreakfast.disabled = true;
    if (toggleLunch) toggleLunch.disabled = true;
    if (toggleDinner) toggleDinner.disabled = true;
  } else {
    if (cutoffStatusBadge) {
      cutoffStatusBadge.textContent = "Open until 11:00 PM";
      cutoffStatusBadge.className = "badge badge-cutoff";
    }
    if (dashCutoffBadge) {
      dashCutoffBadge.textContent = "Open until 11:00 PM";
      dashCutoffBadge.className = "badge badge-success";
    }
    if (btnSaveMeals) {
      btnSaveMeals.disabled = false;
      btnSaveMeals.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Save Meal Preferences
      `;
    }
    if (toggleBreakfast) toggleBreakfast.disabled = false;
    if (toggleLunch) toggleLunch.disabled = false;
    if (toggleDinner) toggleDinner.disabled = false;
  }

  return isCutoff;
}

/* ==========================================================================
   UI Helpers & Feedback
   ========================================================================== */
const authStatusBox = document.getElementById("auth-status-box");

function showAuthMessage(message, type = "info") {
  if (!authStatusBox) return;
  authStatusBox.style.display = "block";
  authStatusBox.className = `auth-status-box ${type}`;
  authStatusBox.innerHTML = message;
}

function clearAuthMessage() {
  if (!authStatusBox) return;
  authStatusBox.style.display = "none";
  authStatusBox.textContent = "";
}

function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getRoleBadgeClass(role) {
  switch (role) {
    case "owner": return "badge badge-owner";
    case "admin": return "badge badge-admin";
    case "manager": return "badge badge-manager";
    default: return "badge badge-neutral";
  }
}

/* ==========================================================================
   Navigation & Section Switching
   ========================================================================== */
function setupNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".app-section");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const targetId = item.getAttribute("data-target");
      if (!targetId) return;

      navItems.forEach((b) => b.classList.remove("active"));
      sections.forEach((s) => s.classList.remove("active"));

      item.classList.add("active");
      const targetSection = document.getElementById(targetId);
      if (targetSection) {
        targetSection.classList.add("active");
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  // Auth Tabs (Email vs Google vs Phone)
  const authTabs = document.querySelectorAll(".auth-tab-btn");
  authTabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      authTabs.forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".auth-tab-pane").forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      clearAuthMessage();

      if (btn.id === "tab-btn-email") document.getElementById("pane-email").classList.add("active");
      if (btn.id === "tab-btn-google") document.getElementById("pane-google").classList.add("active");
      if (btn.id === "tab-btn-phone") {
        document.getElementById("pane-phone").classList.add("active");
        initPhoneRecaptcha();
      }
    });
  });

  // Close Auth Modal & Instant Demo Access
  const authModal = document.getElementById("section-auth");
  const btnCloseAuth = document.getElementById("btn-close-auth-preview");
  const btnCloseAuthX = document.getElementById("btn-close-auth-x");
  const btnInstantDemo = document.getElementById("btn-instant-demo-login");
  const btnQuickDemo = document.getElementById("btn-quick-demo");
  const userProfilePill = document.getElementById("user-profile-pill");

  if (btnCloseAuth && authModal) {
    btnCloseAuth.addEventListener("click", () => {
      activateDemoMode();
      authModal.classList.remove("active");
    });
  }

  if (btnCloseAuthX && authModal) {
    btnCloseAuthX.addEventListener("click", () => {
      activateDemoMode();
      authModal.classList.remove("active");
    });
  }

  if (btnInstantDemo && authModal) {
    btnInstantDemo.addEventListener("click", () => {
      activateDemoMode();
      authModal.classList.remove("active");
      alert("👑 Welcome Tanvir Fahim (Mess Owner)! Demo session active for SMPAZ8.");
    });
  }

  if (btnQuickDemo && authModal) {
    btnQuickDemo.addEventListener("click", () => {
      activateDemoMode();
      authModal.classList.remove("active");
    });
  }

  if (userProfilePill && authModal) {
    userProfilePill.addEventListener("click", () => {
      authModal.classList.add("active");
    });
  }

  // Mess Modal Switcher & Trigger
  const btnOpenMessModal = document.getElementById("btn-open-mess-modal");
  const btnCloseMessModal = document.getElementById("btn-close-mess-modal");
  const messModal = document.getElementById("section-mess-modal");

  if (btnOpenMessModal) {
    btnOpenMessModal.addEventListener("click", () => {
      if (currentMess && currentMess.id) {
        // Switch to Mess Hub section
        document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".app-section").forEach(s => s.classList.remove("active"));

        const hubNav = document.getElementById("nav-item-mess-hub");
        if (hubNav) hubNav.classList.add("active");
        const hubSection = document.getElementById("section-mess-dashboard");
        if (hubSection) hubSection.classList.add("active");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (messModal) {
        messModal.classList.add("active");
      }
    });
  }

  if (btnCloseMessModal && messModal) {
    btnCloseMessModal.addEventListener("click", () => {
      messModal.classList.remove("active");
    });
  }

  // Inside Mess Hub: "Switch / Add" button opens modal
  const btnHubOpenModal = document.getElementById("btn-hub-open-modal");
  if (btnHubOpenModal && messModal) {
    btnHubOpenModal.addEventListener("click", () => {
      messModal.classList.add("active");
    });
  }

  // Inside Mess Hub: Copy Code button
  const btnHubCopyCode = document.getElementById("btn-hub-copy-code");
  if (btnHubCopyCode) {
    btnHubCopyCode.addEventListener("click", async () => {
      const code = currentMess?.code || "SMPAZ8";
      try {
        await navigator.clipboard.writeText(code);
        btnHubCopyCode.textContent = "✅ Copied!";
        setTimeout(() => { btnHubCopyCode.textContent = "📋 Copy"; }, 2500);
      } catch (e) {
        prompt("Roommate Invite Code:", code);
      }
    });
  }

  // Inside Mess Hub: Share via WhatsApp button
  const btnHubShareWa = document.getElementById("btn-hub-share-wa");
  if (btnHubShareWa) {
    btnHubShareWa.addEventListener("click", () => {
      const name = currentMess?.name || "Our Mess";
      const code = currentMess?.code || "SMPAZ8";
      const shareText = `আসসালামু আলাইকুম! আমাদের "${name}" মেসে জয়েন করার জন্য Hisabi অ্যাপে Invite Code ব্যবহার করুন: *${code}* 📲`;
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`, "_blank");
    });
  }

  // Mess Hub Sub-Tabs (.mess-tab-btn toggles .mess-tab-pane)
  const hubTabBtns = document.querySelectorAll(".mess-tab-btn");
  hubTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetPaneId = btn.getAttribute("data-hub-target");
      if (!targetPaneId) return;

      hubTabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".mess-tab-pane").forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPane = document.getElementById(targetPaneId);
      if (targetPane) targetPane.classList.add("active");
    });
  });

  // Mess Modal Tabs (Create vs Join)
  const tabCreateMess = document.getElementById("tab-btn-create-mess");
  const tabJoinMess = document.getElementById("tab-btn-join-mess");
  const paneCreateMess = document.getElementById("pane-create-mess");
  const paneJoinMess = document.getElementById("pane-join-mess");

  if (tabCreateMess && tabJoinMess) {
    tabCreateMess.addEventListener("click", () => {
      tabCreateMess.classList.add("active");
      tabJoinMess.classList.remove("active");
      if (paneCreateMess) paneCreateMess.classList.add("active");
      if (paneJoinMess) paneJoinMess.classList.remove("active");
    });

    tabJoinMess.addEventListener("click", () => {
      tabJoinMess.classList.add("active");
      tabCreateMess.classList.remove("active");
      if (paneJoinMess) paneJoinMess.classList.add("active");
      if (paneCreateMess) paneCreateMess.classList.remove("active");
    });
  }

  // Copy Invite Code Button
  const btnCopyInvite = document.getElementById("btn-copy-invite-code");
  if (btnCopyInvite) {
    btnCopyInvite.addEventListener("click", () => {
      const code = document.getElementById("display-invite-code")?.textContent?.trim() || "";
      if (code) {
        navigator.clipboard.writeText(code).then(() => {
          alert(`Mess Invite Code "${code}" copied to clipboard! Share it with your roommates.`);
        }).catch(() => {
          prompt("Copy your Mess Invite Code:", code);
        });
      }
    });
  }

  // Inline API Key Save Button
  const btnSaveApiKeyInline = document.getElementById("btn-save-api-key-inline");
  const inputApiKeyInline = document.getElementById("input-api-key-inline");
  if (btnSaveApiKeyInline && inputApiKeyInline) {
    const savedKey = localStorage.getItem("hisabi_firebase_api_key") || "";
    if (savedKey) inputApiKeyInline.value = savedKey;

    btnSaveApiKeyInline.addEventListener("click", () => {
      const key = inputApiKeyInline.value.trim();
      if (!key) {
        alert("Please enter a valid Firebase Web API Key.");
        return;
      }
      localStorage.setItem("hisabi_firebase_api_key", key);
      alert("Firebase API Key saved! Connecting to Firebase...");
      window.location.reload();
    });
  }

  // Quick Demo Login Button (Immediate exploration)
  const btnQuickDemo = document.getElementById("btn-quick-demo");
  if (btnQuickDemo) {
    btnQuickDemo.addEventListener("click", async () => {
      console.log("Entering demo mode...");
      const mockUser = {
        uid: "user_owner_demo",
        displayName: "Tanvir Fahim",
        email: "demo@hisabi.app",
        phoneNumber: "+8801700000000"
      };
      await syncUserProfile(mockUser);
      if (authModal) authModal.classList.remove("active");
      alert("Welcome to Hisabi! Logged in as Mess Owner in Demo Mode.");
    });
  }

  // Firebase API Key Settings prompt
  const btnConfigKey = document.getElementById("btn-config-key");
  if (btnConfigKey) {
    btnConfigKey.addEventListener("click", () => {
      const currentKey = localStorage.getItem("hisabi_firebase_api_key") || "";
      const userKey = prompt(
        "Enter your Firebase Web API Key for project 'smart-mess-management-app':\n\n(Found in Firebase Console -> Project Settings -> General -> Web API Key)",
        currentKey
      );
      if (userKey !== null) {
        localStorage.setItem("hisabi_firebase_api_key", userKey.trim());
        alert("API Key updated! Reloading application...");
        window.location.reload();
      }
    });
  }

  // Gemini API Key Settings prompt
  const btnConfigGemini = document.getElementById("btn-config-gemini");
  if (btnConfigGemini) {
    btnConfigGemini.addEventListener("click", () => {
      const currentGemini = localStorage.getItem("hisabi_gemini_api_key") || "";
      const userGemini = prompt(
        "Enter your Google AI Studio Gemini API Key:\n\n(Get a free key from https://aistudio.google.com/app/apikey)",
        currentGemini
      );
      if (userGemini !== null) {
        localStorage.setItem("hisabi_gemini_api_key", userGemini.trim());
        alert("Gemini API Key saved!");
      }
    });
  }
}

/* ==========================================================================
   User Profile, Mess Association & Onboarding
   ========================================================================== */
const FIREBASE_FIRESTORE_RULES_TEXT = `rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    function isAuthenticated() {
      return request.auth != null;
    }
    match /messes/{messId} {
      allow read, create, update, delete: if isAuthenticated();
    }
    match /join_requests/{requestId} {
      allow read, create, update, delete: if isAuthenticated();
    }
    match /users/{userId} {
      allow read, create, update: if isAuthenticated();
      allow delete: if isAuthenticated() && request.auth.uid == userId;
    }
    match /deposits/{depositId} {
      allow read, create, update, delete: if isAuthenticated();
    }
    match /expenses/{expenseId} {
      allow read, create, update, delete: if isAuthenticated();
    }
    match /meals/{mealId} {
      allow read, create, update, delete: if isAuthenticated();
    }
    match /bazar_schedule/{scheduleId} {
      allow read, create, update, delete: if isAuthenticated();
    }
  }
}`;

function showFirestoreRulesBanner(reason = "") {
  const alertBox = document.getElementById("firestore-sync-alert");
  const descBox = document.getElementById("firestore-sync-desc");
  const btnCopy = document.getElementById("btn-copy-rules-quick");

  if (!alertBox) return;
  alertBox.style.display = "flex";
  if (descBox && reason) {
    descBox.innerHTML = `<strong>Cloud Sync Notice:</strong> ${reason}<br>Please publish the security rules in your Firebase Console so Firestore allows saving mess and user data.`;
  }

  if (btnCopy) {
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(FIREBASE_FIRESTORE_RULES_TEXT);
        btnCopy.textContent = "✅ Rules Copied to Clipboard!";
        setTimeout(() => { btnCopy.textContent = "📋 Copy Security Rules"; }, 3000);
      } catch (e) {
        prompt("Copy the rules below and paste in Firebase Console -> Firestore Database -> Rules:", FIREBASE_FIRESTORE_RULES_TEXT);
      }
    };
  }
}

async function syncUserProfile(user) {
  currentUser = user;
  const headerUserName = document.getElementById("header-user-name");
  const headerUserRole = document.getElementById("header-user-role");
  const headerAvatar = document.getElementById("header-avatar");
  const headerMessName = document.getElementById("header-mess-name");
  const messModal = document.getElementById("section-mess-modal");
  const messPendingAlert = document.getElementById("mess-pending-alert");
  const messPendingText = document.getElementById("mess-pending-text");

  const displayName = user.displayName || user.email?.split("@")[0] || user.phoneNumber || "Member";
  
  if (headerUserName) headerUserName.textContent = displayName;
  if (headerAvatar) headerAvatar.textContent = getInitials(displayName);

  currentRole = localStorage.getItem("hisabi_current_role") || "member";
  currentStatus = localStorage.getItem("hisabi_current_status") || "none";
  currentMess = null;

  // Check if a mess was created or joined locally in this browser
  const savedMessStr = localStorage.getItem("hisabi_current_mess");
  if (savedMessStr) {
    try {
      currentMess = JSON.parse(savedMessStr);
      currentRole = localStorage.getItem("hisabi_current_role") || "owner";
      currentStatus = localStorage.getItem("hisabi_current_status") || "active";
    } catch (e) {}
  }

  if (db && user.uid && auth?.currentUser) {
    try {
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        currentRole = userData.role || currentRole || "member";
        currentStatus = userData.status || currentStatus || "active";

        if (userData.mess_id) {
          const messSnap = await getDoc(doc(db, "messes", userData.mess_id));
          if (messSnap.exists()) {
            currentMess = { id: messSnap.id, ...messSnap.data() };
            localStorage.setItem("hisabi_current_mess", JSON.stringify(currentMess));
            localStorage.setItem("hisabi_current_role", currentRole);
            localStorage.setItem("hisabi_current_status", currentStatus);
          }
        }
      } else {
        // Initial user document creation using setDoc with merge: true
        const newUserData = {
          uid: user.uid,
          name: displayName,
          email: user.email || "",
          phone: user.phoneNumber || "",
          role: currentRole || "member",
          status: currentStatus || "none",
          mess_id: currentMess?.id || "",
          fixed_cost_share: currentMess?.fixed_cost_share || 800,
          createdAt: serverTimestamp()
        };
        await setDoc(userDocRef, newUserData, { merge: true });
      }
    } catch (err) {
      console.warn("Using local user profile sync:", err.message);
      if (err.message && (err.message.includes("permission-denied") || err.message.includes("Missing or insufficient permissions"))) {
        showFirestoreRulesBanner(err.message);
      }
    }
  }

  // If no mess found anywhere and demo user, set demo mess
  if (!currentMess && user?.uid === "user_owner_demo") {
    currentMess = { id: "mess_demo", name: "Green View Mess (SMPAZ8)", code: "SMPAZ8", owner_uid: user?.uid || "u1", fixed_cost_share: 800, area: "Dhanmondi, Dhaka" };
    currentRole = "owner";
    currentStatus = "active";
  }

  // Update Mess Title in Header
  if (headerMessName) {
    headerMessName.textContent = currentMess ? currentMess.name : "No Mess Joined";
  }

  // Update Role Badge in Header
  if (headerUserRole) {
    headerUserRole.textContent = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);
    headerUserRole.className = getRoleBadgeClass(currentRole);
  }

  // Check if User needs Onboarding or has Pending Request
  if (currentStatus === "pending") {
    if (messPendingAlert && messPendingText) {
      messPendingAlert.style.display = "flex";
      messPendingText.innerHTML = `Your join request to <strong>${currentMess?.name || "the mess"}</strong> is awaiting approval by the Owner or Admin.`;
    }
    if (messModal) messModal.classList.add("active");
  } else if (!currentMess && currentStatus === "none") {
    // Show Create/Join Mess dialog
    if (messPendingAlert) messPendingAlert.style.display = "none";
    if (messModal) messModal.classList.add("active");
  } else {
    if (messPendingAlert) messPendingAlert.style.display = "none";
    if (messModal) messModal.classList.remove("active");
  }

  // Load all calculations and Firestore data for this mess
  await loadAllMessData();
}

/* ==========================================================================
   Firebase Authentication State Observer
   ========================================================================== */
function activateDemoMode() {
  localStorage.setItem("hisabi_demo_active", "true");
  localStorage.removeItem("hisabi_explicit_logout");

  currentUser = {
    uid: "user_owner_demo",
    displayName: "Tanvir Fahim",
    email: "tanvir@hisabi.app",
    phoneNumber: "+8801711001122"
  };
  currentRole = localStorage.getItem("hisabi_current_role") || "owner";
  currentStatus = "active";
  currentMess = {
    id: "mess_demo",
    name: "Green View Mess (SMPAZ8)",
    code: "SMPAZ8",
    owner_uid: "user_owner_demo",
    fixed_cost_share: 800,
    area: "Dhanmondi, Dhaka"
  };

  const headerUserName = document.getElementById("header-user-name");
  const headerUserRole = document.getElementById("header-user-role");
  const headerAvatar = document.getElementById("header-avatar");
  const headerMessName = document.getElementById("header-mess-name");

  if (headerUserName) headerUserName.textContent = "Tanvir Fahim";
  if (headerUserRole) {
    headerUserRole.textContent = "Owner";
    headerUserRole.className = "badge badge-owner";
  }
  if (headerAvatar) headerAvatar.textContent = "TF";
  if (headerMessName) headerMessName.textContent = currentMess.name;

  const authModal = document.getElementById("section-auth");
  if (authModal) authModal.classList.remove("active");

  loadAllMessData();
}

/* ==========================================================================
   Firebase Authentication State Observer
   ========================================================================== */
function setupAuthObserver() {
  const authModal = document.getElementById("section-auth");

  if (!auth) {
    activateDemoMode();
    return;
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("User signed in:", user.uid);
      localStorage.removeItem("hisabi_demo_active");
      localStorage.removeItem("hisabi_explicit_logout");
      await syncUserProfile(user);
      if (authModal) authModal.classList.remove("active");
    } else {
      // User is not signed in to Firebase Auth.
      // Check if user has explicitly logged out
      const isExplicitLogout = localStorage.getItem("hisabi_explicit_logout") === "true";

      if (!isExplicitLogout) {
        // Normal visit or page reload: DO NOT block user with the login modal!
        // Automatically activate demo owner mode so user can immediately use and develop SMPAZ8
        activateDemoMode();
        if (authModal) authModal.classList.remove("active");
      } else {
        // Only show login page if user explicitly clicked Sign Out
        currentUser = null;
        currentRole = "guest";
        currentMess = null;

        const headerUserName = document.getElementById("header-user-name");
        const headerUserRole = document.getElementById("header-user-role");
        const headerAvatar = document.getElementById("header-avatar");
        const headerMessName = document.getElementById("header-mess-name");

        if (headerUserName) headerUserName.textContent = "Guest User";
        if (headerUserRole) {
          headerUserRole.textContent = "Not Signed In";
          headerUserRole.className = "badge badge-neutral";
        }
        if (headerAvatar) headerAvatar.textContent = "??";
        if (headerMessName) headerMessName.textContent = "Smart Mess System";

        await loadAllMessData();
        if (authModal) authModal.classList.add("active");
      }
    }
  });
}

/* ==========================================================================
   Mess Onboarding Handlers (Create Mess & Join Mess)
   ========================================================================== */
function setupMessHandlers() {
  const formCreateMess = document.getElementById("form-create-mess");
  const formJoinMess = document.getElementById("form-join-mess");
  const messModal = document.getElementById("section-mess-modal");

  // 1. Create a Mess & Become Owner
  if (formCreateMess) {
    formCreateMess.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) {
        alert("Please sign in first to create a mess.");
        return;
      }

      const name = document.getElementById("create-mess-name").value.trim();
      const fixedCost = Number(document.getElementById("create-mess-fixed").value) || 800;
      const area = document.getElementById("create-mess-area").value.trim();
      const code = generateMessCode();

      if (!name) {
        alert("Please enter a mess name.");
        return;
      }

      const submitBtn = document.getElementById("btn-submit-create-mess");
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating mess...";

      const newMessData = {
        name,
        code,
        owner_uid: currentUser.uid,
        fixed_cost_share: fixedCost,
        area: area || "",
        created_at: serverTimestamp()
      };

      let messId = "mess_" + Date.now();
      let firestoreSynced = false;
      let firestoreErrorMsg = "";

      const isAuthActive = auth && auth.currentUser;

      if (db && isAuthActive) {
        try {
          const messRef = await addDoc(collection(db, "messes"), newMessData);
          messId = messRef.id;

          // Use setDoc with merge: true so it creates or updates without throwing No document to update
          await setDoc(doc(db, "users", currentUser.uid), {
            uid: currentUser.uid,
            name: currentUser.displayName || currentUser.email?.split("@")[0] || "Mess Owner",
            email: currentUser.email || "",
            mess_id: messId,
            role: "owner",
            status: "active",
            fixed_cost_share: fixedCost
          }, { merge: true });

          firestoreSynced = true;
        } catch (dbErr) {
          console.warn("Firestore save failed, falling back to local storage:", dbErr);
          firestoreErrorMsg = dbErr.message || String(dbErr);
        }
      } else if (!isAuthActive) {
        firestoreErrorMsg = "Not signed in to Firebase Auth. Created in local mode.";
      }

      // Always save locally so the user is never blocked!
      currentMess = { id: messId, ...newMessData };
      currentRole = "owner";
      currentStatus = "active";

      localStorage.setItem("hisabi_current_mess", JSON.stringify(currentMess));
      localStorage.setItem("hisabi_current_role", "owner");
      localStorage.setItem("hisabi_current_status", "active");

      // Save initial member list containing the owner
      const initialMember = {
        uid: currentUser.uid,
        name: currentUser.displayName || currentUser.email?.split("@")[0] || "Mess Owner",
        email: currentUser.email || "",
        role: "owner",
        status: "active",
        mess_id: messId,
        fixed_cost_share: fixedCost
      };
      state.members = [initialMember];
      localStorage.setItem("hisabi_members_" + messId, JSON.stringify(state.members));

      submitBtn.disabled = false;
      submitBtn.textContent = "Create Mess & Become Owner";

      if (messModal) messModal.classList.remove("active");
      formCreateMess.reset();

      if (firestoreSynced) {
        alert(`🎉 Congratulations! Mess "${name}" created!\nYou are now the Mess Owner.\n\nRoommate Invite Code: ${code}\n✅ Successfully saved and synced with Cloud Firestore!`);
      } else {
        alert(`🎉 Mess "${name}" created!\nYou are now the Mess Owner.\n\nRoommate Invite Code: ${code}\n\n⚠️ Cloud Sync Notice:\n${firestoreErrorMsg}\n\nYour mess is saved locally on this device. To sync across devices via Cloud Firestore, please ensure Firestore Rules are published in the Firebase Console.`);
        showFirestoreRulesBanner(firestoreErrorMsg);
      }

      await syncUserProfile(currentUser);
    });
  }

  // 2. Join a Mess via Invite Code
  if (formJoinMess) {
    formJoinMess.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentUser) {
        alert("Please sign in first to join a mess.");
        return;
      }

      const codeInput = document.getElementById("join-mess-code").value.trim().toUpperCase();
      if (!codeInput || codeInput.length < 4) {
        alert("Please enter a valid 6-character mess invite code.");
        return;
      }

      const submitBtn = document.getElementById("btn-submit-join-mess");
      submitBtn.disabled = true;
      submitBtn.textContent = "Searching mess...";

      try {
        let matchedMess = null;
        let firestoreJoinSynced = false;
        const isAuthActive = auth && auth.currentUser;

        if (db && isAuthActive) {
          try {
            const q = query(collection(db, "messes"), where("code", "==", codeInput));
            const snap = await getDocs(q);
            if (!snap.empty) {
              matchedMess = { id: snap.docs[0].id, ...snap.docs[0].data() };
            }
          } catch (err) {
            console.warn("Firestore query error for mess code:", err);
          }
        }

        // Fallback match in localStorage
        if (!matchedMess) {
          const localMess = localStorage.getItem("hisabi_current_mess");
          if (localMess) {
            try {
              const parsed = JSON.parse(localMess);
              if (parsed.code === codeInput) matchedMess = parsed;
            } catch (e) {}
          }
        }

        // Fallback match for demo code
        if (!matchedMess && (codeInput === "SMPAZ8" || codeInput === "SM8821" || codeInput.startsWith("SM"))) {
          matchedMess = { id: "mess_demo", name: "Green View Mess (SMPAZ8)", code: codeInput, owner_uid: "owner1", fixed_cost_share: 800 };
        }

        if (!matchedMess) {
          alert(`No mess found with Invite Code "${codeInput}". Please verify with your Mess Owner.`);
          return;
        }

        // Submit Join Request
        const requestData = {
          mess_id: matchedMess.id,
          mess_name: matchedMess.name,
          user_uid: currentUser.uid,
          user_name: currentUser.displayName || currentUser.email?.split("@")[0] || "Roommate",
          user_email: currentUser.email || "",
          user_phone: currentUser.phoneNumber || "",
          status: "pending",
          created_at: serverTimestamp()
        };

        if (db && isAuthActive) {
          try {
            await addDoc(collection(db, "join_requests"), requestData);
            await setDoc(doc(db, "users", currentUser.uid), {
              mess_id: matchedMess.id,
              status: "pending",
              role: "member"
            }, { merge: true });
            firestoreJoinSynced = true;
          } catch (err) {
            console.warn("Firestore join request save failed:", err);
          }
        }

        currentStatus = "pending";
        currentMess = matchedMess;
        localStorage.setItem("hisabi_current_mess", JSON.stringify(matchedMess));
        localStorage.setItem("hisabi_current_status", "pending");

        // Also add to local joinRequests array so it shows up in Owner's panel if on same device/browser
        const localReq = {
          id: "req_" + Date.now(),
          ...requestData,
          created_at: new Date().toISOString()
        };
        state.joinRequests.push(localReq);

        alert(`✅ Join request sent to "${matchedMess.name}"!\n\nThe Owner or Admin will approve your request shortly.`);
        if (messModal) messModal.classList.remove("active");
        await syncUserProfile(currentUser);
      } catch (err) {
        console.error("Join mess error:", err);
        alert("Could not submit join request: " + err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Request to Join Mess";
      }
    });
  }
}

/* ==========================================================================
   Phase 3: Firestore Data Fetching, CRUD & Financial Calculations
   ========================================================================== */

function getFallbackData() {
  const today = getTodayStr();
  const tomorrow = getTomorrowStr();
  const day2 = getFutureDateStr(2);
  const day3 = getFutureDateStr(3);
  const past1 = getPastDateStr(1);
  const past2 = getPastDateStr(2);
  const past3 = getPastDateStr(3);
  const past4 = getPastDateStr(4);
  const past5 = getPastDateStr(5);
  const selfUid = currentUser?.uid || "user_owner_demo";

  const members = [
    { uid: selfUid, name: currentUser?.displayName || "Tanvir Fahim", email: currentUser?.email || "tanvir@hisabi.app", phone: "+8801711001122", role: currentRole || "owner", fixed_cost_share: 800 },
    { uid: "u_sabbir", name: "Sabbir Ahmed", email: "sabbir@gmail.com", phone: "+8801712334455", role: "admin", fixed_cost_share: 800 },
    { uid: "u_rakib", name: "Rakibul Hasan", email: "rakib@gmail.com", phone: "+8801819887766", role: "manager", fixed_cost_share: 800 },
    { uid: "u_mahmud", name: "Mahmudul Hasan", email: "mahmud@gmail.com", phone: "+8801915667788", role: "member", fixed_cost_share: 800 },
    { uid: "u_kamrul", name: "Kamrul Islam", email: "kamrul@gmail.com", phone: "+8801612445566", role: "member", fixed_cost_share: 800 },
    { uid: "u_arif", name: "Arif Hossain", email: "arif@gmail.com", phone: "+8801511229900", role: "member", fixed_cost_share: 800 },
    { uid: "u_shakil", name: "Shakil Khan", email: "shakil@gmail.com", phone: "+8801723445566", role: "member", fixed_cost_share: 800 }
  ];

  const joinRequests = [
    { id: "req1", mess_id: currentMess?.id || "mess_demo", user_uid: "u_jamil", user_name: "Jamil Akhtar", user_email: "jamil@gmail.com", user_phone: "+8801811223344", status: "pending", created_at: today },
    { id: "req2", mess_id: currentMess?.id || "mess_demo", user_uid: "u_fahim", user_name: "Fahim Chowdhury", user_email: "fahim@gmail.com", user_phone: "+8801912334455", status: "pending", created_at: today }
  ];

  const expenses = [
    { id: "e1", amount: 2450, date: today, description: "Chicken, Rice, Oil, Onions", type: "daily", added_by: "manager" },
    { id: "e2", amount: 1850, date: past1, description: "Fish Bazar, Green Vegetables & Daal", type: "daily", added_by: "manager" },
    { id: "e3", amount: 3200, date: past2, description: "Beef Bazar, Spices & Garlic", type: "daily", added_by: "manager" },
    { id: "e4", amount: 950, date: past3, description: "Morning Eggs, Milk, Bread, Tea", type: "daily", added_by: "manager" },
    { id: "e5", amount: 1150, date: past4, description: "Fresh Vegetables, Potatoes & Fruits", type: "daily", added_by: "manager" },
    { id: "e6", amount: 1500, date: past5, description: "WiFi High-speed Fiber Bill", type: "fixed", added_by: "manager" },
    { id: "e7", amount: 2200, date: past5, description: "Utility Gas & Water Supply", type: "fixed", added_by: "manager" },
    { id: "e8", amount: 3500, date: past5, description: "Cook Khala Monthly Salary (Advance)", type: "fixed", added_by: "manager" }
  ];

  const deposits = [
    { id: "d1", user_uid: selfUid, amount: 4000, date: past5 },
    { id: "d2", user_uid: "u_sabbir", amount: 3500, date: past5 },
    { id: "d3", user_uid: "u_rakib", amount: 4500, date: past4 },
    { id: "d4", user_uid: "u_mahmud", amount: 3000, date: past4 },
    { id: "d5", user_uid: "u_kamrul", amount: 3500, date: past3 },
    { id: "d6", user_uid: "u_arif", amount: 3000, date: past3 },
    { id: "d7", user_uid: "u_shakil", amount: 3500, date: past2 }
  ];

  const meals = [
    // Tomorrow
    { date: tomorrow, user_uid: selfUid, morning: true, lunch: true, dinner: true },
    { date: tomorrow, user_uid: "u_sabbir", morning: false, lunch: true, dinner: true },
    { date: tomorrow, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: tomorrow, user_uid: "u_mahmud", morning: false, lunch: true, dinner: true },
    { date: tomorrow, user_uid: "u_kamrul", morning: true, lunch: false, dinner: true },
    { date: tomorrow, user_uid: "u_arif", morning: true, lunch: true, dinner: false },
    { date: tomorrow, user_uid: "u_shakil", morning: false, lunch: true, dinner: true },

    // Today
    { date: today, user_uid: selfUid, morning: true, lunch: true, dinner: true },
    { date: today, user_uid: "u_sabbir", morning: true, lunch: true, dinner: true },
    { date: today, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: today, user_uid: "u_mahmud", morning: false, lunch: true, dinner: true },
    { date: today, user_uid: "u_kamrul", morning: true, lunch: true, dinner: true },
    { date: today, user_uid: "u_arif", morning: true, lunch: true, dinner: true },
    { date: today, user_uid: "u_shakil", morning: true, lunch: true, dinner: false },

    // Day 2 (Day after tomorrow)
    { date: day2, user_uid: selfUid, morning: true, lunch: true, dinner: true },
    { date: day2, user_uid: "u_sabbir", morning: true, lunch: true, dinner: true },
    { date: day2, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: day2, user_uid: "u_mahmud", morning: true, lunch: true, dinner: true },
    { date: day2, user_uid: "u_kamrul", morning: false, lunch: true, dinner: true },
    { date: day2, user_uid: "u_arif", morning: true, lunch: false, dinner: true },
    { date: day2, user_uid: "u_shakil", morning: true, lunch: true, dinner: true },

    // Day 3 (In 3 days)
    { date: day3, user_uid: selfUid, morning: true, lunch: true, dinner: true },
    { date: day3, user_uid: "u_sabbir", morning: true, lunch: true, dinner: false },
    { date: day3, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: day3, user_uid: "u_mahmud", morning: false, lunch: true, dinner: true },
    { date: day3, user_uid: "u_kamrul", morning: true, lunch: true, dinner: true },
    { date: day3, user_uid: "u_arif", morning: true, lunch: true, dinner: true },
    { date: day3, user_uid: "u_shakil", morning: true, lunch: true, dinner: true },

    // Past Days (1 to 5) for rich chart and history
    { date: past1, user_uid: selfUid, morning: true, lunch: true, dinner: true },
    { date: past1, user_uid: "u_sabbir", morning: false, lunch: true, dinner: true },
    { date: past1, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: past1, user_uid: "u_mahmud", morning: true, lunch: true, dinner: true },
    { date: past1, user_uid: "u_kamrul", morning: true, lunch: false, dinner: true },
    { date: past1, user_uid: "u_arif", morning: true, lunch: true, dinner: true },
    { date: past1, user_uid: "u_shakil", morning: false, lunch: true, dinner: true },

    { date: past2, user_uid: selfUid, morning: false, lunch: true, dinner: true },
    { date: past2, user_uid: "u_sabbir", morning: true, lunch: true, dinner: false },
    { date: past2, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: past2, user_uid: "u_mahmud", morning: false, lunch: true, dinner: true },
    { date: past2, user_uid: "u_kamrul", morning: true, lunch: true, dinner: true },
    { date: past2, user_uid: "u_arif", morning: true, lunch: true, dinner: false },
    { date: past2, user_uid: "u_shakil", morning: true, lunch: true, dinner: true },

    { date: past3, user_uid: selfUid, morning: true, lunch: true, dinner: false },
    { date: past3, user_uid: "u_sabbir", morning: true, lunch: true, dinner: true },
    { date: past3, user_uid: "u_rakib", morning: true, lunch: true, dinner: true },
    { date: past3, user_uid: "u_mahmud", morning: true, lunch: true, dinner: true },
    { date: past3, user_uid: "u_kamrul", morning: false, lunch: true, dinner: true },
    { date: past3, user_uid: "u_arif", morning: true, lunch: true, dinner: true },
    { date: past3, user_uid: "u_shakil", morning: false, lunch: true, dinner: true }
  ];

  const bazarSchedule = [
    { date: tomorrow, user_uid: "u_rakib", status: "pending", budget: 2000, note: "Poultry, Rice & Daal" },
    { date: day2, user_uid: "u_sabbir", status: "pending", budget: 1800, note: "Fish & Cooking Oil" },
    { date: day3, user_uid: "u_kamrul", status: "pending", budget: 2200, note: "Vegetables & Spices" },
    { date: today, user_uid: "u_arif", status: "completed", budget: 1650, note: "Morning Groceries" },
    { date: past1, user_uid: "u_mahmud", status: "completed", budget: 1480, note: "Fish & Veg Bazar" }
  ];

  return { members, expenses, deposits, meals, bazarSchedule, joinRequests };
}

async function loadAllMessData() {
  checkCutoff();

  const tomorrowStr = getTomorrowStr();
  const targetDateElem = document.getElementById("meal-target-date");
  const dashTomorrowDate = document.getElementById("dash-tomorrow-date");
  if (targetDateElem) targetDateElem.textContent = `Tomorrow: ${getReadableDate(tomorrowStr)}`;
  if (dashTomorrowDate) dashTomorrowDate.textContent = `${getReadableDate(tomorrowStr)} • Cut-off at 11:00 PM`;

  let fetchedMembers = [];
  let fetchedExpenses = [];
  let fetchedDeposits = [];
  let fetchedMeals = [];
  let fetchedBazar = [];
  let fetchedRequests = [];
  let hadFirestoreSuccess = false;

  if (db && currentMess?.id && auth?.currentUser) {
    // Safely query each collection independently so one collection failure doesn't wipe everything
    try {
      const snap = await getDocs(query(collection(db, "users"), where("mess_id", "==", currentMess.id)));
      fetchedMembers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      hadFirestoreSuccess = true;
    } catch (e) {
      console.warn("Users query note:", e.message);
    }

    try {
      const snap = await getDocs(collection(db, "expenses"));
      fetchedExpenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}

    try {
      const snap = await getDocs(collection(db, "deposits"));
      fetchedDeposits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}

    try {
      const snap = await getDocs(collection(db, "meals"));
      fetchedMeals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}

    try {
      const snap = await getDocs(collection(db, "bazar_schedule"));
      fetchedBazar = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}

    try {
      const snap = await getDocs(query(collection(db, "join_requests"), where("mess_id", "==", currentMess.id), where("status", "==", "pending")));
      fetchedRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {}
  }

  if (hadFirestoreSuccess && fetchedMembers.length > 0) {
    state = {
      members: fetchedMembers,
      expenses: fetchedExpenses.length > 0 ? fetchedExpenses : (state.expenses || []),
      deposits: fetchedDeposits.length > 0 ? fetchedDeposits : (state.deposits || []),
      meals: fetchedMeals.length > 0 ? fetchedMeals : (state.meals || []),
      bazarSchedule: fetchedBazar.length > 0 ? fetchedBazar : (state.bazarSchedule || []),
      joinRequests: fetchedRequests.length > 0 ? fetchedRequests : (state.joinRequests || [])
    };
  } else {
    // If user has a real custom mess (created by them)
    if (currentMess && currentMess.id !== "mess_demo") {
      const selfUid = currentUser?.uid || "user_owner";
      const selfName = currentUser?.displayName || currentUser?.email?.split("@")[0] || "Mess Owner";

      // Load from local storage if available
      let localMembers = [];
      const savedMembersStr = localStorage.getItem("hisabi_members_" + currentMess.id);
      if (savedMembersStr) {
        try { localMembers = JSON.parse(savedMembersStr); } catch(e) {}
      }
      if (!localMembers || localMembers.length === 0) {
        localMembers = [
          { uid: selfUid, name: selfName, email: currentUser?.email || "", role: currentRole || "owner", fixed_cost_share: currentMess.fixed_cost_share || 800, status: "active" }
        ];
      }

      state.members = localMembers;
      if (!state.expenses) state.expenses = [];
      if (!state.deposits) state.deposits = [];
      if (!state.meals) state.meals = [];
      if (!state.bazarSchedule) state.bazarSchedule = [];
      if (!state.joinRequests) state.joinRequests = [];
    } else {
      state = getFallbackData();
    }
  }

  // Populate Member select dropdown in manager deposit form
  populateMemberDropdown();

  // Perform Financial Calculations & Update Dashboard UI
  calculateAndRenderFinancials();

  // Render Tomorrow's Meal toggles
  renderTomorrowMealToggles();

  // Render Meal History Table
  renderMealHistoryTable();

  // Render Bazar Roster & Duty Alert
  renderBazarRoster();

  // Update AI Cook stats for tomorrow
  updateTomorrowAICounts();

  // Render Owner & Admin Panels (Pending Requests & Member Roles)
  renderOwnerAndAdminPanels();

  // Render Dedicated Mess Owner Dashboard & Hub
  renderMessDashboardHub();
}

function populateMemberDropdown() {
  const select = document.getElementById("deposit-member");
  if (!select) return;

  select.innerHTML = "";
  state.members.forEach((member) => {
    const opt = document.createElement("option");
    opt.value = member.uid;
    opt.textContent = `${member.name} (${member.role || "member"})`;
    select.appendChild(opt);
  });
}

function calculateAndRenderFinancials() {
  const currentUid = currentUser?.uid || "user_owner_demo";

  // 1. Current Meal Rate = Total Daily Grocery Expenses / Total Meals Consumed by All Members
  const totalDailyGrocery = state.expenses
    .filter(e => e.type === "daily")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalMealsAllMembers = state.meals
    .reduce((sum, m) => {
      let count = 0;
      if (m.morning) count += 1;
      if (m.lunch) count += 1;
      if (m.dinner) count += 1;
      return sum + count;
    }, 0) || 1;

  const currentMealRate = totalDailyGrocery / totalMealsAllMembers;

  // 2. Personal Expense = (User's Total Meals × Current Meal Rate) + Fixed Cost Share
  const userMealsCount = state.meals
    .filter(m => m.user_uid === currentUid)
    .reduce((sum, m) => {
      let count = 0;
      if (m.morning) count += 1;
      if (m.lunch) count += 1;
      if (m.dinner) count += 1;
      return sum + count;
    }, 0);

  const currentUserProfile = state.members.find(m => m.uid === currentUid);
  const fixedCostShare = Number(currentUserProfile?.fixed_cost_share || currentMess?.fixed_cost_share || 800);
  const userMealCost = userMealsCount * currentMealRate;
  const personalExpense = userMealCost + fixedCostShare;

  // 3. Current Balance = (Total Deposits - Personal Expense)
  const userTotalDeposits = state.deposits
    .filter(d => d.user_uid === currentUid)
    .reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const userDepositsCount = state.deposits.filter(d => d.user_uid === currentUid).length;
  const currentBalance = userTotalDeposits - personalExpense;

  // Update DOM Elements
  const balanceElem = document.getElementById("stat-current-balance");
  const balanceTrend = document.getElementById("stat-balance-trend");
  const mealRateElem = document.getElementById("stat-meal-rate");
  const mealRateSub = document.getElementById("stat-meal-rate-sub");
  const personalExpenseElem = document.getElementById("stat-personal-expense");
  const personalExpenseSub = document.getElementById("stat-personal-expense-sub");
  const depositsElem = document.getElementById("stat-total-deposits");
  const depositsSub = document.getElementById("stat-total-deposits-sub");

  if (balanceElem) {
    balanceElem.textContent = `৳ ${currentBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (currentBalance >= 0) {
      balanceElem.className = "stat-main-val text-success";
      if (balanceTrend) {
        balanceTrend.className = "trend-badge positive";
        balanceTrend.textContent = "Available in hand";
      }
    } else {
      balanceElem.className = "stat-main-val text-danger";
      if (balanceTrend) {
        balanceTrend.className = "trend-badge";
        balanceTrend.style.background = "#FEE2E2";
        balanceTrend.style.color = "#DC2626";
        balanceTrend.textContent = "Due / Deficit";
      }
    }
  }

  if (mealRateElem) {
    mealRateElem.textContent = `৳ ${currentMealRate.toFixed(2)}`;
  }
  if (mealRateSub) {
    mealRateSub.textContent = `Bazar: ৳${totalDailyGrocery.toLocaleString()} / ${totalMealsAllMembers} meals`;
  }

  if (personalExpenseElem) {
    personalExpenseElem.textContent = `৳ ${personalExpense.toFixed(2)}`;
  }
  if (personalExpenseSub) {
    personalExpenseSub.textContent = `Meals (${userMealsCount}): ৳${userMealCost.toFixed(0)} + Fixed: ৳${fixedCostShare}`;
  }

  if (depositsElem) {
    depositsElem.textContent = `৳ ${userTotalDeposits.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (depositsSub) {
    depositsSub.textContent = `${userDepositsCount} deposit${userDepositsCount === 1 ? "" : "s"} recorded`;
  }
}

function updateMealSwitchBadges() {
  const tB = document.getElementById("toggle-breakfast");
  const tL = document.getElementById("toggle-lunch");
  const tD = document.getElementById("toggle-dinner");
  const bB = document.getElementById("badge-toggle-breakfast");
  const bL = document.getElementById("badge-toggle-lunch");
  const bD = document.getElementById("badge-toggle-dinner");

  if (bB && tB) {
    bB.textContent = tB.checked ? "ON" : "OFF";
    bB.className = tB.checked ? "meal-live-badge on" : "meal-live-badge off";
  }
  if (bL && tL) {
    bL.textContent = tL.checked ? "ON" : "OFF";
    bL.className = tL.checked ? "meal-live-badge on" : "meal-live-badge off";
  }
  if (bD && tD) {
    bD.textContent = tD.checked ? "ON" : "OFF";
    bD.className = tD.checked ? "meal-live-badge on" : "meal-live-badge off";
  }
}

function renderMealToggles(targetDate) {
  const currentUid = currentUser?.uid || "user_owner_demo";
  const dateKey = targetDate || selectedMealDate || getTomorrowStr();
  selectedMealDate = dateKey;

  const targetDateElem = document.getElementById("meal-target-date");
  const selectedDayBadge = document.getElementById("meal-selected-day-badge");
  const roommateDateBadge = document.getElementById("roommate-board-date-badge");

  let dayLabel = "Tomorrow";
  if (dateKey === getTodayStr()) dayLabel = "Today";
  else if (dateKey === getFutureDateStr(2)) dayLabel = "Day After";
  else if (dateKey === getFutureDateStr(3)) dayLabel = "In 3 Days";
  else if (dateKey !== getTomorrowStr()) dayLabel = getReadableDate(dateKey);

  if (targetDateElem) targetDateElem.textContent = `${dayLabel}: ${getReadableDate(dateKey)}`;
  if (selectedDayBadge) selectedDayBadge.textContent = dayLabel;
  if (roommateDateBadge) roommateDateBadge.textContent = dayLabel;

  const userMeal = state.meals.find(m => m.date === dateKey && m.user_uid === currentUid) || {
    morning: true,
    lunch: true,
    dinner: false
  };

  const toggleBreakfast = document.getElementById("toggle-breakfast");
  const toggleLunch = document.getElementById("toggle-lunch");
  const toggleDinner = document.getElementById("toggle-dinner");

  if (toggleBreakfast) toggleBreakfast.checked = Boolean(userMeal.morning);
  if (toggleLunch) toggleLunch.checked = Boolean(userMeal.lunch);
  if (toggleDinner) toggleDinner.checked = Boolean(userMeal.dinner);

  updateMealSwitchBadges();

  if (dateKey === getTomorrowStr()) {
    updateDashboardMealPills(userMeal);
  }

  // Render Roommate Meal Board and Cook Headcount
  renderRoommateMealBoard(dateKey);
  updateCookHeadcount(dateKey);
}

function renderTomorrowMealToggles() {
  renderMealToggles(selectedMealDate || getTomorrowStr());
}

function renderRoommateMealBoard(targetDate) {
  const container = document.getElementById("roommate-meal-chips-list");
  if (!container) return;

  const dateKey = targetDate || selectedMealDate || getTomorrowStr();
  const currentUid = currentUser?.uid || "user_owner_demo";
  const members = state.members && state.members.length > 0 ? state.members : [];

  if (members.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:14px; color:var(--text-muted); font-size:12.5px;">No roommates registered in this mess yet.</div>`;
    return;
  }

  container.innerHTML = members.map((member) => {
    const meal = state.meals.find(m => m.date === dateKey && m.user_uid === member.uid) || {
      morning: false,
      lunch: false,
      dinner: false
    };

    const isSelf = member.uid === currentUid;
    const roleBadgeClass = getRoleBadgeClass(member.role);
    const initials = getInitials(member.name);

    return `
      <div class="roommate-meal-row">
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="member-avatar" style="width:34px; height:34px; font-size:12px; font-weight:700;">${initials}</div>
          <div>
            <div style="font-size:13px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:6px;">
              ${member.name}
              ${isSelf ? '<span class="badge badge-primary" style="font-size:9.5px; padding:1px 5px;">You</span>' : ''}
              <span class="${roleBadgeClass}" style="font-size:9.5px; padding:1px 5px;">${member.role}</span>
            </div>
            <div style="font-size:11px; color:var(--text-muted);">${member.phone || member.email || ''}</div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
          <button type="button" class="meal-chip-toggle ${meal.morning ? 'on' : 'off'}" data-meal-toggle-btn="true" data-uid="${member.uid}" data-meal="morning" title="Toggle Breakfast for ${member.name}">
            🌅 Brk: <strong>${meal.morning ? 'ON' : 'OFF'}</strong>
          </button>
          <button type="button" class="meal-chip-toggle ${meal.lunch ? 'on' : 'off'}" data-meal-toggle-btn="true" data-uid="${member.uid}" data-meal="lunch" title="Toggle Lunch for ${member.name}">
            ☀️ Lun: <strong>${meal.lunch ? 'ON' : 'OFF'}</strong>
          </button>
          <button type="button" class="meal-chip-toggle ${meal.dinner ? 'on' : 'off'}" data-meal-toggle-btn="true" data-uid="${member.uid}" data-meal="dinner" title="Toggle Dinner for ${member.name}">
            🌙 Din: <strong>${meal.dinner ? 'ON' : 'OFF'}</strong>
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Attach click listeners to all meal chip toggles
  const chipButtons = container.querySelectorAll("[data-meal-toggle-btn='true']");
  chipButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetUid = btn.getAttribute("data-uid");
      const mealType = btn.getAttribute("data-meal"); // 'morning', 'lunch', 'dinner'
      if (!targetUid || !mealType) return;

      // Check cut-off rule if date is tomorrow
      if (dateKey === getTomorrowStr() && checkCutoff()) {
        alert("Cut-off time reached! Meal toggles freeze at 11:00 PM.");
        return;
      }

      let mealRecord = state.meals.find(m => m.date === dateKey && m.user_uid === targetUid);
      if (!mealRecord) {
        mealRecord = {
          date: dateKey,
          user_uid: targetUid,
          morning: false,
          lunch: false,
          dinner: false
        };
        state.meals.push(mealRecord);
      }

      // Flip toggle
      mealRecord[mealType] = !mealRecord[mealType];
      mealRecord.updatedAt = serverTimestamp();

      // Persist to Firestore if available
      if (db) {
        try {
          const docId = `${dateKey}_${targetUid}`;
          await setDoc(doc(db, "meals", docId), mealRecord, { merge: true });
        } catch (e) {
          console.warn("Could not sync meal chip to Firestore:", e.message);
        }
      }

      // If toggled for self and currently viewing this date, update switch inputs
      if (targetUid === currentUid && dateKey === (selectedMealDate || getTomorrowStr())) {
        const tB = document.getElementById("toggle-breakfast");
        const tL = document.getElementById("toggle-lunch");
        const tD = document.getElementById("toggle-dinner");
        if (mealType === "morning" && tB) tB.checked = mealRecord.morning;
        if (mealType === "lunch" && tL) tL.checked = mealRecord.lunch;
        if (mealType === "dinner" && tD) tD.checked = mealRecord.dinner;
        updateMealSwitchBadges();
        if (dateKey === getTomorrowStr()) {
          updateDashboardMealPills(mealRecord);
        }
      }

      // Recalculate totals and financials
      calculateAndRenderFinancials();
      renderRoommateMealBoard(dateKey);
      updateCookHeadcount(dateKey);
      updateTomorrowAICounts();
    });
  });
}

function updateCookHeadcount(targetDate) {
  const dateKey = targetDate || selectedMealDate || getTomorrowStr();
  const cBreakfast = document.getElementById("cook-count-breakfast");
  const cLunch = document.getElementById("cook-count-lunch");
  const cDinner = document.getElementById("cook-count-dinner");
  const cTotal = document.getElementById("cook-count-total");
  const dateTxt = document.getElementById("cook-summary-date-txt");

  let brkCount = 0;
  let lunCount = 0;
  let dinCount = 0;

  const members = state.members && state.members.length > 0 ? state.members : [];
  members.forEach((member) => {
    const meal = state.meals.find(m => m.date === dateKey && m.user_uid === member.uid);
    if (meal) {
      if (meal.morning) brkCount += 1;
      if (meal.lunch) lunCount += 1;
      if (meal.dinner) dinCount += 1;
    }
  });

  if (cBreakfast) cBreakfast.textContent = brkCount;
  if (cLunch) cLunch.textContent = lunCount;
  if (cDinner) cDinner.textContent = dinCount;
  if (cTotal) cTotal.textContent = brkCount + lunCount + dinCount;

  if (dateTxt) {
    if (dateKey === getTomorrowStr()) dateTxt.textContent = "Tomorrow";
    else if (dateKey === getTodayStr()) dateTxt.textContent = "Today";
    else dateTxt.textContent = getReadableDate(dateKey);
  }
}

function updateDashboardMealPills(meal) {
  const pBreakfast = document.getElementById("dash-pill-breakfast");
  const sBreakfast = document.getElementById("dash-state-breakfast");
  const pLunch = document.getElementById("dash-pill-lunch");
  const sLunch = document.getElementById("dash-state-lunch");
  const pDinner = document.getElementById("dash-pill-dinner");
  const sDinner = document.getElementById("dash-state-dinner");

  if (pBreakfast && sBreakfast) {
    pBreakfast.className = meal.morning ? "meal-mini-pill active" : "meal-mini-pill inactive";
    sBreakfast.textContent = meal.morning ? "ON" : "OFF";
  }
  if (pLunch && sLunch) {
    pLunch.className = meal.lunch ? "meal-mini-pill active" : "meal-mini-pill inactive";
    sLunch.textContent = meal.lunch ? "ON" : "OFF";
  }
  if (pDinner && sDinner) {
    pDinner.className = meal.dinner ? "meal-mini-pill active" : "meal-mini-pill inactive";
    sDinner.textContent = meal.dinner ? "ON" : "OFF";
  }
}

function renderMealHistoryTable() {
  const tbody = document.getElementById("meal-history-tbody");
  if (!tbody) return;

  const currentUid = currentUser?.uid || "user_owner_demo";
  const userMeals = state.meals
    .filter(m => m.user_uid === currentUid)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  if (userMeals.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No past meal records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = userMeals.map((m) => {
    const total = (m.morning ? 1 : 0) + (m.lunch ? 1 : 0) + (m.dinner ? 1 : 0);
    return `
      <tr>
        <td>${getReadableDate(m.date)}</td>
        <td><span class="${m.morning ? 'tag-on' : 'tag-off'}">${m.morning ? '1' : '0'}</span></td>
        <td><span class="${m.lunch ? 'tag-on' : 'tag-off'}">${m.lunch ? '1' : '0'}</span></td>
        <td><span class="${m.dinner ? 'tag-on' : 'tag-off'}">${m.dinner ? '1' : '0'}</span></td>
        <td><strong>${total.toFixed(1)}</strong></td>
      </tr>
    `;
  }).join("");
}

function renderBazarRoster() {
  const currentUid = currentUser?.uid || "user_owner_demo";
  const tomorrowStr = getTomorrowStr();

  const tomorrowDuty = state.bazarSchedule.find(s => s.date === tomorrowStr);
  const dutyAlert = document.getElementById("duty-alert");

  if (dutyAlert) {
    if (tomorrowDuty && tomorrowDuty.user_uid === currentUid) {
      dutyAlert.style.display = "flex";
      dutyAlert.className = "alert-banner warning-banner";
      dutyAlert.innerHTML = `
        <div class="alert-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
        </div>
        <div class="alert-content">
          <h4 class="alert-title">Tomorrow is Your Turn for Bazar Duty!</h4>
          <p class="alert-desc">Scheduled for <strong>${getReadableDate(tomorrowStr)}</strong>. Estimated budget: ৳${tomorrowDuty.budget || 1500} (${tomorrowDuty.note || 'Grocery'}).</p>
        </div>
      `;
    } else if (tomorrowDuty) {
      const assignedMember = state.members.find(m => m.uid === tomorrowDuty.user_uid);
      const name = assignedMember?.name || "Mess Member";
      dutyAlert.style.display = "flex";
      dutyAlert.className = "alert-banner";
      dutyAlert.style.background = "#EFF6FF";
      dutyAlert.style.borderColor = "#BFDBFE";
      dutyAlert.innerHTML = `
        <div class="alert-icon" style="color:var(--primary);">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"></circle>
            <circle cx="20" cy="21" r="1"></circle>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
          </svg>
        </div>
        <div class="alert-content">
          <h4 class="alert-title" style="color:#1E40AF;">Tomorrow's Bazar Duty: ${name}</h4>
          <p class="alert-desc" style="color:#1D4ED8;">Scheduled on ${getReadableDate(tomorrowStr)}. Est. budget: ৳${tomorrowDuty.budget || 1500}.</p>
        </div>
      `;
    } else {
      dutyAlert.style.display = "none";
    }
  }

  // Upcoming Roster on Dashboard
  const dashRosterList = document.getElementById("dash-roster-list");
  const fullRosterList = document.getElementById("bazar-schedule-list");

  const upcomingItems = [...state.bazarSchedule]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  if (dashRosterList) {
    dashRosterList.innerHTML = upcomingItems.map((item) => {
      const isSelf = item.user_uid === currentUid;
      const member = state.members.find(m => m.uid === item.user_uid);
      const memberName = member?.name || "Member";
      const parts = item.date.split("-");
      const dayNum = parts[2] || "15";
      const monthStr = "OCT";

      return `
        <div class="roster-item ${isSelf ? 'active-user-duty' : ''}">
          <div class="roster-date-box ${isSelf ? 'highlight' : ''}">
            <span class="date-num">${dayNum}</span>
            <span class="date-month">${monthStr}</span>
          </div>
          <div class="roster-info">
            <div class="roster-person">
              <strong>${memberName}</strong> ${isSelf ? '<span class="badge badge-sm badge-primary">You</span>' : ''}
            </div>
            <span class="roster-meta">${getReadableDate(item.date)} &bull; Est. ৳${item.budget || 1500}</span>
          </div>
          <span class="badge ${isSelf ? 'badge-warning' : 'badge-neutral'}">${isSelf ? 'Your Duty' : (item.status === 'completed' ? 'Done' : 'Scheduled')}</span>
        </div>
      `;
    }).join("");
  }

  if (fullRosterList) {
    fullRosterList.innerHTML = state.bazarSchedule.map((item) => {
      const isSelf = item.user_uid === currentUid;
      const member = state.members.find(m => m.uid === item.user_uid);
      const memberName = member?.name || "Member";

      return `
        <div class="roster-row-full ${isSelf ? 'active-duty' : (item.status === 'completed' ? 'completed-duty' : '')}">
          <div class="duty-badge-col">
            <span class="badge ${isSelf ? 'badge-warning' : 'badge-neutral'}">${getReadableDate(item.date)}</span>
          </div>
          <div class="duty-member-col">
            <strong>${memberName} ${isSelf ? '(You)' : ''}</strong>
            <small>Est. Budget: ৳${item.budget || 1500} &bull; ${item.note || 'Grocery'}</small>
          </div>
          <div class="duty-status-col">
            <span class="badge ${item.status === 'completed' ? 'badge-success' : 'badge-neutral'}">${item.status === 'completed' ? 'Done' : 'Pending'}</span>
          </div>
        </div>
      `;
    }).join("");
  }
}

function updateTomorrowAICounts() {
  const tomorrowStr = getTomorrowStr();
  const tomorrowMeals = state.meals.filter(m => m.date === tomorrowStr);

  const lunchCount = tomorrowMeals.filter(m => m.lunch).length;
  const dinnerCount = tomorrowMeals.filter(m => m.dinner).length;

  const lunchElem = document.getElementById("ai-count-lunch");
  const dinnerElem = document.getElementById("ai-count-dinner");

  if (lunchElem) lunchElem.textContent = `${lunchCount} Meals`;
  if (dinnerElem) dinnerElem.textContent = `${dinnerCount} Meals`;
}

/* ==========================================================================
   Admin & Owner Privilege Operations (Approve Requests, Promote/Demote Roles)
   ========================================================================== */
function renderOwnerAndAdminPanels() {
  const cardInvite = document.getElementById("card-mess-invite");
  const cardRequests = document.getElementById("card-join-requests");
  const cardRoles = document.getElementById("card-member-roles");
  const displayCode = document.getElementById("display-invite-code");
  const inviteMessName = document.getElementById("invite-mess-name");
  const badgeCurrentRole = document.getElementById("badge-current-mess-role");
  const badgePendingCount = document.getElementById("badge-pending-count");
  const badgeTotalMembers = document.getElementById("badge-total-members");

  const isOwner = currentRole === "owner";
  const isAdmin = currentRole === "admin";
  const isAuthorized = isOwner || isAdmin;

  // Invite Code display for all mess managers & above
  if (cardInvite) {
    if (currentMess) {
      cardInvite.style.display = "block";
      if (displayCode) displayCode.textContent = currentMess.code || "SMPAZ8";
      if (inviteMessName) inviteMessName.textContent = currentMess.name || "My Mess";
      if (badgeCurrentRole) {
        badgeCurrentRole.textContent = currentRole.toUpperCase();
        badgeCurrentRole.className = getRoleBadgeClass(currentRole);
      }
    } else {
      cardInvite.style.display = "none";
    }
  }

  // Only Owner and Admin can approve join requests and manage member roles
  if (cardRequests) {
    cardRequests.style.display = isAuthorized ? "block" : "none";
  }
  if (cardRoles) {
    cardRoles.style.display = isAuthorized ? "block" : "none";
  }

  if (!isAuthorized) return;

  // 1. Render Pending Join Requests
  const requestsList = document.getElementById("join-requests-list");
  const pendingRequests = state.joinRequests || [];

  if (badgePendingCount) {
    badgePendingCount.textContent = `${pendingRequests.length} Pending`;
  }

  if (requestsList) {
    if (pendingRequests.length === 0) {
      requestsList.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:12.5px;">No pending join requests at this time.</div>`;
    } else {
      requestsList.innerHTML = pendingRequests.map((req) => `
        <div class="request-row-card">
          <div class="request-info-col">
            <div class="member-name-bold">${req.user_name}</div>
            <span class="member-meta-small">${req.user_phone || req.user_email || "New Roommate"} &bull; Requested ${getReadableDate(req.created_at || getTodayStr())}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-xs btn-sm-success btn-approve-request" data-req-id="${req.id}" data-user-uid="${req.user_uid}" data-user-name="${req.user_name}">
              ✓ Approve
            </button>
            <button type="button" class="btn btn-xs btn-sm-danger btn-reject-request" data-req-id="${req.id}">
              ✕ Reject
            </button>
          </div>
        </div>
      `).join("");

      // Attach handlers for Approve & Reject
      requestsList.querySelectorAll(".btn-approve-request").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const reqId = btn.getAttribute("data-req-id");
          const userUid = btn.getAttribute("data-user-uid");
          const userName = btn.getAttribute("data-user-name");
          await handleApproveJoinRequest(reqId, userUid, userName);
        });
      });

      requestsList.querySelectorAll(".btn-reject-request").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const reqId = btn.getAttribute("data-req-id");
          await handleRejectJoinRequest(reqId);
        });
      });
    }
  }

  // 2. Render Mess Members & Role Assignment
  const membersList = document.getElementById("mess-members-admin-list");
  if (badgeTotalMembers) {
    badgeTotalMembers.textContent = `${state.members.length} Members`;
  }

  if (membersList) {
    membersList.innerHTML = state.members.map((member) => {
      const isSelf = member.uid === currentUser?.uid;
      const memberRole = member.role || "member";

      return `
        <div class="member-row-card">
          <div class="member-info-col">
            <div class="member-name-bold">
              ${member.name}
              ${isSelf ? '<span class="badge badge-sm badge-primary">You</span>' : ''}
              <span class="${getRoleBadgeClass(memberRole)}">${memberRole.toUpperCase()}</span>
            </div>
            <span class="member-meta-small">${member.email || member.phone || "Active Member"}</span>
          </div>
          <div>
            ${isSelf ? '<span style="font-size:11.5px; color:var(--text-muted);">Current User</span>' : `
              <select class="role-select-box member-role-dropdown" data-uid="${member.uid}" data-name="${member.name}" ${(!isOwner && memberRole === "owner") || (!isOwner && memberRole === "admin") ? 'disabled' : ''}>
                ${isOwner ? '<option value="admin" ' + (memberRole === "admin" ? "selected" : "") + '>Admin</option>' : ''}
                <option value="manager" ${memberRole === "manager" ? "selected" : ""}>Manager</option>
                <option value="member" ${memberRole === "member" ? "selected" : ""}>Member</option>
              </select>
            `}
          </div>
        </div>
      `;
    }).join("");

    // Attach Role Change Handlers
    membersList.querySelectorAll(".member-role-dropdown").forEach((select) => {
      select.addEventListener("change", async (e) => {
        const targetUid = select.getAttribute("data-uid");
        const targetName = select.getAttribute("data-name");
        const newRole = e.target.value;
        await handleChangeMemberRole(targetUid, targetName, newRole);
      });
    });
  }
}

/* ==========================================================================
   Mess Owner Dashboard Hub: Monthly Meal Chart, Bazar, & Roommate Ledger
   ========================================================================== */
function renderMessDashboardHub() {
  const hubSection = document.getElementById("section-mess-dashboard");
  if (!hubSection) return;

  const messName = currentMess?.name || "Smart Mess System";
  const messArea = currentMess?.area ? `📍 ${currentMess.area}` : "📍 Dhaka, Bangladesh";
  const messCode = currentMess?.code || "SMPAZ8";
  const fixedCost = Number(currentMess?.fixed_cost_share || 800);
  const isOwner = currentRole === "owner";

  // 1. Hero Card Elements
  const elemName = document.getElementById("hub-mess-name");
  const elemArea = document.getElementById("hub-mess-area");
  const elemRole = document.getElementById("hub-user-role-badge");
  const elemCode = document.getElementById("hub-invite-code");

  if (elemName) elemName.textContent = messName;
  if (elemArea) elemArea.textContent = messArea;
  if (elemRole) {
    if (isOwner) {
      elemRole.textContent = "👑 Mess Owner";
      elemRole.className = "badge badge-warning";
    } else if (currentRole === "admin") {
      elemRole.textContent = "🛡️ Mess Admin";
      elemRole.className = "badge badge-admin";
    } else if (currentRole === "manager") {
      elemRole.textContent = "📋 Mess Manager";
      elemRole.className = "badge badge-manager";
    } else {
      elemRole.textContent = "👤 Mess Member";
      elemRole.className = "badge badge-neutral";
    }
  }
  if (elemCode) elemCode.textContent = messCode;

  // 2. Financial & Meal Aggregates
  const totalDailyGrocery = state.expenses
    .filter(e => e.type === "daily")
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const totalMealsAllMembers = state.meals
    .reduce((sum, m) => {
      let c = 0;
      if (m.morning) c += 1;
      if (m.lunch) c += 1;
      if (m.dinner) c += 1;
      return sum + c;
    }, 0) || 1;

  const currentMealRate = totalDailyGrocery / totalMealsAllMembers;

  const statMembers = document.getElementById("hub-stat-members");
  const statFixedSub = document.getElementById("hub-stat-fixed-sub");
  const statMeals = document.getElementById("hub-stat-meals");
  const statBazar = document.getElementById("hub-stat-bazar");
  const statRate = document.getElementById("hub-stat-rate");

  if (statMembers) statMembers.textContent = `${state.members.length} Active`;
  if (statFixedSub) statFixedSub.textContent = `Fixed: ৳${fixedCost}/roommate`;
  if (statMeals) statMeals.textContent = `${totalMealsAllMembers.toFixed(1)} Meals`;
  if (statBazar) statBazar.textContent = `৳ ${totalDailyGrocery.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (statRate) statRate.textContent = `৳ ${currentMealRate.toFixed(2)}`;

  // TAB 1: Monthly Meal Chart & Breakdown
  renderHubMealChart(totalMealsAllMembers);

  // TAB 2: Bazar Management
  renderHubBazarSection();

  // TAB 3: Roommates & Financial Ledger
  renderHubMembersLedger(currentMealRate, fixedCost);

  // TAB 4: Owner Settings & Actions
  renderHubOwnerSettings();
}

function renderHubMealChart(totalMessMeals) {
  const breakfastCount = state.meals.reduce((sum, m) => sum + (m.morning ? 1 : 0), 0);
  const lunchCount = state.meals.reduce((sum, m) => sum + (m.lunch ? 1 : 0), 0);
  const dinnerCount = state.meals.reduce((sum, m) => sum + (m.dinner ? 1 : 0), 0);

  const bEl = document.getElementById("hub-meals-breakfast-count");
  const lEl = document.getElementById("hub-meals-lunch-count");
  const dEl = document.getElementById("hub-meals-dinner-count");

  if (bEl) bEl.textContent = breakfastCount;
  if (lEl) lEl.textContent = lunchCount;
  if (dEl) dEl.textContent = dinnerCount;

  // Member Meal Progress Bars
  const barsContainer = document.getElementById("hub-member-meal-bars");
  if (barsContainer) {
    if (state.members.length === 0) {
      barsContainer.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted);">No members recorded.</div>`;
    } else {
      barsContainer.innerHTML = state.members.map((member) => {
        const userMeals = state.meals.filter(m => m.user_uid === member.uid);
        const b = userMeals.reduce((s, m) => s + (m.morning ? 1 : 0), 0);
        const l = userMeals.reduce((s, m) => s + (m.lunch ? 1 : 0), 0);
        const d = userMeals.reduce((s, m) => s + (m.dinner ? 1 : 0), 0);
        const total = b + l + d;
        const percentage = totalMessMeals > 0 ? ((total / totalMessMeals) * 100).toFixed(1) : "0.0";

        const pB = total > 0 ? ((b / total) * 100).toFixed(1) : 0;
        const pL = total > 0 ? ((l / total) * 100).toFixed(1) : 0;
        const pD = total > 0 ? ((d / total) * 100).toFixed(1) : 0;

        const isSelf = member.uid === currentUser?.uid;

        return `
          <div class="member-meal-bar-row">
            <div class="member-meal-bar-meta">
              <span style="display:flex; align-items:center; gap:6px;">
                <strong>${member.name}</strong>
                ${isSelf ? '<span class="badge badge-sm badge-primary">You</span>' : ''}
              </span>
              <span style="color:var(--primary); font-weight:700;">${total.toFixed(1)} meals (${percentage}%)</span>
            </div>
            <div class="member-meal-progress-bg">
              <div class="progress-segment-breakfast" style="width:${pB}%;" title="Breakfast: ${b}"></div>
              <div class="progress-segment-lunch" style="width:${pL}%;" title="Lunch: ${l}"></div>
              <div class="progress-segment-dinner" style="width:${pD}%;" title="Dinner: ${d}"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-top:3px;">
              <span>🌅 সকাল: ${b}</span>
              <span>☀️ দুপুর: ${l}</span>
              <span>🌙 রাত: ${d}</span>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // Daily Mess Meal Matrix
  const matrixTbody = document.getElementById("hub-daily-meal-matrix");
  if (matrixTbody) {
    const datesMap = {};
    state.meals.forEach((m) => {
      if (!datesMap[m.date]) {
        datesMap[m.date] = { morning: 0, lunch: 0, dinner: 0, total: 0 };
      }
      if (m.morning) { datesMap[m.date].morning += 1; datesMap[m.date].total += 1; }
      if (m.lunch) { datesMap[m.date].lunch += 1; datesMap[m.date].total += 1; }
      if (m.dinner) { datesMap[m.date].dinner += 1; datesMap[m.date].total += 1; }
    });

    const sortedDates = Object.keys(datesMap).sort((a, b) => b.localeCompare(a)).slice(0, 10);

    if (sortedDates.length === 0) {
      matrixTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No meal history recorded yet.</td></tr>`;
    } else {
      matrixTbody.innerHTML = sortedDates.map((date) => {
        const d = datesMap[date];
        return `
          <tr>
            <td><strong>${getReadableDate(date)}</strong></td>
            <td><span class="${d.morning > 0 ? 'tag-on' : 'tag-off'}">${d.morning}</span></td>
            <td><span class="${d.lunch > 0 ? 'tag-on' : 'tag-off'}">${d.lunch}</span></td>
            <td><span class="${d.dinner > 0 ? 'tag-on' : 'tag-off'}">${d.dinner}</span></td>
            <td><strong>${d.total.toFixed(1)}</strong></td>
          </tr>
        `;
      }).join("");
    }
  }
}

function renderHubBazarSection() {
  const scheduleContainer = document.getElementById("hub-bazar-schedule-list");
  if (scheduleContainer) {
    const sortedDuties = [...state.bazarSchedule].sort((a, b) => a.date.localeCompare(b.date));
    if (sortedDuties.length === 0) {
      scheduleContainer.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:12.5px;">No upcoming bazar duties scheduled.</div>`;
    } else {
      scheduleContainer.innerHTML = sortedDuties.map((duty) => {
        const assignedMember = state.members.find(m => m.uid === duty.user_uid);
        const name = assignedMember?.name || "Mess Roommate";
        const isDone = duty.status === "completed";

        return `
          <div class="roster-row-full" style="padding:10px 12px; border:1px solid var(--surface-border); border-radius:var(--radius-sm); margin-bottom:8px;">
            <div class="duty-member-col">
              <div class="avatar-sm">${getInitials(name)}</div>
              <div>
                <span class="duty-name-bold">${name}</span>
                <span class="duty-timing-meta">${getReadableDate(duty.date)} &bull; ৳${duty.budget || 1500} (${duty.note || "Grocery"})</span>
              </div>
            </div>
            <div>
              <span class="badge ${isDone ? 'badge-success' : 'badge-warning'}">${isDone ? '✓ Completed' : '⏳ Scheduled'}</span>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // Recent Bazar Grocery Expenses
  const expensesContainer = document.getElementById("hub-bazar-expenses-list");
  if (expensesContainer) {
    const dailyExpenses = state.expenses
      .filter(e => e.type === "daily")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 6);

    if (dailyExpenses.length === 0) {
      expensesContainer.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:12.5px;">No bazar expenses logged yet.</div>`;
    } else {
      expensesContainer.innerHTML = dailyExpenses.map((exp) => {
        return `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:var(--bg-app); border-radius:var(--radius-sm); margin-bottom:6px; border:1px solid var(--surface-border);">
            <div>
              <div style="font-weight:700; font-size:13px; color:var(--text-main);">${exp.description || "Daily Bazar"}</div>
              <div style="font-size:11px; color:var(--text-muted);">${getReadableDate(exp.date)}</div>
            </div>
            <div style="font-size:14px; font-weight:800; color:var(--danger);">
              ৳ ${Number(exp.amount).toLocaleString()}
            </div>
          </div>
        `;
      }).join("");
    }
  }
}

function renderHubMembersLedger(currentMealRate, fixedCostShare) {
  const countBadge = document.getElementById("hub-members-count-badge");
  if (countBadge) countBadge.textContent = `${state.members.length} Roommates`;

  const ledgerContainer = document.getElementById("hub-members-ledger-list");
  if (!ledgerContainer) return;

  const isOwner = currentRole === "owner";

  if (state.members.length === 0) {
    ledgerContainer.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted);">No members found in this mess.</div>`;
    return;
  }

  ledgerContainer.innerHTML = state.members.map((member) => {
    const isSelf = member.uid === currentUser?.uid;
    const memberRole = member.role || "member";

    // 1. Calculate user's meals
    const userMeals = state.meals.filter(m => m.user_uid === member.uid);
    const mealsCount = userMeals.reduce((sum, m) => sum + (m.morning ? 1 : 0) + (m.lunch ? 1 : 0) + (m.dinner ? 1 : 0), 0);
    const userMealCost = mealsCount * currentMealRate;
    const fixedShare = Number(member.fixed_cost_share || fixedCostShare || 800);
    const personalExpense = userMealCost + fixedShare;

    // 2. Calculate user's deposits
    const totalDeposits = state.deposits
      .filter(d => d.user_uid === member.uid)
      .reduce((sum, d) => sum + Number(d.amount || 0), 0);

    // 3. Net Balance
    const netBalance = totalDeposits - personalExpense;
    const isPositive = netBalance >= 0;

    return `
      <div class="member-ledger-card">
        <div class="member-ledger-header">
          <div class="member-ledger-user">
            <div class="member-ledger-avatar">${getInitials(member.name)}</div>
            <div>
              <div style="display:flex; align-items:center; gap:6px;">
                <strong style="font-size:14px;">${member.name}</strong>
                ${isSelf ? '<span class="badge badge-sm badge-primary">You</span>' : ''}
              </div>
              <span class="${getRoleBadgeClass(memberRole)}" style="margin-top:2px;">${memberRole.toUpperCase()}</span>
            </div>
          </div>

          <div class="balance-chip ${isPositive ? 'positive' : 'negative'}">
            ${isPositive ? '+' : '-'}৳ ${Math.abs(netBalance).toFixed(1)} ${isPositive ? 'Surplus (জমা)' : 'Due (বাকি)'}
          </div>
        </div>

        <div class="member-ledger-stats">
          <div class="member-ledger-stat-item">
            <span class="val">${mealsCount} <small>(৳${userMealCost.toFixed(0)})</small></span>
            <span class="lbl">Meals Taken</span>
          </div>
          <div class="member-ledger-stat-item">
            <span class="val">৳ ${fixedShare}</span>
            <span class="lbl">Fixed Share</span>
          </div>
          <div class="member-ledger-stat-item">
            <span class="val" style="color:var(--secondary);">৳ ${totalDeposits.toLocaleString()}</span>
            <span class="lbl">Total Deposit</span>
          </div>
        </div>

        <div class="member-ledger-footer">
          <div>
            ${isOwner && !isSelf ? `
              <select class="role-select-box hub-member-role-select" data-uid="${member.uid}" data-name="${member.name}">
                <option value="admin" ${memberRole === "admin" ? "selected" : ""}>Admin</option>
                <option value="manager" ${memberRole === "manager" ? "selected" : ""}>Manager</option>
                <option value="member" ${memberRole === "member" ? "selected" : ""}>Member</option>
              </select>
            ` : `<span style="font-size:11.5px; color:var(--text-muted);">${member.email || member.phone || "Active Member"}</span>`}
          </div>

          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-xs btn-secondary btn-hub-quick-deposit" data-uid="${member.uid}" style="font-size:11px; padding:4px 8px;">
              + Deposit
            </button>
            <button type="button" class="btn btn-xs btn-primary btn-hub-wa-remind" data-name="${member.name}" data-phone="${member.phone || ''}" data-balance="${netBalance.toFixed(1)}" style="font-size:11px; padding:4px 8px; background:#25D366; border-color:#25D366;">
              💬 Remind
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Attach Role change handlers
  ledgerContainer.querySelectorAll(".hub-member-role-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const uid = select.getAttribute("data-uid");
      const name = select.getAttribute("data-name");
      const newRole = e.target.value;
      await handleChangeMemberRole(uid, name, newRole);
    });
  });

  // Attach quick deposit button handler
  ledgerContainer.querySelectorAll(".btn-hub-quick-deposit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.getAttribute("data-uid");
      // Switch to Manager section
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".app-section").forEach(s => s.classList.remove("active"));

      const managerNav = document.querySelector('.nav-item[data-target="section-manager"]');
      if (managerNav) managerNav.classList.add("active");
      const managerSec = document.getElementById("section-manager");
      if (managerSec) managerSec.classList.add("active");

      // Select member in deposit dropdown
      const depSelect = document.getElementById("deposit-member");
      if (depSelect) depSelect.value = uid;

      const depAmount = document.getElementById("deposit-amount");
      if (depAmount) depAmount.focus();
    });
  });

  // Attach WhatsApp Remind button handler
  ledgerContainer.querySelectorAll(".btn-hub-wa-remind").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-name");
      const phone = (btn.getAttribute("data-phone") || "").replace(/[^0-9]/g, "");
      const balance = Number(btn.getAttribute("data-balance"));
      const isDue = balance < 0;

      const msg = `আসসালামু আলাইকুম ${name} ভাই, আমাদের "${currentMess?.name || 'মেস'}" এর বর্তমান হিসেব অনুযায়ী আপনার ব্যালেন্স: ${isDue ? '৳' + Math.abs(balance).toFixed(0) + ' বাকি (Due) রয়েছে' : '৳' + balance.toFixed(0) + ' জমা (Surplus) রয়েছে'}। সুবিধাজনক সময়ে দেখে নেবেন। ধন্যবাদ!`;
      const url = phone ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(msg)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    });
  });
}

function renderHubOwnerSettings() {
  const pendingBadge = document.getElementById("hub-badge-pending-count");
  if (pendingBadge) pendingBadge.textContent = `${state.joinRequests.length} Pending`;

  const pendingList = document.getElementById("hub-join-requests-list");
  if (pendingList) {
    if (state.joinRequests.length === 0) {
      pendingList.innerHTML = `<div style="text-align:center; padding:12px; color:var(--text-muted); font-size:12.5px;">No pending join requests at this time.</div>`;
    } else {
      pendingList.innerHTML = state.joinRequests.map((req) => `
        <div class="request-row-card">
          <div class="request-info-col">
            <div class="member-name-bold">${req.user_name}</div>
            <span class="member-meta-small">${req.user_phone || req.user_email || "Roommate"} &bull; ${getReadableDate(req.created_at || getTodayStr())}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-xs btn-sm-success btn-hub-approve-req" data-req-id="${req.id}" data-user-uid="${req.user_uid}" data-user-name="${req.user_name}">
              ✓ Approve
            </button>
            <button type="button" class="btn btn-xs btn-sm-danger btn-hub-reject-req" data-req-id="${req.id}">
              ✕ Reject
            </button>
          </div>
        </div>
      `).join("");

      pendingList.querySelectorAll(".btn-hub-approve-req").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const reqId = btn.getAttribute("data-req-id");
          const userUid = btn.getAttribute("data-user-uid");
          const userName = btn.getAttribute("data-user-name");
          await handleApproveJoinRequest(reqId, userUid, userName);
        });
      });

      pendingList.querySelectorAll(".btn-hub-reject-req").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const reqId = btn.getAttribute("data-req-id");
          await handleRejectJoinRequest(reqId);
        });
      });
    }
  }

  // Pre-fill Edit Mess Form
  const inputName = document.getElementById("edit-mess-name");
  const inputFixed = document.getElementById("edit-mess-fixed");
  const inputArea = document.getElementById("edit-mess-area");

  if (inputName) inputName.value = currentMess?.name || "Green View Bachelor Mess";
  if (inputFixed) inputFixed.value = currentMess?.fixed_cost_share || 800;
  if (inputArea) inputArea.value = currentMess?.area || "";
}

function setupMessHubHandlers() {
  // Toggle Assign Bazar Duty form in Hub
  const btnToggleAssign = document.getElementById("btn-toggle-assign-bazar");
  const formAssignBazar = document.getElementById("form-assign-bazar");
  const btnCancelAssign = document.getElementById("btn-cancel-assign-bazar");

  if (btnToggleAssign && formAssignBazar) {
    btnToggleAssign.addEventListener("click", () => {
      const isVisible = formAssignBazar.style.display === "block";
      formAssignBazar.style.display = isVisible ? "none" : "block";
      if (!isVisible) {
        const select = document.getElementById("assign-bazar-member");
        if (select) {
          select.innerHTML = state.members.map(m => `<option value="${m.uid}">${m.name} (${m.role || "member"})</option>`).join("");
        }
        const dateInput = document.getElementById("assign-bazar-date");
        if (dateInput) dateInput.value = getTomorrowStr();
      }
    });
  }

  if (btnCancelAssign && formAssignBazar) {
    btnCancelAssign.addEventListener("click", () => {
      formAssignBazar.style.display = "none";
    });
  }

  if (formAssignBazar) {
    formAssignBazar.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userUid = document.getElementById("assign-bazar-member").value;
      const date = document.getElementById("assign-bazar-date").value || getTomorrowStr();
      const budget = Number(document.getElementById("assign-bazar-budget").value) || 1500;
      const note = document.getElementById("assign-bazar-note").value.trim() || "Daily Grocery";

      const newDuty = {
        user_uid: userUid,
        date,
        budget,
        note,
        status: "pending",
        createdAt: serverTimestamp()
      };

      if (db && auth?.currentUser) {
        try {
          const ref = await addDoc(collection(db, "bazar_schedule"), newDuty);
          newDuty.id = ref.id;
        } catch (e) {
          console.warn("Duty saved locally:", e.message);
          newDuty.id = "bazar_" + Date.now();
        }
      } else {
        newDuty.id = "bazar_" + Date.now();
      }

      state.bazarSchedule.push(newDuty);
      formAssignBazar.style.display = "none";
      formAssignBazar.reset();
      renderBazarRoster();
      renderMessDashboardHub();
      const assignedName = state.members.find(m => m.uid === userUid)?.name || "Member";
      alert(`✅ Bazar duty scheduled for ${assignedName} on ${getReadableDate(date)}!`);
    });
  }

  // Edit Mess Settings Form Submit
  const formEditSettings = document.getElementById("form-edit-mess-settings");
  if (formEditSettings) {
    formEditSettings.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentMess?.id) return;
      if (currentRole !== "owner" && currentRole !== "admin") {
        alert("Only Mess Owner or Admin can update mess settings.");
        return;
      }

      const name = document.getElementById("edit-mess-name").value.trim();
      const fixed = Number(document.getElementById("edit-mess-fixed").value) || 800;
      const area = document.getElementById("edit-mess-area").value.trim();

      if (!name) {
        alert("Please enter a valid mess name.");
        return;
      }

      const updated = {
        ...currentMess,
        name,
        fixed_cost_share: fixed,
        area
      };

      if (db && auth?.currentUser) {
        try {
          await setDoc(doc(db, "messes", currentMess.id), {
            name,
            fixed_cost_share: fixed,
            area
          }, { merge: true });
        } catch (e) {
          console.warn("Mess settings saved locally:", e.message);
        }
      }

      currentMess = updated;
      localStorage.setItem("hisabi_current_mess", JSON.stringify(currentMess));

      // Update header
      const headerMessName = document.getElementById("header-mess-name");
      if (headerMessName) headerMessName.textContent = name;

      calculateAndRenderFinancials();
      renderMessDashboardHub();
      alert("✅ Mess settings updated successfully!");
    });
  }
}

async function handleApproveJoinRequest(reqId, userUid, userName) {
  if (!currentMess?.id) return;
  const confirmApprove = confirm(`Approve ${userName} as an active member of ${currentMess.name}?`);
  if (!confirmApprove) return;

  try {
    if (db && auth?.currentUser) {
      try {
        await setDoc(doc(db, "join_requests", reqId), { status: "approved" }, { merge: true });
        await setDoc(doc(db, "users", userUid), {
          mess_id: currentMess.id,
          role: "member",
          status: "active"
        }, { merge: true });
      } catch (dbErr) {
        console.warn("Firestore approve failed, updated locally:", dbErr.message);
      }
    }

    // Update local state
    state.joinRequests = state.joinRequests.filter(r => r.id !== reqId);
    let member = state.members.find(m => m.uid === userUid);
    if (!member) {
      member = {
        uid: userUid,
        name: userName,
        role: "member",
        status: "active",
        mess_id: currentMess.id,
        fixed_cost_share: currentMess.fixed_cost_share || 800
      };
      state.members.push(member);
    } else {
      member.role = "member";
      member.status = "active";
    }

    if (currentMess?.id) {
      localStorage.setItem("hisabi_members_" + currentMess.id, JSON.stringify(state.members));
    }

    alert(`✅ ${userName} is now approved as a Member!`);
    populateMemberDropdown();
    renderOwnerAndAdminPanels();
  } catch (err) {
    console.error("Approve error:", err);
    alert("Could not approve member: " + err.message);
  }
}

async function handleRejectJoinRequest(reqId) {
  const confirmReject = confirm("Are you sure you want to reject this join request?");
  if (!confirmReject) return;

  try {
    if (db && auth?.currentUser) {
      try {
        await setDoc(doc(db, "join_requests", reqId), { status: "rejected" }, { merge: true });
      } catch (dbErr) {
        console.warn("Firestore reject failed, updated locally:", dbErr.message);
      }
    }
    state.joinRequests = state.joinRequests.filter(r => r.id !== reqId);
    renderOwnerAndAdminPanels();
  } catch (err) {
    console.error("Reject error:", err);
  }
}

async function handleChangeMemberRole(targetUid, targetName, newRole) {
  const confirmChange = confirm(`Change role of ${targetName} to "${newRole.toUpperCase()}"?`);
  if (!confirmChange) {
    await loadAllMessData();
    return;
  }

  try {
    if (db && auth?.currentUser) {
      try {
        await setDoc(doc(db, "users", targetUid), { role: newRole }, { merge: true });
      } catch (dbErr) {
        console.warn("Firestore role change failed, updated locally:", dbErr.message);
      }
    }

    const member = state.members.find(m => m.uid === targetUid);
    if (member) member.role = newRole;

    if (currentMess?.id) {
      localStorage.setItem("hisabi_members_" + currentMess.id, JSON.stringify(state.members));
    }

    alert(`Role updated! ${targetName} is now a ${newRole.toUpperCase()}.`);
    renderOwnerAndAdminPanels();
    populateMemberDropdown();
  } catch (err) {
    console.error("Change role error:", err);
    alert("Could not update role: " + err.message);
    await loadAllMessData();
  }
}

/* ==========================================================================
   Meal Toggling Save Handler (With 11:00 PM Cut-off Check)
   ========================================================================== */
function setupMealToggles() {
  const btnSaveMeals = document.getElementById("btn-save-meals");
  const toggleBreakfast = document.getElementById("toggle-breakfast");
  const toggleLunch = document.getElementById("toggle-lunch");
  const toggleDinner = document.getElementById("toggle-dinner");

  // Live change updates on switches
  if (toggleBreakfast) toggleBreakfast.addEventListener("change", updateMealSwitchBadges);
  if (toggleLunch) toggleLunch.addEventListener("change", updateMealSwitchBadges);
  if (toggleDinner) toggleDinner.addEventListener("change", updateMealSwitchBadges);

  // Bulk action: All OFF
  const btnAllOff = document.getElementById("btn-meals-all-off");
  if (btnAllOff) {
    btnAllOff.addEventListener("click", () => {
      if (toggleBreakfast) toggleBreakfast.checked = false;
      if (toggleLunch) toggleLunch.checked = false;
      if (toggleDinner) toggleDinner.checked = false;
      updateMealSwitchBadges();
      if (btnSaveMeals) btnSaveMeals.click();
    });
  }

  // Bulk action: All ON
  const btnAllOn = document.getElementById("btn-meals-all-on");
  if (btnAllOn) {
    btnAllOn.addEventListener("click", () => {
      if (toggleBreakfast) toggleBreakfast.checked = true;
      if (toggleLunch) toggleLunch.checked = true;
      if (toggleDinner) toggleDinner.checked = true;
      updateMealSwitchBadges();
      if (btnSaveMeals) btnSaveMeals.click();
    });
  }

  // Bulk action: Lunch + Dinner only
  const btnLunchDinner = document.getElementById("btn-meals-lunch-dinner");
  if (btnLunchDinner) {
    btnLunchDinner.addEventListener("click", () => {
      if (toggleBreakfast) toggleBreakfast.checked = false;
      if (toggleLunch) toggleLunch.checked = true;
      if (toggleDinner) toggleDinner.checked = true;
      updateMealSwitchBadges();
      if (btnSaveMeals) btnSaveMeals.click();
    });
  }

  // Multi-day tabs: Tomorrow, Today, Day After, In 3 Days
  const dayTabBtns = document.querySelectorAll(".meal-day-btn");
  dayTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      dayTabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const dayType = btn.getAttribute("data-meal-day");
      if (dayType === "today") selectedMealDate = getTodayStr();
      else if (dayType === "day2") selectedMealDate = getFutureDateStr(2);
      else if (dayType === "day3") selectedMealDate = getFutureDateStr(3);
      else selectedMealDate = getTomorrowStr();

      renderMealToggles(selectedMealDate);
    });
  });

  // Copy / WhatsApp Share Cook Count button
  const btnShareCook = document.getElementById("btn-share-cook-count");
  if (btnShareCook) {
    btnShareCook.addEventListener("click", () => {
      const activeDate = selectedMealDate || getTomorrowStr();
      const brk = document.getElementById("cook-count-breakfast")?.textContent || "0";
      const lun = document.getElementById("cook-count-lunch")?.textContent || "0";
      const din = document.getElementById("cook-count-dinner")?.textContent || "0";
      const tot = document.getElementById("cook-count-total")?.textContent || "0";
      const messCode = currentMess?.code || "SMPAZ8";
      const messName = currentMess?.name || "Green View Mess";

      const shareText = `🍽️ *${messName} (${messCode})*\n📅 তারিখ: ${getReadableDate(activeDate)}\n👩‍🍳 খালা/বাবুর্চির মিল সংখ্যা:\n🌅 সকালের নাস্তা: ${brk} জন\n☀️ দুপুরের খাবার: ${lun} জন\n🌙 রাতের খাবার: ${din} জন\n👉 মোট মিল: ${tot} জন`;

      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareText).then(() => {
          alert(`Cook headcount copied to clipboard!\n\n${shareText}`);
        }).catch(() => {
          prompt("Copy cook headcount:", shareText);
        });
      } else {
        prompt("Copy cook headcount:", shareText);
      }
    });
  }

  // Save Preferences button
  if (btnSaveMeals) {
    btnSaveMeals.addEventListener("click", async () => {
      const activeDate = selectedMealDate || getTomorrowStr();
      if (activeDate === getTomorrowStr() && checkCutoff()) {
        alert("Cut-off time reached! Meals cannot be modified after 11:00 PM.");
        return;
      }

      const currentUid = currentUser?.uid || "user_owner_demo";
      const isMorning = Boolean(document.getElementById("toggle-breakfast")?.checked);
      const isLunch = Boolean(document.getElementById("toggle-lunch")?.checked);
      const isDinner = Boolean(document.getElementById("toggle-dinner")?.checked);

      btnSaveMeals.disabled = true;
      btnSaveMeals.textContent = "Saving preferences...";

      const updatedMeal = {
        date: activeDate,
        user_uid: currentUid,
        morning: isMorning,
        lunch: isLunch,
        dinner: isDinner,
        updatedAt: serverTimestamp()
      };

      if (db) {
        try {
          const mealDocId = `${activeDate}_${currentUid}`;
          await setDoc(doc(db, "meals", mealDocId), updatedMeal, { merge: true });
        } catch (err) {
          console.warn("Could not save meal to Firestore:", err.message);
        }
      }

      const existingIndex = state.meals.findIndex(m => m.date === activeDate && m.user_uid === currentUid);
      if (existingIndex >= 0) {
        state.meals[existingIndex] = updatedMeal;
      } else {
        state.meals.push(updatedMeal);
      }

      calculateAndRenderFinancials();
      if (activeDate === getTomorrowStr()) {
        updateDashboardMealPills(updatedMeal);
      }
      updateTomorrowAICounts();
      renderRoommateMealBoard(activeDate);
      updateCookHeadcount(activeDate);

      btnSaveMeals.disabled = false;
      btnSaveMeals.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        Saved! Update Preferences
      `;

      console.log(`Meal choices for ${activeDate} saved!`);
    });
  }
}

/* ==========================================================================
   Manager Operations: Record Expenses & Deposits
   ========================================================================== */
function setupManagerForms() {
  const expenseForm = document.getElementById("form-expense");
  const depositForm = document.getElementById("form-deposit");

  if (expenseForm) {
    expenseForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const amount = Number(document.getElementById("expense-amount").value);
      const date = document.getElementById("expense-date").value || getTodayStr();
      const type = document.getElementById("expense-type").value;
      const description = document.getElementById("expense-desc").value.trim();

      if (!amount || amount <= 0) {
        alert("Please enter a valid expense amount.");
        return;
      }

      const newExpense = {
        amount,
        date,
        type,
        description: description || (type === "daily" ? "Daily Grocery Bazar" : "Fixed Expense"),
        added_by: currentUser?.uid || "manager",
        createdAt: serverTimestamp()
      };

      if (db) {
        try {
          const docRef = await addDoc(collection(db, "expenses"), newExpense);
          newExpense.id = docRef.id;
        } catch (err) {
          console.warn("Expense saved locally:", err.message);
          newExpense.id = "exp_" + Date.now();
        }
      } else {
        newExpense.id = "exp_" + Date.now();
      }

      state.expenses.unshift(newExpense);
      calculateAndRenderFinancials();
      expenseForm.reset();
      document.getElementById("expense-date").value = getTodayStr();
      alert(`Mess expense of ৳${amount.toLocaleString()} recorded successfully!`);
    });
  }

  if (depositForm) {
    depositForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const userUid = document.getElementById("deposit-member").value;
      const amount = Number(document.getElementById("deposit-amount").value);
      const date = document.getElementById("deposit-date").value || getTodayStr();

      if (!amount || amount <= 0) {
        alert("Please enter a valid deposit amount.");
        return;
      }

      const newDeposit = {
        user_uid: userUid,
        amount,
        date,
        added_by: currentUser?.uid || "manager",
        createdAt: serverTimestamp()
      };

      if (db) {
        try {
          const docRef = await addDoc(collection(db, "deposits"), newDeposit);
          newDeposit.id = docRef.id;
        } catch (err) {
          console.warn("Deposit saved locally:", err.message);
          newDeposit.id = "dep_" + Date.now();
        }
      } else {
        newDeposit.id = "dep_" + Date.now();
      }

      state.deposits.unshift(newDeposit);
      calculateAndRenderFinancials();
      depositForm.reset();
      document.getElementById("deposit-date").value = getTodayStr();
      alert(`Deposit of ৳${amount.toLocaleString()} recorded successfully!`);
    });
  }
}

/* ==========================================================================
   Phase 4: Gemini 1.5 Flash AI Cook Messaging Integration
   ========================================================================== */
function setupGeminiCookMessaging() {
  const btnGenerateAI = document.getElementById("btn-generate-ai");
  const menuInput = document.getElementById("menu-input");
  const cookPhoneInput = document.getElementById("cook-phone");
  const previewText = document.getElementById("ai-preview-text");
  const btnWhatsapp = document.getElementById("btn-send-whatsapp");
  const btnSms = document.getElementById("btn-send-sms");

  if (!btnGenerateAI) return;

  function updateActionLinks(message, phone) {
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    if (btnWhatsapp) {
      btnWhatsapp.href = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(message)}`;
    }
    if (btnSms) {
      btnSms.href = `sms:${phone}?body=${encodeURIComponent(message)}`;
    }
  }

  btnGenerateAI.addEventListener("click", async () => {
    const menu = menuInput.value.trim() || "দুপুরে মুরগির মাংস ও পাতলা ডাল, রাতে ডিম ভাজি ও সবজি";
    const cookPhone = cookPhoneInput.value.trim() || "+8801712345678";

    const tomorrowStr = getTomorrowStr();
    const tomorrowMeals = state.meals.filter(m => m.date === tomorrowStr);
    const lunchCount = tomorrowMeals.filter(m => m.lunch).length || 8;
    const dinnerCount = tomorrowMeals.filter(m => m.dinner).length || 7;

    btnGenerateAI.disabled = true;
    btnGenerateAI.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
      Generating Bengali Message with Gemini AI...
    `;

    const prompt = `You are a helpful assistant for a bachelor mess in Bangladesh.
Write a concise, polite, and respectful instruction message in natural Bengali (বাংলা) for the mess cook (খালা) for tomorrow's cooking.
Details:
- Tomorrow's Lunch count: ${lunchCount} people
- Tomorrow's Dinner count: ${dinnerCount} people
- Menu instructions: ${menu}
Start with 'খালা আসসালামু আলাইকুম।'. Mention the exact person counts for lunch and dinner, what to cook according to the menu, and politely ask to come on time. Keep it natural, warm, and under 50 words, ready to send via WhatsApp or SMS. Return ONLY the Bengali message text with no markdown, formatting, or extra commentary.`;

    let generatedMessage = "";
    const geminiKey = localStorage.getItem("hisabi_gemini_api_key");

    if (geminiKey) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          }
        );

        const data = await response.json();
        if (data.candidates && data.candidates[0]?.content?.parts[0]?.text) {
          generatedMessage = data.candidates[0].content.parts[0].text.trim();
        } else if (data.error) {
          throw new Error(data.error.message || "Gemini API error");
        }
      } catch (err) {
        console.warn("Gemini fetch fallback:", err.message);
      }
    }

    if (!generatedMessage) {
      generatedMessage = `খালা আসসালামু আলাইকুম। কালকে দুপুরে ${lunchCount} জনের জন্য ${menu.split("রাতে")[0] || menu} রান্না করবেন। আর রাতে ${dinnerCount} জনের জন্য ${menu.split("রাতে")[1] || "ডিম ভাজি ও সবজি"} করবেন। সময়মতো চলে আসবেন দয়া করে। ধন্যবাদ!`;
    }

    if (previewText) {
      previewText.textContent = generatedMessage;
    }
    updateActionLinks(generatedMessage, cookPhone);

    btnGenerateAI.disabled = false;
    btnGenerateAI.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
      Generate AI Message for Khala
    `;
  });

  const initialMsg = previewText ? previewText.textContent.trim() : "";
  updateActionLinks(initialMsg, cookPhoneInput ? cookPhoneInput.value.trim() : "+8801712345678");
}

/* ==========================================================================
   Email / Password Authentication Logic
   ========================================================================== */
function setupEmailAuth() {
  const form = document.getElementById("form-auth-email");
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const nameInput = document.getElementById("auth-name");
  const nameGroup = document.getElementById("group-signup-name");
  const submitBtn = document.getElementById("btn-email-submit");
  const toggleBtn = document.getElementById("btn-toggle-auth-mode");
  const modeText = document.getElementById("text-auth-mode");

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      isSignUpMode = !isSignUpMode;
      clearAuthMessage();

      if (isSignUpMode) {
        nameGroup.style.display = "block";
        submitBtn.textContent = "Create Account & Sign Up";
        modeText.textContent = "Already have an account?";
        toggleBtn.textContent = "Sign In";
      } else {
        nameGroup.style.display = "none";
        submitBtn.textContent = "Sign In with Email";
        modeText.textContent = "Don't have an account?";
        toggleBtn.textContent = "Sign Up";
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthMessage();

      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const fullName = nameInput ? nameInput.value.trim() : "";

      if (!email || !password) {
        showAuthMessage("Please provide both email and password.", "error");
        return;
      }

      if (!auth) {
        showAuthMessage("Firebase Auth is not initialized.", "error");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = isSignUpMode ? "Creating account..." : "Signing in...";

      try {
        if (isSignUpMode) {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          if (fullName) {
            await updateProfile(userCredential.user, { displayName: fullName });
          }
          await syncUserProfile(userCredential.user);
          showAuthMessage("Account created successfully!", "success");
        } else {
          const userCredential = await signInWithEmailAndPassword(auth, email, password);
          await syncUserProfile(userCredential.user);
          showAuthMessage("Signed in successfully!", "success");
        }
      } catch (err) {
        console.error("Email auth error:", err);
        let errorMsg = err.message;
        if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
          errorMsg = "Invalid email or password. If you don't have an account yet, click 'Sign Up'.";
        } else if (err.code === "auth/email-already-in-use") {
          errorMsg = "An account with this email already exists. Please sign in instead.";
        } else if (err.code === "auth/weak-password") {
          errorMsg = "Password should be at least 6 characters.";
        } else if (err.code === "auth/api-key-not-valid") {
          errorMsg = "Firebase API key is not valid. Please verify your Web API Key.";
        }
        showAuthMessage(errorMsg, "error");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isSignUpMode ? "Create Account & Sign Up" : "Sign In with Email";
      }
    });
  }
}

/* ==========================================================================
   Google Popup Authentication Logic
   ========================================================================== */
function setupGoogleAuth() {
  const btnGoogle = document.getElementById("btn-google-signin");
  if (!btnGoogle) return;

  btnGoogle.addEventListener("click", async () => {
    clearAuthMessage();
    if (!auth) {
      showAuthMessage("Firebase Auth is not initialized.", "error");
      return;
    }

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    btnGoogle.disabled = true;
    showAuthMessage("Opening Google Sign-In...", "info");

    try {
      const result = await signInWithPopup(auth, provider);
      await syncUserProfile(result.user);
      showAuthMessage("Google sign-in successful!", "success");
    } catch (err) {
      console.error("Google auth error:", err);
      let msg = err.message;
      if (err.code === "auth/popup-closed-by-user") {
        msg = "Sign-in popup closed before completion.";
      } else if (err.code === "auth/unauthorized-domain") {
        msg = "Domain not authorized. Add 'localhost' in Firebase Console -> Authentication -> Settings -> Authorized domains.";
      } else if (err.code === "auth/missing-initial-state" || err.message?.includes("missing initial state") || err.message?.includes("sessionStorage") || err.message?.includes("storage-partitioned")) {
        msg = "⚠️ Browser storage partitioning blocked Google popup session. You can use Email/Password sign-in, or click 'Continue as Mess Owner' above for instant access!";
        const hint = document.getElementById("google-storage-help");
        if (hint) hint.style.display = "block";
      }
      showAuthMessage(msg, "error");
    } finally {
      btnGoogle.disabled = false;
    }
  });
}

/* ==========================================================================
   Phone OTP Authentication Logic
   ========================================================================== */
function initPhoneRecaptcha() {
  if (!auth) return;
  if (!window.recaptchaVerifier) {
    try {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "normal",
        callback: () => {
          console.log("Recaptcha resolved.");
        },
        "expired-callback": () => {
          showAuthMessage("Recaptcha expired. Please solve it again.", "warning");
        }
      });
      window.recaptchaVerifier.render();
    } catch (e) {
      console.warn("Recaptcha setup notice:", e.message);
    }
  }
}

function setupPhoneAuth() {
  const btnSendOtp = document.getElementById("btn-send-otp");
  const btnVerifyOtp = document.getElementById("btn-verify-otp");
  const btnResendPhone = document.getElementById("btn-resend-phone");
  const phoneInput = document.getElementById("login-phone");
  const otpInput = document.getElementById("otp-code");
  const phoneStep = document.getElementById("phone-input-step");
  const otpStep = document.getElementById("otp-input-step");

  if (btnSendOtp) {
    btnSendOtp.addEventListener("click", async () => {
      clearAuthMessage();
      const phoneNumber = phoneInput.value.trim();

      if (!phoneNumber || phoneNumber.length < 10) {
        showAuthMessage("Please enter a valid phone number with country code (e.g. +8801700000000)", "error");
        return;
      }

      if (!auth) {
        showAuthMessage("Firebase Auth is not initialized.", "error");
        return;
      }

      initPhoneRecaptcha();
      btnSendOtp.disabled = true;
      btnSendOtp.textContent = "Sending OTP...";

      try {
        confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
        showAuthMessage(`Verification code sent to ${phoneNumber}. Please enter the 6-digit code.`, "success");
        phoneStep.style.display = "none";
        otpStep.style.display = "block";
      } catch (err) {
        console.error("Phone sign in error:", err);
        showAuthMessage("Phone auth failed: " + err.message, "error");
        if (window.recaptchaVerifier) {
          window.recaptchaVerifier.clear();
          window.recaptchaVerifier = null;
        }
      } finally {
        btnSendOtp.disabled = false;
        btnSendOtp.textContent = "Send Verification Code";
      }
    });
  }

  if (btnVerifyOtp) {
    btnVerifyOtp.addEventListener("click", async () => {
      clearAuthMessage();
      const code = otpInput.value.trim();

      if (!code || code.length !== 6) {
        showAuthMessage("Please enter a valid 6-digit code.", "error");
        return;
      }

      if (!confirmationResult) {
        showAuthMessage("No verification in progress. Please request a new code.", "error");
        return;
      }

      btnVerifyOtp.disabled = true;
      btnVerifyOtp.textContent = "Verifying...";

      try {
        const result = await confirmationResult.confirm(code);
        await syncUserProfile(result.user);
        showAuthMessage("Phone verification successful! Signed in.", "success");
      } catch (err) {
        console.error("OTP verification error:", err);
        showAuthMessage("Invalid verification code. Please check and try again.", "error");
      } finally {
        btnVerifyOtp.disabled = false;
        btnVerifyOtp.textContent = "Verify OTP & Sign In";
      }
    });
  }

  if (btnResendPhone) {
    btnResendPhone.addEventListener("click", () => {
      clearAuthMessage();
      otpStep.style.display = "none";
      phoneStep.style.display = "block";
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    });
  }
}

/* ==========================================================================
   Sign Out & Auth Trigger
   ========================================================================== */
function setupSignOut() {
  const btnLogout = document.getElementById("btn-logout");
  const authModal = document.getElementById("section-auth");

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      const confirmLogout = confirm("Sign out of current account / demo session?");
      if (!confirmLogout) return;

      localStorage.setItem("hisabi_explicit_logout", "true");
      localStorage.removeItem("hisabi_demo_active");

      if (auth && auth.currentUser) {
        try {
          await signOut(auth);
          showAuthMessage("You have been signed out.", "info");
        } catch (err) {
          console.error("Logout error:", err);
        }
      }

      currentUser = null;
      currentRole = "guest";
      currentMess = null;

      const headerUserName = document.getElementById("header-user-name");
      const headerUserRole = document.getElementById("header-user-role");
      const headerAvatar = document.getElementById("header-avatar");
      const headerMessName = document.getElementById("header-mess-name");

      if (headerUserName) headerUserName.textContent = "Guest User";
      if (headerUserRole) {
        headerUserRole.textContent = "Not Signed In";
        headerUserRole.className = "badge badge-neutral";
      }
      if (headerAvatar) headerAvatar.textContent = "??";
      if (headerMessName) headerMessName.textContent = "Smart Mess System";

      await loadAllMessData();
      if (authModal) authModal.classList.add("active");
    });
  }
}

/* ==========================================================================
   DOM Ready Initialization
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupAuthObserver();
  setupEmailAuth();
  setupGoogleAuth();
  setupPhoneAuth();
  setupSignOut();
  setupMealToggles();
  setupManagerForms();
  setupGeminiCookMessaging();
  setupMessHandlers();
  setupMessHubHandlers();
  console.log("Hisabi application ready with Multi-Mess & Admin Delegation.");
});
