/* ============================================================
   NightShiftPH Planner — app.js
   Phase 2: Firestore-backed state layer (STORE below), live-synced
   across every admin via onSnapshot. Render logic is unchanged from
   Phase 1 — every render function still reads from STORE.state only.
   ============================================================ */

const ROLE_ORDER = ["Tank", "FS", "DPS"];
const ROLE_COLOR = { Tank: "#4e8fe3", FS: "#4cc38a", DPS: "#e2574c" };
const PARTY_SLOT_COUNT = 5;       // fixed by RONW party size
const MAX_PARTIES_PER_TEAM = 8;
const MIN_PARTIES_PER_TEAM = 1;
const MAX_TEAMS_PER_TYPE = 5;     // up to 5 Elite Teams and up to 5 Sub Teams
const MAX_GROUP_SIZE = 5;         // groups are capped to match party size exactly
const IS_PUBLIC = document.body.dataset.mode === "public";

/* Class list — grouped by base class, in the guild's preferred display order.
   Rendered as <optgroup> sections in the Members form. */
const CLASS_GROUPS = [
  { base: "Swordsman", jobs: ["Knight", "Crusader", "Lord Knight", "Paladin"] },
  { base: "Mage", jobs: ["Wizard", "High Wizard"] },
  { base: "Archer", jobs: ["Hunter", "Sniper"] },
  { base: "Acolyte", jobs: ["Priest", "High Priest", "Monk", "Champion"] },
  { base: "Thief", jobs: ["Assassin", "Assassin Cross"] },
  { base: "Merchant", jobs: ["Blacksmith", "Whitesmith"] },
  { base: "Gunslinger", jobs: ["Rebel", "Night Walker"] },
  { base: "Druid", jobs: ["Karnos", "Alitea"] },
];

/* Class → default Role Tag, applied automatically when a class is picked
   (still fully editable afterward). Swordsman-branch defaults to Tank,
   the supporting Acolyte jobs default to FS. The damage-focused Acolyte
   jobs (Monk, Champion) are deliberately left out so they fall through
   to the DPS default below, same as every other class. */
const CLASS_TO_ROLE = {
  "Knight": "Tank", "Crusader": "Tank", "Lord Knight": "Tank", "Paladin": "Tank",
  "Priest": "FS", "High Priest": "FS",
};
function getAutoRoleForClass(className) {
  return CLASS_TO_ROLE[className] || "DPS";
}

const DUNGEONS = [
  { id: "moonlight", name: "Moonlight Flower", icon: "🦊" },
  { id: "dracula", name: "Dracula", icon: "🦇" },
  { id: "jakk", name: "Jakk", icon: "🎃" },
  { id: "bubble", name: "Bubble Dungeon", icon: "🫧" },
  { id: "twins", name: "Twin Bosses", icon: "👯" },
];
function dungeonById(id) {
  return DUNGEONS.find((d) => d.id === id) || null;
}

/* ---------------- State layer: Firestore, live-synced ----------------
   The entire app state lives in one Firestore document
   (guildState/main). Every admin's browser listens to it with
   onSnapshot, so any change — from any admin, on any device —
   appears on every other screen within a second or two.
   STORE.save() writes locally first (instant UI feedback) and fires
   the Firestore write in the background; the resulting onSnapshot
   echo just re-confirms the same data, so nothing else in the app
   needs to know or care that a network call happened. */
const FIRESTORE_DOC = db.collection("guildState").doc("main");

const STORE = {
  state: null,
  ready: false,

  load(cb) {
    FIRESTORE_DOC.onSnapshot(
      (snap) => {
        if (snap.exists) {
          this.state = snap.data();
        } else {
          this.state = defaultState();
          FIRESTORE_DOC.set(this.state).catch((err) =>
            toast("Couldn't create the shared guild data: " + err.message, "danger")
          );
        }
        this.migrate();
        this.ready = true;
        cb();
      },
      (err) => {
        showLoadingError("Couldn't reach the guild database: " + err.message);
        toast("Cloud sync error: " + err.message, "danger");
      }
    );
  },

  save() {
    if (!this.state) return;
    FIRESTORE_DOC.set(this.state).catch((err) =>
      toast("Couldn't save to the cloud — check your connection. " + err.message, "danger")
    );
  },

  migrate() {
    if (!this.state.rules) this.state.rules = { Tank: 1, FS: 1, DPS: 0 };
    if (this.state.rules.Healer !== undefined) {
      this.state.rules.FS = this.state.rules.Healer;
      delete this.state.rules.Healer;
    }
    delete this.state.rules.Support;
    if (!this.state.events) this.state.events = [];
    if (!this.state.queue) this.state.queue = [];
    delete this.state.staff; // staff now lives in its own Firestore collection, see STAFF below
    this.state.members.forEach((m) => {
      if (m.role === "Healer") m.role = "FS";
      if (!ROLE_ORDER.includes(m.role)) m.role = "DPS";
      if (m.availability === "Unsure") m.availability = "Available";
    });
    this.state.teams.forEach((t) => {
      t.parties.forEach((p) => {
        if (p.slots.length > PARTY_SLOT_COUNT) p.slots = p.slots.slice(0, PARTY_SLOT_COUNT);
        while (p.slots.length < PARTY_SLOT_COUNT) p.slots.push(null);
      });
    });
    this.state.events.forEach((e) => { if (!e.teamIds) e.teamIds = []; });
  },
};

function showLoadingError(msg) {
  const spinner = document.getElementById("loading-spinner");
  const text = document.getElementById("loading-text");
  const err = document.getElementById("loading-error");
  const retry = document.getElementById("btn-loading-retry");
  if (spinner) spinner.style.display = "none";
  if (text) text.textContent = "Couldn't connect.";
  if (err) { err.textContent = msg; err.style.display = "block"; }
  if (retry) { retry.style.display = "inline-flex"; retry.onclick = () => location.reload(); }
}

/* ---------------- Staff directory: separate Firestore collection ----------------
   Kept apart from the big guildState document (rather than as a field on it)
   because Firestore security rules need a real document per staff member to
   check "is this signed-in email allowed to write?" — that's also what makes
   your account's access level real, not just a client-side dropdown anymore. */
const STAFF = {
  list: [],
  ready: false,

  listen(cb) {
    db.collection("staff").onSnapshot(
      (snap) => {
        this.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        this.ready = true;
        cb();
        if (!IS_PUBLIC) renderStaffPanel();
      },
      (err) => {
        showLoadingError("Couldn't reach the staff list: " + err.message);
        toast("Staff sync error: " + err.message, "danger");
      }
    );
  },

  find(email) {
    return this.list.find((s) => s.id === (email || "").toLowerCase()) || null;
  },

  add(name, email, role) {
    const id = email.trim().toLowerCase();
    return db.collection("staff").doc(id).set({ name: name.trim(), email: id, role });
  },

  remove(email) {
    return db.collection("staff").doc(email).delete();
  },
};

/* ---------------- Presence: who's online right now ----------------
   Firestore has no built-in presence system (that's a Realtime Database
   feature), so this approximates it with a heartbeat: every signed-in
   admin writes their own presence doc every 20s, and everyone else
   treats a doc as "online" only if its heartbeat is recent. Admin-only —
   not shown on the public page. */
const PRESENCE_STALE_MS = 50000;

const PRESENCE = {
  list: [],
  intervalId: null,
  docRef: null,

  start() {
    if (IS_PUBLIC || !currentUser) return;
    this.docRef = db.collection("presence").doc(currentUser.uid);
    const beat = () => {
      this.docRef.set({
        name: currentStaffRecord ? currentStaffRecord.name : currentUser.email,
        role: currentStaffRecord ? currentStaffRecord.role : "",
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(() => {});
    };
    beat();
    this.intervalId = setInterval(beat, 20000);
    this.listen();
  },

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    if (this.docRef) this.docRef.delete().catch(() => {});
    this.docRef = null;
    this.list = [];
    renderPresence();
  },

  listen() {
    db.collection("presence").onSnapshot((snap) => {
      const now = Date.now();
      this.list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.lastSeen && p.lastSeen.toDate && now - p.lastSeen.toDate().getTime() < PRESENCE_STALE_MS);
      renderPresence();
    }, () => {});
  },
};

