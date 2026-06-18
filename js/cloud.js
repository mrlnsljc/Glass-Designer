/* =============================================================================
   cloud.js — optional Google sign-in + live cross-device sync (Firebase).

   The app stays LOCAL-FIRST: localStorage is the source of truth, so everything
   works offline and without an account. Signing in just mirrors your designs to
   Firestore and streams changes back in real time (last-edit-wins by updatedAt).

   • Each design is one Firestore doc at  users/{uid}/designs/{id}.
   • Designs are stored as a JSON STRING (`json`) so Firestore's no-nested-arrays
     rule never bites (panel.points is an array of [x,y] pairs).
   • The Firebase modular SDK is loaded straight from the gstatic CDN as ES
     modules — no build step, matching the rest of the app.

   app.js wires this up via initCloud(handlers); state.js calls pushDesign /
   deleteDesign through store.setCloudSync().
   ============================================================================= */

import { firebaseConfig } from './firebaseConfig.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

let fb = {};                 // merged SDK exports
let app, auth, db;
let uid = null, unsub = null;
let handlers = {};
const pushTimers = new Map(); // designId -> debounce timer

const setStatus = (s) => handlers.onStatus?.(s);

/** Load the SDK, init Firebase, and start listening for auth changes. */
export async function initCloud(h) {
  handlers = h || {};
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    fb = { ...appMod, ...authMod, ...fsMod };
    app = fb.initializeApp(firebaseConfig);
    auth = fb.getAuth(app);
    db = fb.getFirestore(app);

    fb.getRedirectResult(auth).catch(() => {}); // complete an iOS redirect sign-in
    fb.onAuthStateChanged(auth, onAuth);

    window.addEventListener('online', () => { if (uid) { setStatus('synced'); resync(); } });
    window.addEventListener('offline', () => { if (uid) setStatus('offline'); });
  } catch (e) {
    console.warn('Cloud unavailable (offline or blocked):', e);
    setStatus('signed-out');
  }
}

function onAuth(user) {
  if (user) {
    uid = user.uid;
    handlers.onUser?.({ name: user.displayName, email: user.email, photo: user.photoURL });
    setStatus('syncing');
    startSync();
  } else {
    uid = null;
    if (unsub) { unsub(); unsub = null; }
    handlers.onUser?.(null);
    setStatus('signed-out');
  }
}

// Live listener: stream remote changes in, and on the first snapshot push up any
// local designs the cloud is missing or that are newer here.
function startSync() {
  const col = fb.collection(db, `users/${uid}/designs`);
  let first = true;
  unsub = fb.onSnapshot(col, (snap) => {
    snap.docChanges().forEach((ch) => {
      const d = ch.doc.data();
      if (ch.type === 'removed') handlers.onRemoteDelete?.(d.id || ch.doc.id);
      else { try { handlers.onRemoteDesign?.(JSON.parse(d.json)); } catch (e) { /* skip bad doc */ } }
    });
    if (first) {
      first = false;
      const remote = new Map(snap.docs.map((dd) => [dd.id, dd.data().updatedAt || 0]));
      for (const p of (handlers.getLocalDesigns?.() || [])) {
        const r = remote.get(p.id);
        if (r == null || (p.updatedAt || 0) > r) pushNow(p);
      }
    }
    setStatus(navigator.onLine ? 'synced' : 'offline');
  }, (err) => { console.warn('sync error', err); setStatus('error'); });
}

/** Debounced upsert of one design (called on every local save). */
export function pushDesign(project) {
  if (!uid || !project || !project.id) return;
  setStatus('syncing');
  clearTimeout(pushTimers.get(project.id));
  pushTimers.set(project.id, setTimeout(() => pushNow(project), 800));
}

async function pushNow(project) {
  if (!uid) return;
  clearTimeout(pushTimers.get(project.id));
  try {
    await fb.setDoc(fb.doc(db, `users/${uid}/designs/${project.id}`), {
      id: project.id,
      name: project.name || '',
      updatedAt: project.updatedAt || Date.now(),
      json: JSON.stringify(project),
    });
    setStatus('synced');
  } catch (e) {
    console.warn('push failed', e);
    setStatus(navigator.onLine ? 'error' : 'offline');
  }
}

export function deleteDesign(id) {
  if (!uid || !id) return;
  fb.deleteDoc(fb.doc(db, `users/${uid}/designs/${id}`)).catch((e) => console.warn('delete failed', e));
}

function resync() { for (const p of (handlers.getLocalDesigns?.() || [])) pushNow(p); }

// ---- auth actions ----------------------------------------------------------
export async function signIn() {
  if (!auth) { alert('Cloud sync is unavailable right now (offline?).'); return; }
  const provider = new fb.GoogleAuthProvider();
  const ua = navigator.userAgent || '';
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
  // Popups are unreliable on phones/tablets (mobile Safari blocks them silently),
  // so any touch / mobile device uses the full-page redirect flow instead.
  const mobile = standalone || /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  if (mobile) {
    setStatus('syncing');
    try { await fb.signInWithRedirect(auth, provider); }
    catch (e) { console.error('redirect sign-in failed', e); setStatus('error'); alert('Sign-in failed: ' + (e.code || e.message)); }
    return;
  }
  try {
    await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      try { await fb.signInWithRedirect(auth, provider); } catch (e2) { console.error(e2); setStatus('error'); }
    } else { console.error(e); setStatus('error'); alert('Sign-in error: ' + (e.code || e.message)); }
  }
}

export function signOut() { if (auth) fb.signOut(auth).catch(() => {}); }
export function isSignedIn() { return !!uid; }