function renderPresence() {
  const wrap = document.getElementById("presence-pill");
  if (!wrap) return;
  if (!PRESENCE.list.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "flex";
  const names = PRESENCE.list.map((p) => (p.id === currentUser?.uid ? "You" : (p.name || "").split(" ")[0] || "Someone"));
  wrap.innerHTML = `<span class="presence-dot"></span> ${names.join(", ")} online`;
}

/* ---------------- Recent activity: lightweight, admin-only feed ----------------
   This is intentionally lightweight — only the handful of meaningful actions
   below are logged, not every drag or slot change. The full, detailed audit
   log (every action, filterable, exportable) is a separate future feature
   that will live alongside this same panel in the Admin tab. */
const ACTIVITY = {
  list: [],

  listen() {
    db.collection("activity").orderBy("timestamp", "desc").limit(15).onSnapshot(
      (snap) => {
        this.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderActivityFeed();
      },
      (err) => toast("Activity feed error: " + err.message, "danger")
    );
  },

  log(message) {
    if (IS_PUBLIC || !currentStaffRecord) return;
    db.collection("activity").add({
      message,
      actorName: currentStaffRecord.name,
      actorRole: currentStaffRecord.role,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch(() => {});
  },
};

function timeAgo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 10) return "just now";
  if (diff < 60) return diff + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function renderActivityFeed() {
  const wrap = document.getElementById("activity-feed-list");
  if (!wrap) return;
  if (!ACTIVITY.list.length) {
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:11.5px; padding:6px 0;">No activity yet.</div>`;
    return;
  }
  wrap.innerHTML = ACTIVITY.list
    .map((a) => {
      const when = a.timestamp && a.timestamp.toDate ? timeAgo(a.timestamp.toDate()) : "just now";
      return `<div style="display:flex; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-soft); font-size:12px;">
        <span style="color:var(--text-faint); font-family:var(--font-mono); font-size:10.5px; min-width:52px; flex-shrink:0;">${when}</span>
        <span><strong>${escapeHtml(a.actorName || "Someone")}</strong> ${escapeHtml(a.message || "")}</span>
      </div>`;
    })
    .join("");
}

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

function emptyParty(name) {
  return {
    id: uid("party"),
    name,
    verified: false,
    slots: Array(PARTY_SLOT_COUNT).fill(null),
  };
}

function emptyTeam(name, type, partyCount) {
  return {
    id: uid("team"),
    name,
    type, // 'elite' | 'sub'
    parties: Array.from({ length: partyCount }, (_, i) => emptyParty(`Party ${i + 1}`)),
  };
}

function defaultState() {
  return {
    guildName: "NightShiftPH",
    members: [],
    groups: [],
    teams: [emptyTeam("Elite Team 1", "elite", 1), emptyTeam("Sub Team 1", "sub", 1)],
    rules: { Tank: 1, FS: 1, DPS: 0 },
    events: [
      { id: uid("evt"), name: "Guild League — Week 1", date: todayStr(), teamIds: [], participants: [] },
    ],
    queue: [],
  };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------- Derived helpers ---------------- */
function getMember(id) {
  return STORE.state.members.find((m) => m.id === id) || null;
}
function getGroup(id) {
  return STORE.state.groups.find((g) => g.id === id) || null;
}
function getTeam(id) {
  return STORE.state.teams.find((t) => t.id === id) || null;
}
function slottedIdsGlobally() {
  const ids = new Set();
  STORE.state.teams.forEach((t) => t.parties.forEach((p) => p.slots.forEach((s) => { if (s) ids.add(s); })));
  return ids;
}
function isMemberSlottedAnywhere(memberId) {
  return STORE.state.teams.some((t) => t.parties.some((p) => p.slots.includes(memberId)));
}
function teamsOfType(type) {
  return STORE.state.teams.filter((t) => t.type === type);
}

function partyRoleCounts(party) {
  const counts = { Tank: 0, FS: 0, DPS: 0 };
  party.slots.forEach((mid) => {
    if (!mid) return;
    const m = getMember(mid);
    if (m && counts.hasOwnProperty(m.role)) counts[m.role]++;
  });
  return counts;
}

function partyMissingRoles(party) {
  const counts = partyRoleCounts(party);
  const rules = STORE.state.rules;
  const missing = [];
  ROLE_ORDER.forEach((r) => {
    if ((rules[r] || 0) > 0 && counts[r] < rules[r]) {
      missing.push({ role: r, need: rules[r], have: counts[r] });
    }
  });
  return missing;
}

function filledSlotCount(party) {
  return party.slots.filter(Boolean).length;
}

function slottedIdsInTeam(team) {
  const ids = new Set();
  team.parties.forEach((p) => p.slots.forEach((s) => s && ids.add(s)));
  return ids;
}

function autoParticipantIds(teamIds) {
  const ids = new Set();
  (teamIds || []).forEach((tid) => {
    const t = getTeam(tid);
    if (t) slottedIdsInTeam(t).forEach((id) => ids.add(id));
  });
  return ids;
}

/* ---------------- Toasts ---------------- */
function toast(msg, kind) {
  const stack = document.getElementById("toast-stack");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

/* ---------------- Navigation ---------------- */
function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
  const view = document.getElementById("view-" + name);
  const nav = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (view) view.classList.add("active");
  if (nav) nav.classList.add("active");
  renderAll();
}

/* ---------------- Auth state & access gating ----------------
   Three screens compete for visibility on the admin page: login,
   "access pending" (signed in but not on the Staff list), and the
   real app-shell. evaluateAccess() is the single source of truth for
   which one shows, and it's safe to call repeatedly — every auth
   change, every Firestore update, and every Staff-list change all
   just call it again. */
let currentUser = null;         // Firebase Auth user object, or null
let currentStaffRecord = null;  // { name, email, role } from STAFF, or null if not staff
let storeReady = false;
let staffReady = false;
let collaborationStarted = false; // guards PRESENCE/ACTIVITY from starting more than once

function evaluateAccess() {
  if (IS_PUBLIC) return;
  if (!storeReady || !staffReady) return;

  const loadingScreen = document.getElementById("loading-screen");
  const loginScreen = document.getElementById("login-screen");
  const pendingScreen = document.getElementById("access-pending-screen");
  const appShell = document.getElementById("app-shell");
  if (!loadingScreen || !loginScreen || !pendingScreen || !appShell) return;

  loadingScreen.style.display = "none";

  if (!currentUser) {
    if (collaborationStarted) { PRESENCE.stop(); collaborationStarted = false; }
    loginScreen.style.display = "flex";
    pendingScreen.style.display = "none";
    appShell.style.display = "none";
    return;
  }

  currentStaffRecord = STAFF.find(currentUser.email);
  loginScreen.style.display = "none";

  if (!currentStaffRecord) {
    if (collaborationStarted) { PRESENCE.stop(); collaborationStarted = false; }
    pendingScreen.style.display = "flex";
    appShell.style.display = "none";
    const pendingEmail = document.getElementById("pending-email");
    if (pendingEmail) pendingEmail.textContent = currentUser.email;
    return;
  }

  pendingScreen.style.display = "none";
  appShell.style.display = "";
  updateAuthUI();
  applyTheme(currentStaffRecord.theme || "dark");
  if (!collaborationStarted) {
    collaborationStarted = true;
    PRESENCE.start();
    ACTIVITY.listen();
  }
  renderAll();
}

function updateAuthUI() {
  if (IS_PUBLIC) return;
  const label = document.getElementById("auth-user-label");
  if (label && currentUser && currentStaffRecord) {
    label.textContent = `${currentStaffRecord.name} · ${currentStaffRecord.role}`;
  }
}

/* ---------------- Permissions ---------------- */
const DEV_ALLOWED_EMAIL = "doomsong01@gmail.com";

function currentRole() {
  if (IS_PUBLIC) return "Member";
  return currentStaffRecord ? currentStaffRecord.role : "Member";
}
function canEdit() {
  return currentRole() !== "Member";
}
function canManageAdmin() {
  return currentRole() === "Guild Leader" || currentRole() === "Co-Leader" || currentRole() === "Developer";
}
function canAssignCoLeader() {
  return currentRole() === "Guild Leader";
}
function canAssignAdminStaff() {
  return currentRole() === "Guild Leader" || currentRole() === "Co-Leader" || currentRole() === "Developer";
}
function canAccessDevTools() {
  return !IS_PUBLIC && !!currentUser && (currentUser.email || "").toLowerCase() === DEV_ALLOWED_EMAIL;
}

/* ================================================================
   RENDER: Stat row (Team Builder header)
   ================================================================ */
function renderStats() {
  const el = document.getElementById("stat-members");
  if (!el) return;
  const s = STORE.state;
  const available = s.members.filter((m) => m.availability === "Available").length;

  document.getElementById("stat-members").textContent = s.members.length;
  document.getElementById("stat-available").textContent = available;
}

/* ================================================================
   RENDER: Inventory (with sort + filter)
   ================================================================ */
let invSort = { key: "name", dir: "asc" };
let invFilters = { role: "", availability: "", group: "" };

function getFilteredSortedMembers() {
  let members = STORE.state.members.slice();

  if (invFilters.role) members = members.filter((m) => m.role === invFilters.role);
  if (invFilters.availability) members = members.filter((m) => m.availability === invFilters.availability);
  if (invFilters.group === "__unassigned__") members = members.filter((m) => !m.groupId);
  else if (invFilters.group) members = members.filter((m) => m.groupId === invFilters.group);

  const q = (document.getElementById("inv-search")?.value || "").toLowerCase();
  if (q) members = members.filter((m) => m.name.toLowerCase().includes(q));

  const { key, dir } = invSort;
  members.sort((a, b) => {
    let av, bv;
    if (key === "group") {
      av = getGroup(a.groupId)?.name || "";
      bv = getGroup(b.groupId)?.name || "";
    } else {
      av = a[key];
      bv = b[key];
    }
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
  return members;
}

function renderInventory() {
  const tbody = document.getElementById("roster-tbody");
  if (!tbody) return;

  const roleSel = document.getElementById("inv-filter-role");
  const availSel = document.getElementById("inv-filter-availability");
  const groupSel = document.getElementById("inv-filter-group");
  if (roleSel && roleSel.dataset.built !== "1") {
    roleSel.innerHTML = `<option value="">All roles</option>` + ROLE_ORDER.map((r) => `<option value="${r}">${r}</option>`).join("");
    roleSel.dataset.built = "1";
    roleSel.addEventListener("change", () => { invFilters.role = roleSel.value; renderInventory(); });
  }
  if (availSel && availSel.dataset.built !== "1") {
    availSel.innerHTML = `<option value="">All availability</option><option>Available</option><option>Unavailable</option>`;
    availSel.dataset.built = "1";
    availSel.addEventListener("change", () => { invFilters.availability = availSel.value; renderInventory(); });
  }
  if (groupSel) {
    groupSel.innerHTML =
      `<option value="">All groups</option><option value="__unassigned__">Unassigned</option>` +
      STORE.state.groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
    groupSel.value = invFilters.group;
    if (groupSel.dataset.wired !== "1") {
      groupSel.addEventListener("change", () => { invFilters.group = groupSel.value; renderInventory(); });
      groupSel.dataset.wired = "1";
    }
  }

  document.querySelectorAll("[data-sort-key]").forEach((th) => {
    const key = th.dataset.sortKey;
    const arrow = invSort.key === key ? (invSort.dir === "asc" ? " ▲" : " ▼") : "";
    th.textContent = th.dataset.label + arrow;
    if (th.dataset.wired !== "1") {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        if (invSort.key === key) invSort.dir = invSort.dir === "asc" ? "desc" : "asc";
        else invSort = { key, dir: "asc" };
        renderInventory();
      });
      th.dataset.wired = "1";
    }
  });

  const members = getFilteredSortedMembers();

  if (members.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <div class="es-title">No members match</div>
      Add a member, paste a roster in bulk, or clear your filters.
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = members
    .map((m) => {
      const group = getGroup(m.groupId);
      return `<tr>
        <td>${escapeHtml(m.name)}</td>
        <td>${escapeHtml(m.className || "—")}</td>
        <td><span class="role-chip role-${m.role}" style="color:${ROLE_COLOR[m.role]}">${m.role}</span></td>
        <td class="gear-num">${m.gear ?? "—"}</td>
        <td><span class="avail-dot avail-${m.availability}"></span>${m.availability}</td>
        <td>${group ? escapeHtml(group.name) : "<span style='color:var(--text-faint)'>Unassigned</span>"}</td>
        <td>
          ${canEdit() ? `<button class="btn btn-sm btn-ghost" data-edit-member="${m.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del-member="${m.id}">Remove</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");

  tbody.querySelectorAll("[data-edit-member]").forEach((btn) =>
    btn.addEventListener("click", () => openMemberModal(btn.dataset.editMember))
  );
  tbody.querySelectorAll("[data-del-member]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("Remove this member from the roster? They'll also be pulled from any party slots.")) {
        removeMember(btn.dataset.delMember);
      }
    })
  );
}

function removeMember(id) {
  const m = getMember(id);
  STORE.state.members = STORE.state.members.filter((m) => m.id !== id);
  STORE.state.teams.forEach((t) =>
    t.parties.forEach((p) => {
      p.slots = p.slots.map((s) => (s === id ? null : s));
    })
  );
  STORE.save();
  ACTIVITY.log(`removed member "${m?.name || "unknown"}"`);
  renderAll();
  toast("Member removed.", "danger");
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- Member modal (add/edit) ---------------- */
let editingMemberId = null;

function populateClassSelect(currentValue) {
  const sel = document.getElementById("mf-class");
  if (!sel) return;
  const known = new Set();
  let html = `<option value="">— Select —</option>`;
  CLASS_GROUPS.forEach((g) => {
    html += `<optgroup label="${escapeHtml(g.base)}">` +
      g.jobs.map((j) => { known.add(j); return `<option value="${escapeHtml(j)}">${escapeHtml(j)}</option>`; }).join("") +
      `</optgroup>`;
  });
  if (currentValue && !known.has(currentValue)) {
    html = `<option value="${escapeHtml(currentValue)}">${escapeHtml(currentValue)} (current)</option>` + html;
  }
  sel.innerHTML = html;
  sel.value = currentValue || "";
}

function openMemberModal(id) {
  editingMemberId = id || null;
  const m = id ? getMember(id) : null;
  document.getElementById("member-modal-title").textContent = m ? "Edit member" : "Add member";
  document.getElementById("mf-name").value = m?.name || "";
  populateClassSelect(m?.className || "");
  document.getElementById("mf-role").value = m?.role || "DPS";
  document.getElementById("mf-availability").value = m?.availability || "Available";
  document.getElementById("mf-group").innerHTML =
    `<option value="">Unassigned</option>` +
    STORE.state.groups.map((g) => {
      const count = STORE.state.members.filter((x) => x.groupId === g.id).length;
      const full = count >= MAX_GROUP_SIZE && m?.groupId !== g.id;
      return `<option value="${g.id}" ${m?.groupId === g.id ? "selected" : ""} ${full ? "disabled" : ""}>${escapeHtml(g.name)} (${count}/${MAX_GROUP_SIZE}${full ? " — full" : ""})</option>`;
    }).join("");
  document.getElementById("mf-notes").value = m?.notes || "";
  openModal("member-modal");
}

function saveMemberForm() {
  const name = document.getElementById("mf-name").value.trim();
  if (!name) {
    toast("Give this member a name first.", "danger");
    return;
  }
  const duplicate = STORE.state.members.some(
    (x) => x.id !== editingMemberId && x.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    toast(`"${name}" is already registered — in-game names are unique, so this looks like a duplicate.`, "danger");
    return;
  }
  const targetGroupId = document.getElementById("mf-group").value || null;
  if (targetGroupId) {
    const count = STORE.state.members.filter((x) => x.groupId === targetGroupId && x.id !== editingMemberId).length;
    if (count >= MAX_GROUP_SIZE) {
      toast("That group is already full (5/5).", "danger");
      return;
    }
  }
  const data = {
    name,
    className: document.getElementById("mf-class").value,
    role: document.getElementById("mf-role").value,
    gear: editingMemberId ? (getMember(editingMemberId)?.gear ?? 0) : 0,
    availability: document.getElementById("mf-availability").value,
    groupId: targetGroupId,
    notes: document.getElementById("mf-notes").value.trim(),
  };
  if (editingMemberId) {
    Object.assign(getMember(editingMemberId), data);
    ACTIVITY.log(`edited member "${name}"`);
    toast("Member updated.", "success");
  } else {
    STORE.state.members.push({ id: uid("mem"), ...data });
    ACTIVITY.log(`added member "${name}"`);
    toast("Member added.", "success");
  }
  STORE.save();
  closeModal("member-modal");
  renderAll();
}

/* ---------------- Bulk paste ---------------- */
function openBulkModal() {
  document.getElementById("bulk-paste").value = "";
  openModal("bulk-modal");
}

function parseBulkPaste() {
  const raw = document.getElementById("bulk-paste").value.trim();
  if (!raw) {
    toast("Paste some rows first.", "danger");
    return;
  }
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const seenNames = new Set(STORE.state.members.map((m) => m.name.trim().toLowerCase()));
  let added = 0;
  let skipped = 0;
  lines.forEach((line) => {
    const cols = line.split(/\t|,(?![^(]*\))/).map((c) => c.trim());
    const [name, className, role, gear, availability] = cols;
    if (!name) return;
    const key = name.trim().toLowerCase();
    if (seenNames.has(key)) {
      skipped++;
      return;
    }
    seenNames.add(key);
    const normRole = ROLE_ORDER.find((r) => r.toLowerCase() === (role || "").toLowerCase())
      || (role ? ((role || "").toLowerCase() === "healer" ? "FS" : "DPS") : getAutoRoleForClass(className || ""));
    const normAvail = ["Available", "Unavailable"].find(
      (a) => a.toLowerCase() === (availability || "").toLowerCase()
    ) || "Available";
    STORE.state.members.push({
      id: uid("mem"),
      name,
      className: className || "",
      role: normRole,
      gear: Number(gear) || 0,
      availability: normAvail,
      groupId: null,
      notes: "",
    });
    added++;
  });
  STORE.save();
  closeModal("bulk-modal");
  renderAll();
  let msg = `Added ${added} member${added === 1 ? "" : "s"} from paste.`;
  if (skipped > 0) msg += ` Skipped ${skipped} duplicate name${skipped === 1 ? "" : "s"}.`;
  toast(msg, skipped > 0 ? "danger" : "success");
}

/* ================================================================
   RENDER: Groups (with edit, 5-member cap, search, exclusivity)
   ================================================================ */
function renderGroups() {
  const wrap = document.getElementById("group-grid");
  if (!wrap) return;
  const groups = STORE.state.groups;
  if (groups.length === 0) {
    wrap.innerHTML = `<div class="empty-state">
      <div class="es-title">No groups yet</div>
      Create a group for members who play together, then edit it to assign up to 5 members.
    </div>`;
    return;
  }
  wrap.innerHTML = groups
    .map((g) => {
      const members = STORE.state.members.filter((m) => m.groupId === g.id);
      return `<div class="group-card">
        <div class="group-card-head">
          <div>
            <div class="group-name">${escapeHtml(g.name)}</div>
            <div class="group-schedule">${members.length}/${MAX_GROUP_SIZE} members</div>
          </div>
          ${canEdit() ? `<div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-ghost" data-edit-group="${g.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del-group="${g.id}">Delete</button>
          </div>` : ""}
        </div>
        <div class="group-members">
          ${members.length === 0 ? `<span style="color:var(--text-faint);font-size:11px;">No members assigned yet.</span>` :
            members.map((m) => `<span class="member-tag">${escapeHtml(m.name)}</span>`).join("")}
        </div>
      </div>`;
    })
    .join("");

  wrap.querySelectorAll("[data-del-group]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("Delete this group? Members stay on the roster but become unassigned.")) {
        const gid = btn.dataset.delGroup;
        const gname = getGroup(gid)?.name || "unknown";
        STORE.state.groups = STORE.state.groups.filter((g) => g.id !== gid);
        STORE.state.members.forEach((m) => { if (m.groupId === gid) m.groupId = null; });
        STORE.save();
        ACTIVITY.log(`deleted Bond "${gname}"`);
        renderAll();
      }
    })
  );
  wrap.querySelectorAll("[data-edit-group]").forEach((btn) =>
    btn.addEventListener("click", () => openGroupModal(btn.dataset.editGroup))
  );
}

let editingGroupId = null;
let gfSelectedIds = new Set();

function openGroupModal(id) {
  editingGroupId = id || null;
  const g = id ? getGroup(id) : null;
  document.getElementById("group-modal-title").textContent = g ? "Edit group" : "New group";
  document.getElementById("gf-name").value = g?.name || "";
  document.getElementById("gf-member-search").value = "";
  gfSelectedIds = new Set(STORE.state.members.filter((m) => g && m.groupId === g.id).map((m) => m.id));
  renderGroupMemberChecklist();
  openModal("group-modal");
}

function renderGroupMemberChecklist() {
  const wrap = document.getElementById("gf-members");
  if (!wrap) return;
  const q = (document.getElementById("gf-member-search")?.value || "").toLowerCase();
  const members = STORE.state.members
    .filter((m) => m.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (STORE.state.members.length === 0) {
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:11.5px; padding:8px 0;">Add members in Members first, then assign them to a group here.</div>`;
    return;
  }
  if (members.length === 0) {
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:11.5px; padding:8px 0;">No members match "${escapeHtml(q)}".</div>`;
    return;
  }

  wrap.innerHTML = members
    .map((m) => {
      const otherGroup = !!m.groupId && m.groupId !== editingGroupId;
      const otherName = otherGroup ? getGroup(m.groupId)?.name : null;
      return `<label style="display:flex;align-items:center;gap:8px;padding:5px 4px;font-size:12px;">
        <input type="checkbox" data-gm="${m.id}" data-other-group="${otherGroup ? "1" : "0"}" ${gfSelectedIds.has(m.id) ? "checked" : ""} />
        ${escapeHtml(m.name)}
        ${otherName ? `<span style="color:var(--text-faint); font-size:10.5px;">(in ${escapeHtml(otherName)})</span>` : ""}
      </label>`;
    })
    .join("");

  wrap.querySelectorAll("[data-gm]").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) gfSelectedIds.add(cb.dataset.gm);
      else gfSelectedIds.delete(cb.dataset.gm);
      updateGroupChecklistState();
    })
  );
  updateGroupChecklistState();
}

function updateGroupChecklistState() {
  const boxes = Array.from(document.querySelectorAll("#gf-members [data-gm]"));
  boxes.forEach((cb) => {
    if (cb.dataset.otherGroup === "1") {
      cb.disabled = true;
      return;
    }
    cb.disabled = !gfSelectedIds.has(cb.dataset.gm) && gfSelectedIds.size >= MAX_GROUP_SIZE;
  });
  const counter = document.getElementById("gf-member-count");
  if (counter) counter.textContent = `${gfSelectedIds.size}/${MAX_GROUP_SIZE} selected`;
}

function saveGroupForm() {
  const name = document.getElementById("gf-name").value.trim();
  if (!name) {
    toast("Name the group first.", "danger");
    return;
  }
  if (gfSelectedIds.size > MAX_GROUP_SIZE) {
    toast(`Groups are capped at ${MAX_GROUP_SIZE} members.`, "danger");
    return;
  }

  let group;
  if (editingGroupId) {
    group = getGroup(editingGroupId);
    group.name = name;
  } else {
    group = { id: uid("grp"), name };
    STORE.state.groups.push(group);
  }

  STORE.state.members.forEach((m) => {
    if (gfSelectedIds.has(m.id)) m.groupId = group.id;
    else if (m.groupId === group.id) m.groupId = null;
  });

  STORE.save();
  ACTIVITY.log(editingGroupId ? `edited Bond "${name}"` : `created Bond "${name}"`);
  closeModal("group-modal");
  renderAll();
  toast(editingGroupId ? "Group updated." : "Group created.", "success");
}

/* ================================================================
   RENDER: Team Builder
   ================================================================ */
let activeTeamId = null;

function renderTeamControls() {
  const eliteCount = teamsOfType("elite").length;
  const subCount = teamsOfType("sub").length;
  const addElite = document.getElementById("btn-add-elite-team");
  const addSub = document.getElementById("btn-add-sub-team");
  if (addElite) {
    addElite.textContent = `+ New Elite Team (${eliteCount}/${MAX_TEAMS_PER_TYPE})`;
    addElite.disabled = eliteCount >= MAX_TEAMS_PER_TYPE || !canEdit();
  }
  if (addSub) {
    addSub.textContent = `+ New Sub Team (${subCount}/${MAX_TEAMS_PER_TYPE})`;
    addSub.disabled = subCount >= MAX_TEAMS_PER_TYPE || !canEdit();
  }
}

function createTeam(type) {
  const count = teamsOfType(type).length;
  if (count >= MAX_TEAMS_PER_TYPE) {
    toast(`You can only have up to ${MAX_TEAMS_PER_TYPE} ${type === "elite" ? "Elite" : "Sub"} Teams.`, "danger");
    return;
  }
  const label = type === "elite" ? "Elite Team" : "Sub Team";
  const team = emptyTeam(`${label} ${count + 1}`, type, 1);
  STORE.state.teams.push(team);
  activeTeamId = team.id;
  STORE.save();
  ACTIVITY.log(`created "${team.name}"`);
  renderTeamBuilder();
  renderTeamControls();
  toast(`${label} created.`, "success");
}

function deleteTeam(teamId) {
  const team = getTeam(teamId);
  if (!team) return;
  const filled = team.parties.some((p) => filledSlotCount(p) > 0);
  const msg = filled
    ? "This team has members slotted in. Delete it anyway? They'll simply be unslotted, not removed from the roster."
    : "Delete this team?";
  if (!confirm(msg)) return;
  STORE.state.teams = STORE.state.teams.filter((t) => t.id !== teamId);
  if (activeTeamId === teamId) activeTeamId = STORE.state.teams[0]?.id || null;
  STORE.save();
  ACTIVITY.log(`deleted "${team.name}"`);
  renderTeamBuilder();
  renderTeamControls();
  toast("Team deleted.", "danger");
}

function addPartyToTeam(team) {
  if (team.parties.length >= MAX_PARTIES_PER_TEAM) {
    toast(`A team can have at most ${MAX_PARTIES_PER_TEAM} parties.`, "danger");
    return;
  }
  team.parties.push(emptyParty(`Party ${team.parties.length + 1}`));
  STORE.save();
  renderTeamBuilder();
}

function removePartyFromTeam(team, partyId) {
  if (team.parties.length <= MIN_PARTIES_PER_TEAM) {
    toast("A team needs at least one party.", "danger");
    return;
  }
  const party = team.parties.find((p) => p.id === partyId);
  const filled = party ? filledSlotCount(party) > 0 : false;
  const msg = filled
    ? "This party has members slotted in. Remove it anyway?"
    : `Remove "${party?.name || "this party"}"?`;
  if (!confirm(msg)) return;
  team.parties = team.parties.filter((p) => p.id !== partyId);
  STORE.save();
  renderTeamBuilder();
  renderRosterPool();
}

function renderTeamTabs() {
  const wrap = document.getElementById("team-tabs");
  if (!wrap) return;
  if ((!activeTeamId || !getTeam(activeTeamId)) && STORE.state.teams.length) activeTeamId = STORE.state.teams[0].id;
  wrap.innerHTML = STORE.state.teams
    .map(
      (t) =>
        `<button class="team-tab ${t.id === activeTeamId ? "active" : ""}" data-team="${t.id}">
          ${escapeHtml(t.name)} <span style="opacity:.6; font-size:10px;">${t.type === "elite" ? "ELITE" : "SUB"}</span>
        </button>`
    )
    .join("");
  wrap.querySelectorAll("[data-team]").forEach((btn) =>
    btn.addEventListener("click", () => {
      activeTeamId = btn.dataset.team;
      renderTeamBuilder();
    })
  );
}

function ringSvg(counts, rules, size = 40) {
  const radius = size / 2 - 4;
  const circumf = 2 * Math.PI * radius;
  let weights = ROLE_ORDER.map((r) => Math.max(rules[r] || 0, 0));
  if (weights.every((w) => w === 0)) weights = ROLE_ORDER.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let offset = 0;
  const arcs = ROLE_ORDER.map((r, i) => {
    const w = weights[i];
    if (w === 0) return "";
    const need = rules[r] || 0;
    const have = counts[r] || 0;
    const met = need === 0 || have >= need;
    const len = (w / total) * circumf;
    const gap = circumf - len;
    const dash = `${len - 2} ${gap + 2}`;
    const rot = (offset / circumf) * 360;
    offset += len;
    const color = met ? ROLE_COLOR[r] : "var(--danger)";
    return `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${color}"
      stroke-width="5" stroke-dasharray="${dash}" stroke-dashoffset="0"
      transform="rotate(${rot} ${size / 2} ${size / 2})" stroke-linecap="round" />`;
  }).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${arcs}</svg>`;
}

function renderTeamBuilder() {
  renderStats();
  renderTeamControls();
  renderTeamTabs();
  const team = getTeam(activeTeamId);
  const grid = document.getElementById("party-grid");
  const toolbar = document.getElementById("team-toolbar");
  if (!grid) return;

  if (!team) {
    grid.innerHTML = `<div class="empty-state"><div class="es-title">No teams yet</div>Create an Elite or Sub Team to start building lineups.</div>`;
    if (toolbar) toolbar.innerHTML = "";
    return;
  }

  if (toolbar) {
    toolbar.innerHTML = `
      <input class="party-name-input" id="team-rename-input" value="${escapeHtml(team.name)}" style="max-width:220px; border:1px solid var(--border); background:var(--panel-raised); border-radius:6px;" ${canEdit() ? "" : "disabled"} />
      <span style="flex:1;"></span>
      ${canEdit() ? `<button class="btn btn-sm btn-ghost" id="btn-add-party" ${team.parties.length >= MAX_PARTIES_PER_TEAM ? "disabled" : ""}>+ Add party (${team.parties.length}/${MAX_PARTIES_PER_TEAM})</button>
      <button class="btn btn-sm btn-danger" id="btn-delete-team">Delete team</button>` : `<span class="pool-hint">${team.parties.length} parties</span>`}
    `;
    const renameInput = document.getElementById("team-rename-input");
    renameInput?.addEventListener("change", () => {
      team.name = renameInput.value.trim() || team.name;
      STORE.save();
      renderTeamTabs();
    });
    document.getElementById("btn-add-party")?.addEventListener("click", () => addPartyToTeam(team));
    document.getElementById("btn-delete-team")?.addEventListener("click", () => deleteTeam(team.id));
  }

  grid.innerHTML = team.parties
    .map((p) => {
      const missing = partyMissingRoles(p);
      const counts = partyRoleCounts(p);
      const hasWarning = missing.length > 0 && !p.verified;
      const ring = ringSvg(counts, STORE.state.rules);
      const filled = filledSlotCount(p);

      const banner = hasWarning
        ? `<div class="warn-banner">
            ⚠ Missing ${missing.map((m) => `${m.role} (${m.have}/${m.need})`).join(", ")}
            ${canEdit() ? `<button class="btn btn-sm verify-btn" data-verify="${p.id}">Mark OK</button>` : ""}
          </div>`
        : (missing.length > 0 && p.verified)
        ? `<div class="verified-banner">✓ Comp verified by admin
            ${canEdit() ? `<button class="btn btn-sm btn-ghost" data-unverify="${p.id}" style="margin-left:auto;font-size:10.5px;padding:3px 8px;">Undo</button>` : ""}
          </div>`
        : "";

      const slotsHtml = p.slots
        .map((mid, idx) => {
          const m = mid ? getMember(mid) : null;
          if (m) {
            return `<div class="slot filled" draggable="${canEdit()}" data-slot-drag="${p.id}:${idx}">
              <span class="slot-idx">${idx + 1}</span>
              <span class="rd" style="background:${ROLE_COLOR[m.role]}"></span>
              <span class="nm">${escapeHtml(m.name)}</span>
              <span class="gr">${m.gear}</span>
              ${canEdit() ? `<button class="remove-btn" data-remove-slot="${p.id}:${idx}">✕</button>` : ""}
            </div>`;
          }
          return `<div class="slot" data-slot-drop="${p.id}:${idx}">
            <span class="slot-idx">${idx + 1}</span>
            <span class="empty-label">Empty</span>
            ${canEdit() ? `<button class="suggest-btn" data-suggest="${p.id}:${idx}">Suggest</button>` : ""}
          </div>`;
        })
        .join("");

      const removeBtn = canEdit() && team.parties.length > MIN_PARTIES_PER_TEAM
        ? `<button class="btn btn-sm btn-ghost" data-remove-party="${p.id}" title="Remove this party" style="padding:2px 6px; font-size:11px;">✕</button>`
        : "";

      return `<div class="party-card ${hasWarning ? "warn" : ""}" data-party="${p.id}">
        <div class="party-head">
          <input class="party-name-input" value="${escapeHtml(p.name)}" data-rename-party="${p.id}" ${canEdit() ? "" : "disabled"} />
          <div class="ring-wrap" title="${filled}/${p.slots.length} filled">${ring}<div class="ring-center">${filled}/${p.slots.length}</div></div>
          ${removeBtn}
        </div>
        ${banner}
        <div class="slot-list">${slotsHtml}</div>
      </div>`;
    })
    .join("");

  wireBuilderEvents(team);
}

function wireBuilderEvents(team) {
  document.querySelectorAll("[data-rename-party]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const p = team.parties.find((p) => p.id === inp.dataset.renameParty);
      p.name = inp.value.trim() || p.name;
      STORE.save();
    })
  );

  document.querySelectorAll("[data-remove-party]").forEach((btn) =>
    btn.addEventListener("click", () => removePartyFromTeam(team, btn.dataset.removeParty))
  );

  document.querySelectorAll("[data-verify]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = team.parties.find((p) => p.id === btn.dataset.verify);
      p.verified = true;
      STORE.save();
      renderTeamBuilder();
      toast("Composition marked OK by admin override.", "success");
    })
  );
  document.querySelectorAll("[data-unverify]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const p = team.parties.find((p) => p.id === btn.dataset.unverify);
      p.verified = false;
      STORE.save();
      renderTeamBuilder();
    })
  );

  document.querySelectorAll("[data-remove-slot]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const [pid, idx] = btn.dataset.removeSlot.split(":");
      const p = team.parties.find((p) => p.id === pid);
      p.slots[Number(idx)] = null;
      p.verified = false;
      STORE.save();
      renderTeamBuilder();
      renderRosterPool();
    })
  );

  document.querySelectorAll("[data-suggest]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const [pid, idx] = btn.dataset.suggest.split(":");
      suggestForSlot(team, pid, Number(idx));
    })
  );

  document.querySelectorAll("[data-slot-drag]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "slot", key: el.dataset.slotDrag }));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  });

  document.querySelectorAll("[data-slot-drop], .slot.filled").forEach((el) => {
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("dragover");
    });
    el.addEventListener("dragleave", () => el.classList.remove("dragover"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("dragover");
      const key = el.dataset.slotDrop || el.dataset.slotDrag;
      const [pid, idx] = key.split(":");
      handleDrop(team, pid, Number(idx), e);
    });
  });

  // whole-group drop target: drop anywhere on a party card to fill its empty slots at once
  document.querySelectorAll(".party-card").forEach((card) => {
    card.addEventListener("dragover", (e) => {
      const dt = e.dataTransfer;
      if (dt && Array.from(dt.types || []).includes("text/plain")) e.preventDefault();
    });
    card.addEventListener("drop", (e) => {
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      let payload;
      try { payload = JSON.parse(raw); } catch { return; }
      if (payload.type !== "group") return;
      e.preventDefault();
      handleGroupDropOnParty(team, card.dataset.party, payload.groupId);
    });
  });
}

function handleDrop(team, partyId, idx, e) {
  const raw = e.dataTransfer.getData("text/plain");
  if (!raw) return;
  const payload = JSON.parse(raw);
  if (payload.type !== "pool" && payload.type !== "slot") return;
  const party = team.parties.find((p) => p.id === partyId);
  if (!party) return;

  if (payload.type === "pool") {
    const memberId = payload.memberId;
    if (isMemberSlottedAnywhere(memberId)) {
      toast("That member is already slotted in another team — one character can't run two parties at once.", "danger");
      return;
    }
    party.slots[idx] = memberId;
  } else if (payload.type === "slot") {
    const [fromPid, fromIdx] = payload.key.split(":");
    const fromParty = team.parties.find((p) => p.id === fromPid);
    const memberId = fromParty.slots[Number(fromIdx)];
    const target = party.slots[idx];
    party.slots[idx] = memberId;
    fromParty.slots[Number(fromIdx)] = target;
    fromParty.verified = false;
  }
  party.verified = false;
  STORE.save();
  renderTeamBuilder();
  renderRosterPool();
}

function handleGroupDropOnParty(team, partyId, groupId) {
  const party = team.parties.find((p) => p.id === partyId);
  const group = getGroup(groupId);
  if (!party || !group) return;

  const groupMembers = STORE.state.members.filter((m) => m.groupId === groupId);
  const alreadySlotted = slottedIdsGlobally();
  const placeable = groupMembers.filter((m) => !alreadySlotted.has(m.id));
  const skippedElsewhere = groupMembers.length - placeable.length;

  const emptyIdx = party.slots.map((v, i) => (v ? null : i)).filter((v) => v !== null);
  const placeCount = Math.min(placeable.length, emptyIdx.length);
  for (let i = 0; i < placeCount; i++) {
    party.slots[emptyIdx[i]] = placeable[i].id;
  }
  const leftover = placeable.length - placeCount;

  party.verified = false;
  STORE.save();
  renderTeamBuilder();
  renderRosterPool();

  if (placeCount === 0) {
    toast(`Couldn't place ${group.name} — no empty slots, or everyone's already slotted on another team.`, "danger");
  } else {
    let msg = `Placed ${placeCount} member${placeCount === 1 ? "" : "s"} from ${group.name}.`;
    if (leftover > 0) msg += ` ${leftover} more didn't fit — party ran out of empty slots.`;
    if (skippedElsewhere > 0) msg += ` ${skippedElsewhere} already slotted on another team.`;
    toast(msg, leftover > 0 || skippedElsewhere > 0 ? "danger" : "success");
  }
}

function suggestForSlot(team, partyId, idx) {
  const party = team.parties.find((p) => p.id === partyId);

  // Suggest respects two closed pools and never lets them mix:
  //  - If this party already has a group started, it only completes THAT group.
  //  - If this party has no group in it (empty, or only ungrouped individuals so far),
  //    it only offers other ungrouped individuals — never pulls in someone from any group.
  // If the party's filled slots already show MORE than one context (a manual override
  // already mixed a group with individuals, or two groups), Suggest refuses outright —
  // it can't safely guess further once a deliberate manual mix has already happened.
  const filledContexts = new Set(
    party.slots.filter(Boolean).map((mid) => getMember(mid)?.groupId || "__individual__")
  );

  if (filledContexts.size > 1) {
    toast("This party's lineup is already a manual mix of groups/individuals — Suggest can't safely continue here. Place the remaining slots by hand.", "danger");
    return;
  }

  const isGroupContext = filledContexts.size === 1 && !filledContexts.has("__individual__");
  const contextGroupId = isGroupContext ? [...filledContexts][0] : null;
  const alreadySlottedIds = slottedIdsGlobally();

  let pool = isGroupContext
    ? STORE.state.members.filter(
        (m) => m.availability === "Available" && !alreadySlottedIds.has(m.id) && m.groupId === contextGroupId
      )
    : STORE.state.members.filter(
        (m) => m.availability === "Available" && !alreadySlottedIds.has(m.id) && !m.groupId
      );

  if (pool.length === 0) {
    toast(
      isGroupContext
        ? "No remaining groupmates available for this party — place a stand-in manually if needed."
        : "No available individual (ungrouped) members left to suggest — drag in a group, or place someone manually.",
      "danger"
    );
    return;
  }

  const missing = partyMissingRoles(party);
  const neededRole = missing.length ? missing[0].role : null;
  if (neededRole) {
    const roleMatch = pool.filter((m) => m.role === neededRole);
    if (roleMatch.length === 0) {
      toast(
        `No ${isGroupContext ? "groupmate" : "available individual"} can fill the missing ${neededRole} role here — place someone manually if you want to relax this.`,
        "danger"
      );
      return;
    }
    pool = roleMatch;
  }

  pool.sort((a, b) => b.gear - a.gear);
  const pick = pool[0];
  party.slots[idx] = pick.id;
  party.verified = false;
  STORE.save();
  renderTeamBuilder();
  renderRosterPool();
  toast(`Suggested ${pick.name} (${pick.role}, ${pick.gear} gear)${isGroupContext ? " — groupmate." : " — individual member."}`, "success");
}

/* ---------------- Roster pool (drag source: individual members + whole groups) ---------------- */
function renderRosterPool() {
  const wrap = document.getElementById("pool-list");
  if (!wrap) return;
  const q = (document.getElementById("pool-search")?.value || "").toLowerCase();
  const globallySlotted = slottedIdsGlobally();

  const groupsHtml = STORE.state.groups.length
    ? `<div class="pool-section-label">Groups — drag onto a party</div>` +
      STORE.state.groups
        .map((g) => {
          const groupMembers = STORE.state.members.filter((m) => m.groupId === g.id);
          const fullySlotted = groupMembers.length > 0 && groupMembers.every((m) => globallySlotted.has(m.id));
          return `<div class="pool-chip pool-group-chip ${fullySlotted ? "slotted" : ""}" draggable="${canEdit() && !fullySlotted}" data-pool-group="${g.id}">
            <span class="rd" style="background:var(--gold)"></span>
            <span class="nm">${escapeHtml(g.name)}</span>
            <span class="gr">${groupMembers.length}/${MAX_GROUP_SIZE}</span>
          </div>`;
        })
        .join("")
    : "";

  const members = STORE.state.members
    .filter((m) => m.name.toLowerCase().includes(q))
    .sort((a, b) => b.gear - a.gear);

  const membersHtml = members.length
    ? `<div class="pool-section-label">Members</div>` +
      members
        .map((m) => {
          const slotted = globallySlotted.has(m.id);
          return `<div class="pool-chip ${slotted ? "slotted" : ""}" draggable="${canEdit() && !slotted}" data-pool-member="${m.id}" title="${slotted ? "Already slotted on a team" : ""}">
            <span class="rd" style="background:${ROLE_COLOR[m.role]}"></span>
            <span class="nm">${escapeHtml(m.name)}</span>
            <span class="gr">${m.gear}</span>
          </div>`;
        })
        .join("")
    : `<div class="empty-state" style="padding:20px 8px;">Add members in Members first.</div>`;

  wrap.innerHTML = groupsHtml + membersHtml;

  wrap.querySelectorAll("[data-pool-member]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "pool", memberId: el.dataset.poolMember }));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  });
  wrap.querySelectorAll("[data-pool-group]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "group", groupId: el.dataset.poolGroup }));
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
  });
}

/* ================================================================
   RENDER: Events / Participation
   ================================================================ */
function renderEvents() {
  const wrap = document.getElementById("event-list");
  if (!wrap) return;
  const events = STORE.state.events;
  if (events.length === 0) {
    wrap.innerHTML = `<div class="empty-state"><div class="es-title">No events logged</div>Create your first Guild League or Polarity Zone entry.</div>`;
    return;
  }
  const totalMembers = STORE.state.members.length || 1;
  wrap.innerHTML = events
    .map((ev) => {
      const pct = Math.round((ev.participants.length / totalMembers) * 100);
      return `<div class="event-row">
        <div>
          <div class="event-name">${escapeHtml(ev.name)}</div>
          <div class="event-date">${ev.date}</div>
        </div>
        <div class="event-stat">${ev.participants.length}/${totalMembers} participated</div>
        <div class="progress-bar"><span style="width:${pct}%"></span></div>
        ${canEdit() ? `<button class="btn btn-sm btn-ghost" data-log-event="${ev.id}">Log attendance</button>
        <button class="btn btn-sm btn-danger" data-del-event="${ev.id}">Delete</button>` : ""}
      </div>`;
    })
    .join("");

  wrap.querySelectorAll("[data-del-event]").forEach((btn) =>
    btn.addEventListener("click", () => openDeleteEventModal(btn.dataset.delEvent))
  );
  wrap.querySelectorAll("[data-log-event]").forEach((btn) =>
    btn.addEventListener("click", () => openAttendanceModal(btn.dataset.logEvent))
  );
}

function openEventModal() {
  document.getElementById("ef-name").value = "";
  document.getElementById("ef-date").value = todayStr();
  const wrap = document.getElementById("ef-teams");
  if (STORE.state.teams.length === 0) {
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:11.5px;">No teams yet — create one in Roster first.</div>`;
  } else {
    wrap.innerHTML = STORE.state.teams
      .map((t) => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;">
        <input type="checkbox" data-ef-team="${t.id}" />
        ${escapeHtml(t.name)} <span style="color:var(--text-faint); font-size:10.5px;">(${t.type === "elite" ? "Elite" : "Sub"})</span>
      </label>`)
      .join("");
  }
  openModal("event-modal");
}
function saveEventForm() {
  const name = document.getElementById("ef-name").value.trim();
  if (!name) {
    toast("Name the event first.", "danger");
    return;
  }
  const teamIds = Array.from(document.querySelectorAll("[data-ef-team]:checked")).map((c) => c.dataset.efTeam);
  STORE.state.events.push({
    id: uid("evt"),
    name,
    date: document.getElementById("ef-date").value || todayStr(),
    teamIds,
    participants: [],
  });
  STORE.save();
  ACTIVITY.log(`created event "${name}"`);
  closeModal("event-modal");
  renderAll();
  toast("Event created.", "success");
}

/* ---------------- Delete event (requires typing DELETE to confirm) ---------------- */
let pendingDeleteEventId = null;

function openDeleteEventModal(id) {
  pendingDeleteEventId = id;
  const ev = STORE.state.events.find((e) => e.id === id);
  if (!ev) return;
  document.getElementById("delete-event-name").textContent = ev.name;
  const input = document.getElementById("delete-event-confirm-input");
  input.value = "";
  document.getElementById("delete-event-confirm-btn").disabled = true;
  openModal("delete-event-modal");
  input.focus();
}

function checkDeleteEventInput() {
  const input = document.getElementById("delete-event-confirm-input");
  const btn = document.getElementById("delete-event-confirm-btn");
  btn.disabled = input.value.trim().toUpperCase() !== "DELETE";
}

function confirmDeleteEvent() {
  const input = document.getElementById("delete-event-confirm-input");
  if (input.value.trim().toUpperCase() !== "DELETE") return;
  const ev = STORE.state.events.find((e) => e.id === pendingDeleteEventId);
  STORE.state.events = STORE.state.events.filter((e) => e.id !== pendingDeleteEventId);
  STORE.save();
  ACTIVITY.log(`deleted event "${ev?.name || "unknown"}"`);
  closeModal("delete-event-modal");
  pendingDeleteEventId = null;
  renderAll();
  toast(`Deleted "${ev?.name || "event"}".`, "danger");
}

let attendanceEventId = null;

function renderAttendanceList() {
  const ev = STORE.state.events.find((e) => e.id === attendanceEventId);
  if (!ev) return;
  const autoIds = autoParticipantIds(ev.teamIds);

  const autoQ = (document.getElementById("attendance-auto-search")?.value || "").toLowerCase();
  const autoWrap = document.getElementById("attendance-auto");
  const allAutoMembers = STORE.state.members.filter((m) => autoIds.has(m.id));
  const autoMembers = allAutoMembers.filter((m) => m.name.toLowerCase().includes(autoQ));
  if (allAutoMembers.length === 0) {
    autoWrap.innerHTML = `<span style="color:var(--text-faint); font-size:11.5px;">No linked team lineup — nobody auto-logged. Link a team when creating the event, or check members manually below.</span>`;
  } else if (autoMembers.length === 0) {
    autoWrap.innerHTML = `<span style="color:var(--text-faint); font-size:11.5px;">No matches for "${escapeHtml(autoQ)}".</span>`;
  } else {
    autoWrap.innerHTML = autoMembers.map((m) => `<span class="member-tag">${escapeHtml(m.name)}</span>`).join("");
  }
  document.getElementById("attendance-auto-count").textContent = allAutoMembers.length;

  const q = (document.getElementById("attendance-search")?.value || "").toLowerCase();
  const manualPool = STORE.state.members
    .filter((m) => !autoIds.has(m.id))
    .filter((m) => m.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const listWrap = document.getElementById("attendance-list");
  if (manualPool.length === 0) {
    listWrap.innerHTML = `<div style="color:var(--text-faint); font-size:11.5px; padding:8px 0;">${q ? "No matches." : "Everyone else is already auto-logged from the linked team lineup."}</div>`;
  } else {
    listWrap.innerHTML = manualPool
      .map(
        (m) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;font-size:12.5px;">
          <input type="checkbox" data-att="${m.id}" ${ev.participants.includes(m.id) ? "checked" : ""} />
          ${escapeHtml(m.name)}
        </label>`
      )
      .join("");
  }
}

function openAttendanceModal(id) {
  attendanceEventId = id;
  const ev = STORE.state.events.find((e) => e.id === id);
  document.getElementById("attendance-title").textContent = `Attendance — ${ev.name}`;
  document.getElementById("attendance-search").value = "";
  const autoSearch = document.getElementById("attendance-auto-search");
  if (autoSearch) autoSearch.value = "";
  renderAttendanceList();
  openModal("attendance-modal");
}

function saveAttendance() {
  const ev = STORE.state.events.find((e) => e.id === attendanceEventId);
  const autoIds = autoParticipantIds(ev.teamIds);
  const checked = Array.from(document.querySelectorAll("[data-att]:checked")).map((c) => c.dataset.att);
  ev.participants = Array.from(new Set([...autoIds, ...checked]));
  STORE.save();
  closeModal("attendance-modal");
  renderAll();
  toast("Attendance saved.", "success");
}

/* ================================================================
   RENDER: Queues (dungeon-assist sign-up)
   ================================================================ */
let editingQueueId = null;

function findMemberByName(name) {
  const n = name.trim().toLowerCase();
  return STORE.state.members.find((m) => m.name.toLowerCase() === n) || null;
}

function buildQueueDatalist() {
  const dl = document.getElementById("queue-name-datalist");
  if (!dl) return;
  dl.innerHTML = STORE.state.members
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => `<option value="${escapeHtml(m.name)}"></option>`)
    .join("");
}

function buildDungeonChecklist() {
  const wrap = document.getElementById("queue-dungeon-checks");
  if (!wrap || wrap.dataset.built === "1") return;
  wrap.innerHTML = DUNGEONS.map(
    (d) => `<label class="dungeon-toggle" data-dungeon-label="${d.id}">
      <input type="checkbox" data-dungeon="${d.id}" style="display:none;" />
      <span class="dungeon-icon">${d.icon}</span>
      <span class="dungeon-name">${d.name}</span>
    </label>`
  ).join("");
  wrap.dataset.built = "1";
  wrap.querySelectorAll(".dungeon-toggle").forEach((label) => {
    label.addEventListener("click", (e) => {
      e.preventDefault();
      const cb = label.querySelector("input");
      cb.checked = !cb.checked;
      label.classList.toggle("checked", cb.checked);
    });
  });
}

function resetDungeonChecklist(selectedIds) {
  const ids = selectedIds || [];
  document.querySelectorAll("#queue-dungeon-checks input[data-dungeon]").forEach((cb) => {
    cb.checked = ids.includes(cb.dataset.dungeon);
    cb.closest(".dungeon-toggle")?.classList.toggle("checked", cb.checked);
  });
}

function getSelectedDungeons() {
  return Array.from(document.querySelectorAll("#queue-dungeon-checks input[data-dungeon]:checked")).map(
    (cb) => cb.dataset.dungeon
  );
}

function openQueueModal(id) {
  editingQueueId = id || null;
  const q = id ? STORE.state.queue.find((x) => x.id === id) : null;
  const title = document.getElementById("queue-modal-title");
  if (title) title.textContent = q ? "Edit queue entry" : "Register for queue";
  const nameInput = document.getElementById("queue-name-input");
  if (nameInput) nameInput.value = q ? getMember(q.memberId)?.name || "" : "";
  resetDungeonChecklist(q ? q.dungeons : []);
  openModal("queue-modal");
}

function submitQueueEntry() {
  const nameInput = document.getElementById("queue-name-input");
  const name = nameInput.value.trim();
  if (!name) {
    toast("Search and select an in-game name first.", "danger");
    return;
  }
  const member = findMemberByName(name);
  if (!member) {
    toast("No member found with that exact name — pick one from the suggestions, or ask an admin to add you to Members first.", "danger");
    return;
  }
  const dungeons = getSelectedDungeons();
  if (dungeons.length === 0) {
    toast("Pick at least one dungeon you need help with.", "danger");
    return;
  }

  if (editingQueueId) {
    const entry = STORE.state.queue.find((q) => q.id === editingQueueId);
    entry.memberId = member.id;
    entry.dungeons = dungeons;
    toast("Queue entry updated.", "success");
  } else {
    STORE.state.queue.push({
      id: uid("q"),
      memberId: member.id,
      dungeons,
      claimedBy: null,
      createdAt: Date.now(),
    });
    ACTIVITY.log(`added "${member.name}" to the queue`);
    toast(`${member.name} added to the queue.`, "success");
  }
  STORE.save();
  editingQueueId = null;
  nameInput.value = "";
  resetDungeonChecklist([]);
  closeModal("queue-modal");
  renderQueue();
}

function toggleClaim(id) {
  const q = STORE.state.queue.find((x) => x.id === id);
  if (!q) return;
  if (q.claimedBy) {
    q.claimedBy = null;
    STORE.save();
    renderQueue();
    toast("Unclaimed.", "success");
    return;
  }
  const name = prompt("Who is helping this member? (your in-game name)");
  if (name === null) return;
  q.claimedBy = name.trim() || null;
  STORE.save();
  renderQueue();
  if (q.claimedBy) toast(`Claimed — ${q.claimedBy} is now helping.`, "success");
}

function markQueueHelped(id) {
  if (!confirm("Mark this member as helped and remove them from the queue?")) return;
  const q = STORE.state.queue.find((x) => x.id === id);
  const m = q ? getMember(q.memberId) : null;
  STORE.state.queue = STORE.state.queue.filter((q) => q.id !== id);
  STORE.save();
  ACTIVITY.log(`marked "${m?.name || "someone"}" as helped in the queue`);
  renderQueue();
  toast("Marked as helped — removed from queue.", "success");
}

function removeQueueEntry(id) {
  if (!confirm("Remove this entry from the queue?")) return;
  STORE.state.queue = STORE.state.queue.filter((q) => q.id !== id);
  STORE.save();
  renderQueue();
  toast("Entry removed.", "danger");
}

function renderQueueList() {
  const queue = STORE.state.queue.slice().sort((a, b) => a.createdAt - b.createdAt);

  const pubWrap = document.getElementById("queue-public-list");
  if (pubWrap) {
    pubWrap.innerHTML = queue.length
      ? queue
          .map((q, i) => {
            const m = getMember(q.memberId);
            if (!m) return "";
            const icons = q.dungeons.map((id) => dungeonById(id)?.icon || "").join(" ");
            const statusHtml = q.claimedBy
              ? `<span class="queue-status claimed">Being helped by ${escapeHtml(q.claimedBy)}</span>`
              : `<span class="queue-status waiting">Waiting</span>`;
            return `<div class="queue-row">
              <span class="queue-pos">#${i + 1}</span>
              <span class="queue-name">${escapeHtml(m.name)}</span>
              <span class="queue-icons">${icons}</span>
              ${statusHtml}
            </div>`;
          })
          .join("")
      : `<div class="empty-state"><div class="es-title">Queue is empty</div>Nobody's waiting for a hand right now — nice work, guild!</div>`;
  }

  const adminWrap = document.getElementById("queue-admin-list");
  if (adminWrap) {
    if (queue.length === 0) {
      adminWrap.innerHTML = `<div class="empty-state"><div class="es-title">Queue is empty</div>Register a member who needs help, or wait for members to sign up from the public view.</div>`;
    } else {
      adminWrap.innerHTML = queue
        .map((q, i) => {
          const m = getMember(q.memberId);
          const icons = q.dungeons
            .map((id) => `<span title="${dungeonById(id)?.name}">${dungeonById(id)?.icon}</span>`)
            .join(" ");
          return `<div class="queue-row admin">
            <span class="queue-pos">#${i + 1}</span>
            <span class="queue-name">${m ? escapeHtml(m.name) : "Unknown member"}</span>
            <span class="queue-icons">${icons}</span>
            <span class="queue-claim">${q.claimedBy ? `Helped by ${escapeHtml(q.claimedBy)}` : "Unclaimed"}</span>
            ${
              canEdit()
                ? `<button class="btn btn-sm btn-ghost" data-queue-claim="${q.id}">${q.claimedBy ? "Unclaim" : "Claim"}</button>
                   <button class="btn btn-sm btn-ghost" data-queue-edit="${q.id}">Edit</button>
                   <button class="btn btn-sm btn-primary" data-queue-helped="${q.id}">Mark helped</button>
                   <button class="btn btn-sm btn-danger" data-queue-remove="${q.id}">Remove</button>`
                : ""
            }
          </div>`;
        })
        .join("");
      adminWrap.querySelectorAll("[data-queue-claim]").forEach((btn) =>
        btn.addEventListener("click", () => toggleClaim(btn.dataset.queueClaim))
      );
      adminWrap.querySelectorAll("[data-queue-edit]").forEach((btn) =>
        btn.addEventListener("click", () => openQueueModal(btn.dataset.queueEdit))
      );
      adminWrap.querySelectorAll("[data-queue-helped]").forEach((btn) =>
        btn.addEventListener("click", () => markQueueHelped(btn.dataset.queueHelped))
      );
      adminWrap.querySelectorAll("[data-queue-remove]").forEach((btn) =>
        btn.addEventListener("click", () => removeQueueEntry(btn.dataset.queueRemove))
      );
    }
  }
}

function renderQueue() {
  buildQueueDatalist();
  buildDungeonChecklist();
  renderQueueList();
}

/* ================================================================
   RENDER: Admin
   ================================================================ */
function renderAdmin() {
  const rules = STORE.state.rules;
  ROLE_ORDER.forEach((r) => {
    const el = document.getElementById("rule-" + r.toLowerCase());
    if (el) {
      el.value = rules[r];
      el.disabled = !canManageAdmin();
    }
  });
  const nameInput = document.getElementById("guild-name-input");
  if (nameInput) {
    nameInput.value = STORE.state.guildName;
    nameInput.disabled = !canManageAdmin();
  }
  const rulesSaveBtn = document.getElementById("rules-save");
  if (rulesSaveBtn) rulesSaveBtn.disabled = !canManageAdmin();

  renderStaffPanel();
}

function renderStaffPanel() {
  const listWrap = document.getElementById("staff-list");
  if (!listWrap) return;
  const staff = STAFF.list;
  listWrap.innerHTML = staff.length
    ? staff.map((s) => `<div style="display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--border-soft); font-size:12.5px;">
        <span style="flex:1;">${escapeHtml(s.name)} <span style="color:var(--text-faint);">${escapeHtml(s.email || s.id)}</span></span>
        <span class="role-chip" style="color:var(--gold); border-color:var(--gold-dim); background:var(--gold-glow);">${s.role}</span>
        ${canAssignAdminStaff() ? `<button class="btn btn-sm btn-danger" data-del-staff="${s.id}">Remove</button>` : ""}
      </div>`).join("")
    : `<div style="color:var(--text-faint); font-size:11.5px; padding:6px 0;">No staff assigned yet.</div>`;

  listWrap.querySelectorAll("[data-del-staff]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const s = staff.find((x) => x.id === btn.dataset.delStaff);
      if (!confirm(`Remove ${s ? s.name : "this person"} as ${s ? s.role : "staff"}? They'll lose editing access immediately.`)) return;
      STAFF.remove(btn.dataset.delStaff)
        .then(() => ACTIVITY.log(`removed ${s?.name || "someone"} from staff`))
        .catch((err) => toast("Couldn't remove: " + err.message, "danger"));
    })
  );

  const formWrap = document.getElementById("staff-add-form");
  const noteWrap = document.getElementById("staff-permission-note");
  if (!formWrap) return;

  if (!canAssignAdminStaff()) {
    formWrap.style.display = "none";
    noteWrap.textContent = "Only the Guild Leader and Co-Leaders can assign staff roles.";
    return;
  }
  formWrap.style.display = "flex";

  const roleSelect = document.getElementById("staff-role-select");
  roleSelect.innerHTML = canAssignCoLeader()
    ? `<option>Co-Leader</option><option>Admin Staff</option><option>Developer</option>`
    : `<option>Admin Staff</option>`;

  noteWrap.textContent = canAssignCoLeader()
    ? "As Guild Leader, you can assign Co-Leader, Admin Staff, or Developer roles."
    : "As a Co-Leader, you can assign Admin Staff — only the Guild Leader can assign Co-Leaders or Developer.";
}

function addStaffMember() {
  const nameInput = document.getElementById("staff-name-input");
  const emailInput = document.getElementById("staff-email-input");
  const roleSelect = document.getElementById("staff-role-select");
  const name = nameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  if (!name) {
    toast("Enter a name or handle first.", "danger");
    return;
  }
  if (!email || !email.includes("@")) {
    toast("Enter the email they'll log in with.", "danger");
    return;
  }
  const role = roleSelect.value;
  if ((role === "Co-Leader" || role === "Developer") && !canAssignCoLeader()) {
    toast("Only the Guild Leader can assign Co-Leader or Developer roles.", "danger");
    return;
  }
  STAFF.add(name, email, role)
    .then(() => {
      nameInput.value = "";
      emailInput.value = "";
      ACTIVITY.log(`assigned ${name} (${email}) as ${role}`);
      toast(`${name} assigned as ${role}. They can now sign in with ${email}.`, "success");
    })
    .catch((err) => toast("Couldn't save: " + err.message, "danger"));
}

function saveRules() {
  if (!canManageAdmin()) return;
  ROLE_ORDER.forEach((r) => {
    const el = document.getElementById("rule-" + r.toLowerCase());
    STORE.state.rules[r] = Math.max(0, Number(el.value) || 0);
  });
  STORE.state.guildName = document.getElementById("guild-name-input").value.trim() || "NightShiftPH";
  STORE.save();
  ACTIVITY.log("updated composition rules");
  renderAll();
  toast("Composition rules updated — party warnings recalculated.", "success");
}

/* ================================================================
   Developer Tools — hidden panel, gated by a code, not real security
   (Firestore rules are the real protection). Just keeps casual staff
   from stumbling into destructive/test-only actions.
   ================================================================ */
const DEV_CODE = "180603";

const DEFAULT_SAMPLE_DATA = [
  { name: "Aeris", className: "Paladin", role: "Tank", gear: 192, availability: "Available", grouped: true },
  { name: "Vessahl", className: "Lord Knight", role: "Tank", gear: 178, availability: "Available", grouped: true },
  { name: "Lunael", className: "High Priest", role: "FS", gear: 175, availability: "Available", grouped: true },
  { name: "Cyrenne", className: "Priest", role: "FS", gear: 168, availability: "Available", grouped: true },
  { name: "Kael", className: "Sniper", role: "DPS", gear: 205, availability: "Available", grouped: true },
  { name: "Dorian", className: "Assassin Cross", role: "DPS", gear: 199, availability: "Available", grouped: false },
  { name: "Fennis", className: "Champion", role: "DPS", gear: 184, availability: "Unavailable", grouped: false },
  { name: "Ithra", className: "Whitesmith", role: "DPS", gear: 172, availability: "Available", grouped: false },
  { name: "Marewen", className: "Karnos", role: "DPS", gear: 190, availability: "Available", grouped: false },
  { name: "Talos", className: "Rebel", role: "DPS", gear: 165, availability: "Unavailable", grouped: false },
];

function openDevGate() {
  if (!canAccessDevTools()) {
    toast("Nothing here.", "danger");
    return;
  }
  const input = document.getElementById("dev-gate-code");
  if (input) input.value = "";
  openModal("dev-gate-modal");
}

function submitDevGate() {
  if (!canAccessDevTools()) return;
  const input = document.getElementById("dev-gate-code");
  if (input.value.trim() === DEV_CODE) {
    closeModal("dev-gate-modal");
    openDevTools();
  } else {
    toast("Incorrect code.", "danger");
    input.value = "";
  }
}

function openDevTools() {
  const ta = document.getElementById("dev-sample-json");
  if (ta && !ta.value.trim()) ta.value = JSON.stringify(DEFAULT_SAMPLE_DATA, null, 2);
  populateDevThemeStaffSelect();
  const resetInput = document.getElementById("dev-reset-confirm-input");
  if (resetInput) resetInput.value = "";
  const resetBtn = document.getElementById("dev-reset-confirm-btn");
  if (resetBtn) resetBtn.disabled = true;
  openModal("dev-tools-modal");
}

function loadDevSampleData() {
  const ta = document.getElementById("dev-sample-json");
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    toast("That's not valid JSON: " + e.message, "danger");
    return;
  }
  if (!Array.isArray(parsed)) {
    toast("Expected a JSON array of member objects.", "danger");
    return;
  }
  const g1 = { id: uid("grp"), name: "Night Shift Crew" };
  const anyGrouped = parsed.some((m) => m.grouped);
  if (anyGrouped) STORE.state.groups.push(g1);
  parsed.forEach((m, i) => {
    STORE.state.members.push({
      id: uid("mem"),
      name: m.name || `Member ${i + 1}`,
      className: m.className || "",
      role: ROLE_ORDER.includes(m.role) ? m.role : "DPS",
      gear: Number(m.gear) || 0,
      availability: m.availability === "Unavailable" ? "Unavailable" : "Available",
      groupId: m.grouped ? g1.id : null,
      notes: "",
    });
  });
  STORE.save();
  ACTIVITY.log("loaded test data via Developer Tools");
  closeModal("dev-tools-modal");
  renderAll();
  toast(`Loaded ${parsed.length} test member${parsed.length === 1 ? "" : "s"}.`, "success");
}

function populateDevThemeStaffSelect() {
  const sel = document.getElementById("dev-theme-staff-select");
  if (!sel) return;
  sel.innerHTML = STAFF.list
    .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.email || s.id)})</option>`)
    .join("");
}

function applyDevStaffTheme() {
  const email = document.getElementById("dev-theme-staff-select").value;
  const theme = document.getElementById("dev-theme-select").value;
  if (!email) {
    toast("Pick a staff member first.", "danger");
    return;
  }
  db.collection("staff").doc(email).set({ theme }, { merge: true })
    .then(() => {
      ACTIVITY.log(`set ${email}'s theme to ${theme} via Developer Tools`);
      toast(`Theme updated for ${email}.`, "success");
    })
    .catch((err) => toast("Couldn't update: " + err.message, "danger"));
}

function checkDevResetInput() {
  const input = document.getElementById("dev-reset-confirm-input");
  document.getElementById("dev-reset-confirm-btn").disabled = input.value.trim().toUpperCase() !== "RESET";
}

function confirmDevReset() {
  const input = document.getElementById("dev-reset-confirm-input");
  if (input.value.trim().toUpperCase() !== "RESET") return;
  STORE.state = defaultState();
  STORE.save();
  ACTIVITY.log("reset all guild data via Developer Tools");
  closeModal("dev-tools-modal");
  renderAll();
  toast("All data reset.", "danger");
}

/* ---------------- Guild logo ---------------- */
const MAX_LOGO_BYTES = 150 * 1024;

function renderBrand() {
  const logoHtml = STORE.state.guildLogoUrl
    ? `<img src="${STORE.state.guildLogoUrl}" alt="" style="height:20px; width:20px; object-fit:cover; border-radius:4px; vertical-align:middle;" />`
    : "⌘";
  document.querySelectorAll("#brand-logo").forEach((el) => { el.innerHTML = logoHtml; });
  const preview = document.getElementById("logo-preview");
  if (preview) {
    preview.innerHTML = STORE.state.guildLogoUrl
      ? `<img src="${STORE.state.guildLogoUrl}" style="width:100%; height:100%; object-fit:cover;" />`
      : "⌘";
  }
}

function handleLogoFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > MAX_LOGO_BYTES) {
    toast("That image is too large — please use something under 150KB.", "danger");
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    STORE.state.guildLogoUrl = reader.result;
    STORE.save();
    ACTIVITY.log("updated the guild logo");
    renderBrand();
    toast("Logo updated.", "success");
    e.target.value = "";
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  STORE.state.guildLogoUrl = null;
  STORE.save();
  ACTIVITY.log("removed the guild logo");
  renderBrand();
  toast("Logo removed — back to the default mark.", "success");
}

/* ================================================================
   Modal helpers
   ================================================================ */
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}

/* ================================================================
   Master render
   ================================================================ */
function renderAll() {
  const brand = document.getElementById("brand-guild-name");
  if (brand) brand.textContent = STORE.state.guildName;
  document.title = STORE.state.guildName + " — NightShiftPH Planner";
  renderBrand();
  renderStats();
  renderInventory();
  renderGroups();
  renderTeamBuilder();
  renderRosterPool();
  renderEvents();
  renderQueue();
  if (!IS_PUBLIC) renderAdmin();
}

/* ================================================================
   Init
   ================================================================ */
/* ---------------- Auth helpers ---------------- */
function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "flex";
}
function friendlyAuthError(err) {
  const map = {
    "auth/user-not-found": "No account with that email. Try \"Create account\" if you're new.",
    "auth/wrong-password": "Wrong password.",
    "auth/invalid-email": "That doesn't look like a valid email.",
    "auth/email-already-in-use": "An account with that email already exists — try signing in instead.",
    "auth/weak-password": "Password needs to be at least 6 characters.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts — wait a bit and try again.",
  };
  return map[err.code] || err.message;
}
function handleSignIn() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email || !password) { showAuthError("Enter both email and password."); return; }
  auth.signInWithEmailAndPassword(email, password).catch((err) => showAuthError(friendlyAuthError(err)));
}
function handleSignUp() {
  const email = document.getElementById("auth-email").value.trim().toLowerCase();
  const password = document.getElementById("auth-password").value;
  if (!email || !password) { showAuthError("Enter both email and password."); return; }
  if (password.length < 6) { showAuthError("Password needs to be at least 6 characters."); return; }
  if (!STAFF.ready) { showAuthError("Still connecting — wait a moment and try again."); return; }
  if (!STAFF.find(email)) {
    showAuthError("This email hasn't been approved yet. Ask your Guild Leader to add you under Admin → Staff first, then come back and create your account.");
    return;
  }
  auth.createUserWithEmailAndPassword(email, password).catch((err) => showAuthError(friendlyAuthError(err)));
}

/* ---------------- Theme ----------------
   Public: self-service, stored in localStorage (per browser/device) —
   purely a personal display preference, not shared guild data.
   Admin: NOT self-service anymore — the Guild Leader assigns each
   staff member's theme individually via Developer Tools, stored on
   their staff record in Firestore. It's applied automatically once
   their staff record is known, and re-applies live if changed while
   they're signed in — see evaluateAccess(). */
const ALLOWED_THEMES = IS_PUBLIC
  ? ["dark", "light"]
  : ["dark", "lighter-dark", "light", "pink", "cyan", "gold"];

function applyTheme(theme) {
  const safe = ALLOWED_THEMES.includes(theme) ? theme : "dark";
  document.body.dataset.theme = safe;
  if (IS_PUBLIC) {
    try { localStorage.setItem("nsph_theme_public", safe); } catch (e) {}
    const btn = document.getElementById("theme-toggle-btn");
    if (btn) btn.textContent = safe === "dark" ? "☀️" : "🌙";
  }
}

function initTheme() {
  if (!IS_PUBLIC) return; // admin theme is applied post-login from the staff record instead
  let saved = "dark";
  try { saved = localStorage.getItem("nsph_theme_public") || "dark"; } catch (e) {}
  applyTheme(saved);
  document.getElementById("theme-toggle-btn")?.addEventListener("click", () => {
    const current = document.body.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });
}

/* ================================================================
   Init
   ================================================================ */
function init() {
  initTheme();

  document.querySelectorAll(".nav-item").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view))
  );

  // Queue registration submit — present on the public inline form
  document.getElementById("queue-submit-btn")?.addEventListener("click", submitQueueEntry);

  if (IS_PUBLIC) {
    STORE.load(() => {
      document.getElementById("loading-screen").style.display = "none";
      document.getElementById("app-shell").style.display = "";
      renderAll();
    });
    return;
  }

  document.getElementById("btn-signin")?.addEventListener("click", handleSignIn);
  document.getElementById("btn-signup")?.addEventListener("click", handleSignUp);
  document.getElementById("btn-signout")?.addEventListener("click", () => auth.signOut());
  document.getElementById("btn-signout-pending")?.addEventListener("click", () => auth.signOut());
  document.getElementById("auth-password")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSignIn();
  });

  STORE.load(() => { storeReady = true; evaluateAccess(); });
  STAFF.listen(() => { staffReady = true; evaluateAccess(); });

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    const err = document.getElementById("auth-error");
    if (err) err.style.display = "none";
    evaluateAccess();
  });

  document.getElementById("btn-add-member")?.addEventListener("click", () => openMemberModal(null));
  document.getElementById("btn-bulk-paste")?.addEventListener("click", openBulkModal);
  document.getElementById("mf-save")?.addEventListener("click", saveMemberForm);
  document.getElementById("bulk-save")?.addEventListener("click", parseBulkPaste);
  document.getElementById("mf-class")?.addEventListener("change", (e) => {
    const roleSel = document.getElementById("mf-role");
    if (roleSel) roleSel.value = getAutoRoleForClass(e.target.value);
  });

  document.getElementById("btn-add-group")?.addEventListener("click", () => openGroupModal(null));
  document.getElementById("gf-save")?.addEventListener("click", saveGroupForm);
  document.getElementById("gf-member-search")?.addEventListener("input", renderGroupMemberChecklist);

  document.getElementById("btn-add-elite-team")?.addEventListener("click", () => createTeam("elite"));
  document.getElementById("btn-add-sub-team")?.addEventListener("click", () => createTeam("sub"));

  document.getElementById("btn-add-event")?.addEventListener("click", openEventModal);
  document.getElementById("ef-save")?.addEventListener("click", saveEventForm);
  document.getElementById("delete-event-confirm-input")?.addEventListener("input", checkDeleteEventInput);
  document.getElementById("delete-event-confirm-btn")?.addEventListener("click", confirmDeleteEvent);
  document.getElementById("att-save")?.addEventListener("click", saveAttendance);
  document.getElementById("attendance-search")?.addEventListener("input", renderAttendanceList);
  document.getElementById("attendance-auto-search")?.addEventListener("input", renderAttendanceList);

  document.getElementById("rules-save")?.addEventListener("click", saveRules);
  document.getElementById("staff-add-btn")?.addEventListener("click", addStaffMember);

  document.getElementById("logo-file-input")?.addEventListener("change", handleLogoFile);
  document.getElementById("btn-remove-logo")?.addEventListener("click", removeLogo);

  document.getElementById("btn-dev-gate")?.addEventListener("click", openDevGate);
  document.getElementById("dev-gate-submit")?.addEventListener("click", submitDevGate);
  document.getElementById("dev-gate-code")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submitDevGate(); });
  document.getElementById("dev-sample-load")?.addEventListener("click", loadDevSampleData);
  document.getElementById("dev-sample-reset-default")?.addEventListener("click", () => {
    document.getElementById("dev-sample-json").value = JSON.stringify(DEFAULT_SAMPLE_DATA, null, 2);
  });
  document.getElementById("dev-theme-apply")?.addEventListener("click", applyDevStaffTheme);
  document.getElementById("dev-reset-confirm-input")?.addEventListener("input", checkDevResetInput);
  document.getElementById("dev-reset-confirm-btn")?.addEventListener("click", confirmDevReset);

  document.getElementById("btn-queue-add")?.addEventListener("click", () => openQueueModal(null));
  document.getElementById("queue-modal-save")?.addEventListener("click", submitQueueEntry);

  document.getElementById("inv-search")?.addEventListener("input", renderInventory);
  document.getElementById("pool-search")?.addEventListener("input", renderRosterPool);

  document.querySelectorAll("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal))
  );
  document.querySelectorAll(".modal-backdrop").forEach((bd) =>
    bd.addEventListener("click", (e) => {
      if (e.target === bd) bd.classList.remove("open");
    })
  );
}

document.addEventListener("DOMContentLoaded", init);
