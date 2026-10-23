/* ========================================
   BLOOM — App Core
   Firebase Auth + Firestore cloud sync
   ======================================== */

const App = (() => {
  // ===== FIREBASE CONFIG =====
  // Replace with your Firebase project config
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBzf6_cEY2o1qoiyS2LNdRzC-ai5XOkg6Q",
    authDomain: "bloom-d9be0.firebaseapp.com",
    projectId: "bloom-d9be0",
    storageBucket: "bloom-d9be0.firebasestorage.app",
    messagingSenderId: "385882000253",
    appId: "1:385882000253:web:e64fa93aceb89c75c31a14"
  };

  const STORAGE_KEY = 'bloom_garden';
  const WATER_TYPES = {
    call: { icon: '📞', label: 'Called' },
    text: { icon: '💬', label: 'Messaged' },
    visit: { icon: '🤗', label: 'Met up' },
    gift: { icon: '🎁', label: 'Sent something' },
    thought: { icon: '💭', label: 'Thought of them' }
  };

  const PLANT_TYPES = {
    sunflower: { name: 'Sunflower', relation: 'Family' },
    rose: { name: 'Rose', relation: 'Partner' },
    fern: { name: 'Fern', relation: 'Friend' },
    cactus: { name: 'Cactus', relation: 'Colleague' }
  };

  const MOODS = [
    { min: 80, icon: '☀️', text: 'Your garden is thriving!' },
    { min: 60, icon: '🌤', text: 'A gentle day in your garden' },
    { min: 40, icon: '🌥', text: 'Some plants could use attention' },
    { min: 20, icon: '🌧', text: 'Your garden needs some love' },
    { min: 0, icon: '🥀', text: 'Your plants are calling for you' }
  ];

  let plants = [];
  let currentPlantId = null;
  let selectedRelation = null;
  let selectedCadence = 7;
  let currentUser = null;
  let db = null;
  let auth = null;
  let unsubscribePlants = null;
  let useCloud = false;

  // ===== FIREBASE INIT =====
  function initFirebase() {
    if (!FIREBASE_CONFIG.apiKey || typeof firebase === 'undefined') return false;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      return true;
    } catch { return false; }
  }

  // ===== AUTH =====
  function showAuthError(msg) {
    let el = document.getElementById('authError');
    if (!el) {
      el = document.createElement('div');
      el.id = 'authError';
      el.style.cssText = 'color:#c62828;background:#fce4ec;padding:12px 16px;margin:12px 24px;border-radius:12px;font-size:13px;text-align:center;word-break:break-word;';
      const btn = document.querySelector('.btn-google');
      if (btn) btn.parentNode.insertBefore(el, btn.nextSibling);
    }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function setupAuth() {
    auth.getRedirectResult().then(result => {
      if (result.user) console.log('Redirect sign-in success');
    }).catch(err => {
      console.error('Redirect error:', err.code, err.message);
      if (err.code) showAuthError('Sign-in failed: ' + err.code + ' — ' + err.message);
    });
    auth.onAuthStateChanged(user => {
      if (user) {
        currentUser = user;
        updateProfileUI(user);
        subscribeToPlants();
        showApp();
      } else {
        currentUser = null;
        if (unsubscribePlants) { unsubscribePlants(); unsubscribePlants = null; }
        plants = [];
        showLogin();
      }
    });
  }

  function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(result => {
      console.log('Popup sign-in success');
    }).catch(err => {
      console.warn('Popup failed:', err.code, '- trying redirect');
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        auth.signInWithRedirect(provider);
      } else {
        showAuthError(err.code + ': ' + err.message);
      }
    });
  }

  function emailSignIn() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPassword').value;
    if (!email || !pass) { showAuthError('Please enter email and password'); return; }
    auth.signInWithEmailAndPassword(email, pass).then(() => {
      console.log('Email sign-in success');
    }).catch(err => {
      if (err.code === 'auth/user-not-found') {
        auth.createUserWithEmailAndPassword(email, pass).then(() => {
          console.log('Account created & signed in');
        }).catch(e => showAuthError(e.code + ': ' + e.message));
      } else {
        showAuthError(err.code + ': ' + err.message);
      }
    });
  }

  function signOutUser() {
    auth.signOut();
  }

  function updateProfileUI(user) {
    const avatar = document.getElementById('profileAvatar');
    const initial = document.getElementById('profileInitial');
    const dAvatar = document.getElementById('dropdownAvatar');
    const dName = document.getElementById('dropdownName');
    const dEmail = document.getElementById('dropdownEmail');

    if (user.photoURL) {
      avatar.src = user.photoURL;
      avatar.classList.add('loaded');
      dAvatar.src = user.photoURL;
    } else {
      avatar.classList.remove('loaded');
      initial.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
    }
    dName.textContent = user.displayName || 'Gardener';
    dEmail.textContent = user.email || '';
  }

  function showLogin() {
    if (!document.getElementById('onboarding').classList.contains('hidden')) return;
    showLanding();
  }

  function showApp() {
    hideLanding();
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('app-hidden');
    document.getElementById('skyGradient').style.display = '';
    document.getElementById('particlesCanvas').style.display = '';
    document.getElementById('profileDropdown').classList.add('hidden');
    renderGarden();
  }

  // ===== CLOUD DATA =====
  function plantsRef() {
    return db.collection('users').doc(currentUser.uid).collection('plants');
  }

  function subscribeToPlants() {
    if (unsubscribePlants) unsubscribePlants();
    unsubscribePlants = plantsRef().orderBy('plantedAt').onSnapshot(snap => {
      plants = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      saveLocal();
      renderGarden();
      if (currentPlantId) {
        const still = plants.find(p => p.id === currentPlantId);
        if (still) showPlantDetail(currentPlantId);
      }
    }, () => {
      loadLocal();
      renderGarden();
    });
  }

  // ===== LOCAL DATA (cache + fallback) =====
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      plants = raw ? JSON.parse(raw) : [];
    } catch { plants = []; }
  }

  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plants)); } catch {}
  }

  // ===== PLANT OPERATIONS =====
  function addPlant(name, type, cadenceDays) {
    const id = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const plant = {
      id, name, type, cadenceDays,
      plantedAt: new Date().toISOString(),
      lastWatered: new Date().toISOString(),
      waters: [],
      seed: Math.random()
    };
    if (useCloud && currentUser) {
      plantsRef().doc(id).set(plant);
    } else {
      plants.push(plant);
      saveLocal();
    }
    return plant;
  }

  function waterPlant(id, type) {
    const entry = { type, date: new Date().toISOString() };
    if (useCloud && currentUser) {
      const plant = plants.find(p => p.id === id);
      if (!plant) return;
      const updatedWaters = [entry, ...plant.waters];
      plantsRef().doc(id).update({
        lastWatered: entry.date,
        waters: updatedWaters
      });
    } else {
      const plant = plants.find(p => p.id === id);
      if (!plant) return;
      plant.waters.unshift(entry);
      plant.lastWatered = entry.date;
      saveLocal();
    }
  }

  function getHealth(plant) {
    const now = Date.now();
    const last = new Date(plant.lastWatered).getTime();
    const elapsed = (now - last) / (1000 * 60 * 60 * 24);
    const ratio = elapsed / plant.cadenceDays;
    if (ratio <= 0.5) return 100;
    if (ratio <= 1) return Math.round(100 - (ratio - 0.5) * 40);
    if (ratio <= 2) return Math.round(80 - (ratio - 1) * 40);
    if (ratio <= 4) return Math.round(40 - (ratio - 2) * 15);
    return Math.max(5, Math.round(10 - (ratio - 4) * 2));
  }

  function getStage(health) {
    if (health >= 80) return 'blooming';
    if (health >= 50) return 'growing';
    if (health >= 25) return 'sprout';
    return 'wilting';
  }

  function getStatusLabel(health) {
    if (health >= 80) return { text: 'Thriving', cls: 'thriving' };
    if (health >= 50) return { text: 'Growing', cls: 'okay' };
    if (health >= 25) return { text: 'Needs water', cls: 'wilting' };
    return { text: 'Wilting!', cls: 'wilting' };
  }

  function getGardenMood() {
    if (plants.length === 0) return MOODS[1];
    const avg = plants.reduce((s, p) => s + getHealth(p), 0) / plants.length;
    return MOODS.find(m => avg >= m.min) || MOODS[4];
  }

  // ===== SVG PLANT GENERATOR =====
  function generatePlantSVG(plant, size = 'small') {
    const health = getHealth(plant);
    const stage = getStage(health);
    const s = plant.seed;
    const isLarge = size === 'large';
    const w = isLarge ? 200 : 140;
    const h = isLarge ? 200 : 130;

    const hueShift = health < 40 ? `saturate(${0.3 + health * 0.015}) brightness(${0.85 + health * 0.003})` : '';
    const swayClass = health > 50 ? (health > 75 ? 'plant-sway' : 'plant-sway-slow') : (health < 30 ? 'plant-droop' : '');

    let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" class="${swayClass}" style="filter:${hueShift}">`;

    const cx = w / 2;
    const groundY = h - (isLarge ? 30 : 20);
    const potW = isLarge ? 50 : 36;
    const potH = isLarge ? 40 : 28;

    svg += `<path d="M${cx - potW / 2} ${groundY - potH}
      Q${cx - potW / 2 - 2} ${groundY - potH} ${cx - potW / 2 + 3} ${groundY}
      L${cx + potW / 2 - 3} ${groundY}
      Q${cx + potW / 2 + 2} ${groundY - potH} ${cx + potW / 2} ${groundY - potH} Z"
      fill="#D4C4A8"/>`;
    svg += `<rect x="${cx - potW / 2 - 2}" y="${groundY - potH - 4}" width="${potW + 4}" height="${isLarge ? 8 : 6}" rx="3" fill="#C4B498"/>`;
    svg += `<ellipse cx="${cx}" cy="${groundY - potH + 2}" rx="${potW / 2 - 4}" ry="${isLarge ? 5 : 3}" fill="#8B6F47" opacity="0.6"/>`;

    const stemBase = groundY - potH - 2;
    const generators = { sunflower: drawSunflower, rose: drawRose, fern: drawFern, cactus: drawCactus };
    const gen = generators[plant.type] || drawFern;
    svg += gen(cx, stemBase, stage, health, s, isLarge);

    svg += '</svg>';
    return svg;
  }

  function drawSunflower(cx, base, stage, health, seed, large) {
    let svg = '';
    const stemH = stage === 'wilting' ? (large ? 55 : 35) : stage === 'sprout' ? (large ? 40 : 25) : (large ? 80 : 55);
    const top = base - stemH;
    const lean = stage === 'wilting' ? 8 : 0;
    const stemW = large ? 5 : 3;
    svg += `<path d="M${cx} ${base} Q${cx + lean * 0.5} ${base - stemH * 0.5} ${cx + lean} ${top}" stroke="#6B9B37" stroke-width="${stemW}" fill="none" stroke-linecap="round"/>`;
    if (stage !== 'sprout') {
      const ly1 = base - stemH * 0.35;
      const lSize = large ? 22 : 14;
      svg += `<path d="M${cx + lean * 0.3} ${ly1} Q${cx - lSize} ${ly1 - lSize * 0.7} ${cx - lSize * 0.8} ${ly1 + 2}" fill="#7CB342" opacity="0.8"/>`;
      svg += `<path d="M${cx + lean * 0.5} ${ly1 - (large ? 20 : 12)} Q${cx + lSize + lean} ${ly1 - lSize * 0.7 - 12} ${cx + lSize * 0.7 + lean} ${ly1 - 8}" fill="#8BC34A" opacity="0.7"/>`;
    }
    if (stage === 'blooming' || stage === 'growing') {
      const fCx = cx + lean, fCy = top;
      const petalR = large ? 12 : 8;
      const petalDist = large ? 14 : 9;
      const petals = stage === 'blooming' ? 8 : 5;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2 + seed;
        const px = fCx + Math.cos(a) * petalDist;
        const py = fCy + Math.sin(a) * petalDist;
        svg += `<ellipse cx="${px}" cy="${py}" rx="${petalR * 0.7}" ry="${petalR}" transform="rotate(${(a * 180) / Math.PI + 90} ${px} ${py})" fill="#FFD93D" opacity="0.9"/>`;
      }
      svg += `<circle cx="${fCx}" cy="${fCy}" r="${large ? 10 : 7}" fill="#8B6F47"/>`;
    }
    if (stage === 'sprout') {
      svg += `<path d="M${cx} ${top} Q${cx - 8} ${top - 6} ${cx - 3} ${top + 4}" fill="#B8D4A0"/>`;
      svg += `<path d="M${cx} ${top} Q${cx + 7} ${top - 5} ${cx + 3} ${top + 4}" fill="#A0C890"/>`;
    }
    return svg;
  }

  function drawRose(cx, base, stage, health, seed, large) {
    let svg = '';
    const stemH = stage === 'wilting' ? (large ? 50 : 30) : stage === 'sprout' ? (large ? 35 : 22) : (large ? 70 : 48);
    const top = base - stemH;
    const lean = stage === 'wilting' ? 6 : 0;
    const stemW = large ? 4 : 2.5;
    svg += `<path d="M${cx} ${base} Q${cx + lean * 0.3} ${base - stemH * 0.5} ${cx + lean} ${top}" stroke="#558B2F" stroke-width="${stemW}" fill="none" stroke-linecap="round"/>`;
    if (stage !== 'sprout') {
      const ly = base - stemH * 0.4, ls = large ? 16 : 10;
      svg += `<path d="M${cx} ${ly} Q${cx - ls} ${ly - ls * 0.6} ${cx - ls * 0.5} ${ly + 3}" fill="#6B9B37" opacity="0.7"/>`;
      svg += `<path d="M${cx + lean * 0.4} ${ly - (large ? 15 : 10)} Q${cx + ls + lean} ${ly - ls * 0.5 - 10} ${cx + ls * 0.4 + lean} ${ly - 6}" fill="#7CB342" opacity="0.6"/>`;
    }
    if (stage === 'blooming') {
      const rCx = cx + lean, rCy = top;
      const layers = 3, colors = ['#E8A0BF', '#D4789B', '#C05882'];
      for (let l = layers - 1; l >= 0; l--) {
        const r = (large ? 14 : 9) - l * (large ? 3 : 2);
        const petals = 5 + l;
        for (let i = 0; i < petals; i++) {
          const a = (i / petals) * Math.PI * 2 + seed + l * 0.3;
          const px = rCx + Math.cos(a) * r * 0.5, py = rCy + Math.sin(a) * r * 0.5;
          svg += `<ellipse cx="${px}" cy="${py}" rx="${r * 0.6}" ry="${r * 0.8}" transform="rotate(${(a * 180) / Math.PI} ${px} ${py})" fill="${colors[l]}" opacity="0.85"/>`;
        }
      }
    } else if (stage === 'growing') {
      svg += `<circle cx="${cx + lean}" cy="${top}" r="${large ? 8 : 5}" fill="#E8A0BF"/>`;
      svg += `<circle cx="${cx + lean}" cy="${top}" r="${large ? 5 : 3}" fill="#D4789B"/>`;
    } else if (stage === 'sprout') {
      svg += `<path d="M${cx} ${top} Q${cx - 6} ${top - 5} ${cx - 2} ${top + 3}" fill="#B8D4A0"/>`;
      svg += `<path d="M${cx} ${top} Q${cx + 5} ${top - 4} ${cx + 2} ${top + 3}" fill="#A0C890"/>`;
    }
    return svg;
  }

  function drawFern(cx, base, stage, health, seed, large) {
    let svg = '';
    const stemH = stage === 'wilting' ? (large ? 45 : 28) : stage === 'sprout' ? (large ? 30 : 18) : (large ? 65 : 42);
    const top = base - stemH;
    const lean = stage === 'wilting' ? 5 : 0;
    const stemW = large ? 3.5 : 2.5;
    svg += `<path d="M${cx} ${base} C${cx} ${base - stemH * 0.3} ${cx + lean * 0.5} ${base - stemH * 0.7} ${cx + lean} ${top}" stroke="#558B2F" stroke-width="${stemW}" fill="none" stroke-linecap="round"/>`;
    if (stage !== 'sprout') {
      const fronds = stage === 'blooming' ? 6 : 4;
      for (let i = 0; i < fronds; i++) {
        const t = 0.25 + (i / fronds) * 0.65;
        const fy = base - stemH * t, fx = cx + lean * t;
        const side = i % 2 === 0 ? -1 : 1;
        const fLen = (large ? 28 : 18) * (1 - t * 0.4);
        const curl = (seed * 10 + i) % 3 > 1 ? -3 : 3;
        svg += `<path d="M${fx} ${fy} Q${fx + side * fLen * 0.7} ${fy - fLen * 0.3 + curl} ${fx + side * fLen} ${fy - fLen * 0.1}" stroke="#7CB342" stroke-width="${large ? 2.5 : 1.8}" fill="none" stroke-linecap="round" opacity="0.8"/>`;
        const leaflets = 3;
        for (let j = 1; j <= leaflets; j++) {
          const lt = j / (leaflets + 1);
          const lx = fx + side * fLen * lt * 0.7, ly = fy - fLen * 0.3 * lt + curl * lt;
          const ll = (large ? 8 : 5) * (1 - lt * 0.3);
          svg += `<path d="M${lx} ${ly} Q${lx + side * ll * 0.3} ${ly - ll} ${lx + side * ll} ${ly - ll * 0.5}" fill="#8BC34A" opacity="0.6"/>`;
        }
      }
    }
    if (stage === 'sprout') {
      svg += `<path d="M${cx} ${top} Q${cx - 8} ${top - 8} ${cx - 2} ${top + 2}" fill="#B8D4A0"/>`;
      svg += `<path d="M${cx} ${top + 2} Q${cx + 7} ${top - 6} ${cx + 2} ${top + 3}" fill="#9CAF88"/>`;
    }
    if (stage === 'blooming') {
      svg += `<circle cx="${cx + lean}" cy="${top - 3}" r="${large ? 4 : 2.5}" fill="#C5A3CF" opacity="0.7"/>`;
      svg += `<circle cx="${cx + lean - 6}" cy="${top + 5}" r="${large ? 3 : 2}" fill="#C5A3CF" opacity="0.5"/>`;
    }
    return svg;
  }

  function drawCactus(cx, base, stage, health, seed, large) {
    let svg = '';
    const bodyH = stage === 'sprout' ? (large ? 30 : 18) : (large ? 55 : 38);
    const bodyW = large ? 22 : 15;
    const top = base - bodyH;
    svg += `<rect x="${cx - bodyW / 2}" y="${top}" width="${bodyW}" height="${bodyH}" rx="${bodyW / 2}" fill="#6B9B37"/>`;
    svg += `<rect x="${cx - bodyW / 2 + 3}" y="${top + 3}" width="${2}" height="${bodyH - 6}" rx="1" fill="#558B2F" opacity="0.3"/>`;
    svg += `<rect x="${cx + bodyW / 2 - 5}" y="${top + 3}" width="${2}" height="${bodyH - 6}" rx="1" fill="#558B2F" opacity="0.3"/>`;
    if (stage !== 'sprout') {
      const armY = top + bodyH * 0.35, armW = large ? 12 : 8, armH = large ? 25 : 16;
      svg += `<rect x="${cx - bodyW / 2 - armW}" y="${armY}" width="${armW}" height="${armH}" rx="${armW / 2}" fill="#7CB342"/>`;
      svg += `<rect x="${cx - bodyW / 2 - armW}" y="${armY - armH * 0.4}" width="${armW}" height="${armH * 0.5}" rx="${armW / 2}" fill="#7CB342"/>`;
      if (stage === 'blooming') {
        const armY2 = top + bodyH * 0.5;
        svg += `<rect x="${cx + bodyW / 2}" y="${armY2}" width="${armW}" height="${armH * 0.8}" rx="${armW / 2}" fill="#7CB342"/>`;
      }
    }
    if (stage === 'blooming') {
      svg += `<circle cx="${cx}" cy="${top - 3}" r="${large ? 6 : 4}" fill="#F4845F"/>`;
      svg += `<circle cx="${cx}" cy="${top - 3}" r="${large ? 3 : 2}" fill="#FFD93D"/>`;
    }
    if (stage !== 'sprout') {
      const spines = large ? 5 : 3;
      for (let i = 0; i < spines; i++) {
        const sy = top + bodyH * (0.2 + i * 0.2);
        svg += `<line x1="${cx - bodyW / 2}" y1="${sy}" x2="${cx - bodyW / 2 - 3}" y2="${sy - 2}" stroke="#558B2F" stroke-width="1" opacity="0.4"/>`;
        svg += `<line x1="${cx + bodyW / 2}" y1="${sy + 3}" x2="${cx + bodyW / 2 + 3}" y2="${sy + 1}" stroke="#558B2F" stroke-width="1" opacity="0.4"/>`;
      }
    }
    return svg;
  }

  function generateSeedSVG(type) {
    const w = 120, h = 120;
    let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">`;
    const cx = w / 2, groundY = 90;
    svg += `<ellipse cx="${cx}" cy="${groundY + 5}" rx="35" ry="10" fill="#E8DFD0" opacity="0.5"/>`;
    svg += `<path d="M${cx - 18} ${groundY - 20} Q${cx - 20} ${groundY - 20} ${cx - 16} ${groundY} L${cx + 16} ${groundY} Q${cx + 20} ${groundY - 20} ${cx + 18} ${groundY - 20} Z" fill="#D4C4A8"/>`;
    svg += `<rect x="${cx - 20}" y="${groundY - 24}" width="40" height="6" rx="3" fill="#C4B498"/>`;
    svg += `<ellipse cx="${cx}" cy="${groundY - 18}" rx="12" ry="4" fill="#8B6F47" opacity="0.5"/>`;
    const colors = { sunflower: '#FFD93D', rose: '#E8A0BF', fern: '#B8D4A0', cactus: '#6B9B37' };
    const c = colors[type] || '#B8D4A0';
    svg += `<ellipse cx="${cx}" cy="${groundY - 20}" rx="6" ry="5" fill="${c}" opacity="0.8"><animate attributeName="ry" values="5;6;5" dur="2s" repeatCount="indefinite"/></ellipse>`;
    svg += `<path d="M${cx} ${groundY - 25} Q${cx - 5} ${groundY - 35} ${cx - 2} ${groundY - 22}" fill="${c}" opacity="0.5"/>`;
    svg += `<path d="M${cx} ${groundY - 25} Q${cx + 4} ${groundY - 33} ${cx + 2} ${groundY - 22}" fill="${c}" opacity="0.4"/>`;
    svg += '</svg>';
    return svg;
  }

  // ===== RENDERING =====
  function renderGarden() {
    const grid = document.getElementById('gardenGrid');
    const empty = document.getElementById('emptyGarden');
    const reminder = document.getElementById('waterReminder');
    const mood = document.getElementById('gardenMood');

    if (plants.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      reminder.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');

    const m = getGardenMood();
    mood.querySelector('.mood-icon').textContent = m.icon;
    mood.querySelector('.mood-text').textContent = m.text;

    let needsWater = 0;
    let html = '';
    plants.forEach((plant, i) => {
      const health = getHealth(plant);
      const status = getStatusLabel(health);
      const needsW = health < 50;
      if (needsW) needsWater++;
      html += `
        <div class="plant-card appear ${needsW ? 'needs-water' : ''}" data-id="${plant.id}" style="animation-delay: ${i * 0.08}s">
          <div class="plant-svg-container">${generatePlantSVG(plant, 'small')}</div>
          <div class="plant-card-name">${escapeHtml(plant.name)}</div>
          <div class="plant-card-status"><span class="status-dot ${status.cls}"></span>${status.text}</div>
        </div>`;
    });
    grid.innerHTML = html;

    if (needsWater > 0) {
      reminder.classList.remove('hidden');
      document.getElementById('reminderCount').textContent = needsWater;
    } else {
      reminder.classList.add('hidden');
    }

    grid.querySelectorAll('.plant-card').forEach(card => {
      card.addEventListener('click', () => showPlantDetail(card.dataset.id));
    });
  }

  function showPlantDetail(id) {
    const plant = plants.find(p => p.id === id);
    if (!plant) return;
    currentPlantId = id;

    const health = getHealth(plant);
    const circumference = 2 * Math.PI * 52;
    const offset = circumference * (1 - health / 100);

    document.getElementById('plantName').textContent = plant.name;
    document.getElementById('plantShowcase').innerHTML = generatePlantSVG(plant, 'large');

    const ring = document.getElementById('healthRing');
    const label = document.getElementById('healthLabel');
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = health > 60 ? '#7CB342' : health > 30 ? '#FFD93D' : '#F4845F';
    label.textContent = health + '%';
    label.style.color = health > 60 ? '#7CB342' : health > 30 ? '#FFD93D' : '#F4845F';

    document.getElementById('plantedDate').textContent = formatDate(plant.plantedAt);
    document.getElementById('lastWatered').textContent = timeAgo(plant.lastWatered);
    document.getElementById('plantCadence').textContent = `Every ${plant.cadenceDays} day${plant.cadenceDays > 1 ? 's' : ''}`;
    document.getElementById('plantRelation').textContent = PLANT_TYPES[plant.type]?.relation || plant.type;

    const historyList = document.getElementById('historyList');
    if (plant.waters.length === 0) {
      historyList.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px 0">No waters yet — give them some love!</p>';
    } else {
      historyList.innerHTML = plant.waters.slice(0, 10).map(w => {
        const wt = WATER_TYPES[w.type] || { icon: '💧', label: w.type };
        return `<div class="history-item"><div class="history-type-icon">${wt.icon}</div><div class="history-info"><div class="history-type">${wt.label}</div><div class="history-date">${formatDate(w.date)}</div></div></div>`;
      }).join('');
    }
    navigateTo('plantScreen');
  }

  function showWaterSheet() {
    const plant = plants.find(p => p.id === currentPlantId);
    if (!plant) return;
    document.getElementById('sheetPersonName').textContent = `to ${plant.name}`;
    document.getElementById('waterSheet').classList.remove('hidden');
  }

  function hideWaterSheet() {
    document.getElementById('waterSheet').classList.add('hidden');
  }

  function enhancedDoWater(type) {
    if (!currentPlantId) return;
    waterPlant(currentPlantId, type);
    hideWaterSheet();
    haptic('heavy');
    playWaterAnimation();
    setTimeout(() => {
      showConfetti();
      const plant = plants.find(p => p.id === currentPlantId);
      if (plant) {
        const emojis = { call: '📞', text: '💬', visit: '🤗', gift: '🎁', thought: '💭' };
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            floatEmoji(emojis[type] || '💧',
              window.innerWidth / 2 - 20 + (Math.random() - 0.5) * 100,
              window.innerHeight * 0.3 + Math.random() * 50);
          }, i * 200);
        }
      }
    }, 800);
    setTimeout(() => {
      const showcase = document.getElementById('plantShowcase');
      if (showcase) showcase.classList.add('plant-bloom-burst');
      showPlantDetail(currentPlantId);
      setTimeout(() => { if (showcase) showcase.classList.remove('plant-bloom-burst'); }, 800);
    }, 1400);
  }

  function playWaterAnimation() {
    const overlay = document.getElementById('waterOverlay');
    const drops = document.getElementById('waterDrops');
    overlay.classList.remove('hidden');
    drops.innerHTML = '';
    for (let i = 0; i < 12; i++) {
      const drop = document.createElement('div');
      drop.className = 'water-drop';
      drop.style.left = (20 + Math.random() * 60) + '%';
      drop.style.animationDelay = (Math.random() * 0.5) + 's';
      drops.appendChild(drop);
    }
    const splash = document.createElement('div');
    splash.className = 'water-splash';
    drops.appendChild(splash);
    setTimeout(() => { overlay.classList.add('hidden'); drops.innerHTML = ''; }, 1500);
  }

  // ===== NAVIGATION =====
  function navigateTo(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    target.classList.add('active');
    target.scrollTop = 0;
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.screen === screenId);
    });
    if (screenId === 'gardenScreen') renderGarden();
  }

  // ===== ADD SEED =====
  function resetAddForm() {
    document.getElementById('personName').value = '';
    selectedRelation = null;
    selectedCadence = 7;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.cadence-opt').forEach(c => {
      c.classList.toggle('selected', Number(c.dataset.days) === 7);
    });
    document.getElementById('plantSeedBtn').disabled = true;
    document.getElementById('seedPreview').innerHTML = generateSeedSVG('fern');
  }

  function validateAddForm() {
    const name = document.getElementById('personName').value.trim();
    document.getElementById('plantSeedBtn').disabled = !(name && selectedRelation);
  }

  function doPlantSeed() {
    const name = document.getElementById('personName').value.trim();
    if (!name || !selectedRelation) return;
    const chip = document.querySelector(`.chip[data-value="${selectedRelation}"]`);
    const plantType = chip?.dataset.plant || 'fern';
    addPlant(name, plantType, selectedCadence);
    resetAddForm();
    navigateTo('gardenScreen');
  }

  // ===== HELPERS =====
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    const now = new Date();
    const days = Math.floor((now - d) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function timeAgo(iso) {
    const d = new Date(iso);
    const diff = Date.now() - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days} days ago`;
    return formatDate(iso);
  }

  // ===== PARTICLES SYSTEM =====
  function initParticles() {
    const canvas = document.getElementById('particlesCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const colors = ['#B8D4A0', '#FFD93D', '#E8A0BF', '#87CEEB', '#C5A3CF'];
    function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    function createParticle() {
      return {
        x: Math.random() * canvas.width, y: -10,
        size: 2 + Math.random() * 4,
        speedX: (Math.random() - 0.5) * 0.5, speedY: 0.3 + Math.random() * 0.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 0.3 + Math.random() * 0.4,
        rotation: Math.random() * 360, rotSpeed: (Math.random() - 0.5) * 2,
        type: Math.random() > 0.7 ? 'leaf' : 'dot'
      };
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (particles.length < 25 && Math.random() > 0.95) particles.push(createParticle());
      particles.forEach((p, i) => {
        p.x += p.speedX + Math.sin(p.y * 0.01) * 0.3;
        p.y += p.speedY;
        p.rotation += p.rotSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation * Math.PI / 180);
        ctx.globalAlpha = p.opacity;
        if (p.type === 'leaf') {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 1.5, p.size * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        if (p.y > canvas.height + 20) particles.splice(i, 1);
      });
      requestAnimationFrame(draw);
    }
    window.addEventListener('resize', resize);
    resize();
    draw();
  }

  function updateSky() {
    const sky = document.getElementById('skyGradient');
    if (!sky) return;
    const hour = new Date().getHours();
    sky.className = 'sky-gradient';
    if (hour >= 6 && hour < 10) sky.classList.add('sky-morning');
    else if (hour >= 10 && hour < 17) sky.classList.add('sky-day');
    else if (hour >= 17 && hour < 20) sky.classList.add('sky-evening');
    else sky.classList.add('sky-night');
  }

  function showConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);
    const colors = ['#FFD93D', '#E8A0BF', '#7CB342', '#5BA4CF', '#F4845F', '#C5A3CF'];
    for (let i = 0; i < 40; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti';
      piece.style.left = (30 + Math.random() * 40) + '%';
      piece.style.top = (20 + Math.random() * 20) + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDelay = (Math.random() * 0.5) + 's';
      piece.style.animationDuration = (1 + Math.random() * 1) + 's';
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.style.width = (4 + Math.random() * 8) + 'px';
      piece.style.height = (4 + Math.random() * 8) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      container.appendChild(piece);
    }
    setTimeout(() => container.remove(), 2500);
  }

  function floatEmoji(emoji, x, y) {
    const el = document.createElement('div');
    el.className = 'float-emoji';
    el.textContent = emoji;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function addRipple(e, element) {
    const rect = element.getBoundingClientRect();
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top = (e.clientY - rect.top) + 'px';
    element.style.position = 'relative';
    element.style.overflow = 'hidden';
    element.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  function haptic(style) {
    if (navigator.vibrate) {
      if (style === 'light') navigator.vibrate(10);
      else if (style === 'medium') navigator.vibrate(20);
      else navigator.vibrate([15, 30, 15]);
    }
  }

  function dismissSplash() {
    const splash = document.getElementById('splashScreen');
    if (!splash) return;
    setTimeout(() => {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 600);
    }, 1800);
  }

  // ===== ONBOARDING =====
  let obSlide = 0;
  const OB_TOTAL = 4;

  function initOnboarding() {
    const ob = document.getElementById('onboarding');
    const slides = ob.querySelectorAll('.ob-slide');
    const dots = ob.querySelectorAll('.ob-dot');
    const nextBtn = document.getElementById('obNext');
    const skipBtn = document.getElementById('obSkip');
    let startX = 0;
    let isDragging = false;

    function goToSlide(n) {
      slides.forEach((s, i) => {
        s.classList.remove('active', 'exit-left');
        if (i < n) s.classList.add('exit-left');
        else if (i === n) s.classList.add('active');
      });
      dots.forEach((d, i) => d.classList.toggle('active', i === n));
      nextBtn.textContent = n === OB_TOTAL - 1 ? 'Get Started' : 'Next';
      obSlide = n;
    }

    function finishOnboarding() {
      try { localStorage.setItem('bloom_onboarded', '1'); } catch {}
      ob.style.transition = 'opacity 0.5s, transform 0.5s';
      ob.style.opacity = '0';
      ob.style.transform = 'scale(1.05)';
      setTimeout(() => {
        ob.classList.add('hidden');
        ob.style.opacity = '';
        ob.style.transform = '';
        proceedAfterOnboarding();
      }, 500);
    }

    nextBtn.addEventListener('click', () => {
      haptic('light');
      if (obSlide < OB_TOTAL - 1) goToSlide(obSlide + 1);
      else finishOnboarding();
    });

    skipBtn.addEventListener('click', () => {
      haptic('light');
      finishOnboarding();
    });

    ob.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      isDragging = true;
    }, { passive: true });

    ob.addEventListener('touchend', (e) => {
      if (!isDragging) return;
      isDragging = false;
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) > 50) {
        if (diff > 0 && obSlide < OB_TOTAL - 1) goToSlide(obSlide + 1);
        else if (diff < 0 && obSlide > 0) goToSlide(obSlide - 1);
      }
    }, { passive: true });

    goToSlide(0);
  }

  function proceedAfterOnboarding() {
    if (useCloud) {
      if (currentUser) {
        showApp();
      } else {
        showLanding();
      }
    } else {
      loadLocal();
      document.getElementById('app').classList.remove('app-hidden');
      renderGarden();
    }
  }

  // ===== LANDING PAGE =====
  function showLanding() {
    document.body.classList.add('landing-mode');
    document.getElementById('landing').style.display = 'block';
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('app').classList.add('app-hidden');
    initLanding();
  }

  function hideLanding() {
    document.body.classList.remove('landing-mode');
    document.getElementById('landing').style.display = 'none';
  }

  function openLoginFromLanding() {
    document.getElementById('loginScreen').classList.remove('hidden');
  }

  function initLanding() {
    // Scroll reveal
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
    }, { threshold: 0.15 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // Nav scroll effect
    const nav = document.getElementById('landNav');
    window.addEventListener('scroll', () => {
      nav.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });

    // Smooth scroll for anchor links
    document.querySelectorAll('.land-link, .hero-secondary').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Counter animation
    document.querySelectorAll('.stat-num[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count);
      let current = 0;
      const step = () => {
        current++;
        el.textContent = current;
        if (current < target) requestAnimationFrame(step);
      };
      setTimeout(step, 800);
    });

    // Floating petals canvas
    initLandingPetals();
  }

  function initLandingPetals() {
    const canvas = document.getElementById('landingPetals');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let petals = [];
    const colors = ['#B8D4A0', '#FFD93D', '#F2C6D8', '#A8D8EA', '#FFDAB9'];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 20; i++) {
      petals.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 3,
        size: 3 + Math.random() * 5,
        speedY: 0.3 + Math.random() * 0.6,
        speedX: (Math.random() - 0.5) * 0.4,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        opacity: 0.15 + Math.random() * 0.25
      });
    }

    function drawPetal(p) {
      ctx.save();
      ctx.translate(p.x, p.y - window.scrollY * 0.3);
      ctx.rotate(p.rotation * Math.PI / 180);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    let landingAnimId;
    function animate() {
      if (!document.body.classList.contains('landing-mode')) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      petals.forEach(p => {
        p.y += p.speedY;
        p.x += p.speedX + Math.sin(p.y * 0.01) * 0.3;
        p.rotation += p.rotSpeed;
        if (p.y - window.scrollY * 0.3 > canvas.height + 20) {
          p.y = window.scrollY * 0.3 - 20;
          p.x = Math.random() * canvas.width;
        }
        drawPetal(p);
      });
      landingAnimId = requestAnimationFrame(animate);
    }
    animate();
  }

  // ===== INIT =====
  function init() {
    dismissSplash();
    updateSky();
    initParticles();

    useCloud = initFirebase();

    if (useCloud) {
      setupAuth();

      document.getElementById('emailSignInBtn').addEventListener('click', emailSignIn);
      document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') emailSignIn(); });
      document.getElementById('googleSignInBtn').addEventListener('click', signIn);
      document.getElementById('signOutBtn').addEventListener('click', signOutUser);

      // Landing page buttons
      document.getElementById('landLoginBtn').addEventListener('click', openLoginFromLanding);
      document.getElementById('heroCtaBtn').addEventListener('click', openLoginFromLanding);
      document.getElementById('ctaSignUpBtn').addEventListener('click', openLoginFromLanding);

      document.getElementById('profileBtn').addEventListener('click', () => {
        const dd = document.getElementById('profileDropdown');
        dd.classList.toggle('hidden');
      });

      document.addEventListener('click', (e) => {
        const dd = document.getElementById('profileDropdown');
        const btn = document.getElementById('profileBtn');
        if (!dd.contains(e.target) && !btn.contains(e.target)) {
          dd.classList.add('hidden');
        }
      });
    }

    let onboarded = false;
    try { onboarded = localStorage.getItem('bloom_onboarded') === '1'; } catch {}

    if (!onboarded) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('onboarding').classList.remove('hidden');
      initOnboarding();
    } else if (!useCloud) {
      loadLocal();
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('app').classList.remove('app-hidden');
      renderGarden();
    }

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => { haptic('light'); navigateTo(btn.dataset.screen); });
    });

    document.getElementById('plantBackBtn').addEventListener('click', () => { haptic('light'); navigateTo('gardenScreen'); });
    document.getElementById('addBackBtn').addEventListener('click', () => { haptic('light'); navigateTo('gardenScreen'); });

    document.getElementById('emptyAddBtn').addEventListener('click', (e) => {
      haptic('medium'); addRipple(e, e.currentTarget); resetAddForm(); navigateTo('addScreen');
    });
    document.getElementById('addNavBtn').addEventListener('click', () => resetAddForm());

    document.getElementById('waterBtn').addEventListener('click', () => { haptic('medium'); showWaterSheet(); });
    document.getElementById('sheetBackdrop').addEventListener('click', hideWaterSheet);

    document.querySelectorAll('.water-option').forEach(opt => {
      opt.addEventListener('click', (e) => { haptic('medium'); addRipple(e, e.currentTarget); enhancedDoWater(opt.dataset.type); });
    });

    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        haptic('light');
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedRelation = chip.dataset.value;
        document.getElementById('seedPreview').innerHTML = generateSeedSVG(chip.dataset.plant);
        validateAddForm();
      });
    });

    document.querySelectorAll('.cadence-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        haptic('light');
        document.querySelectorAll('.cadence-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedCadence = Number(opt.dataset.days);
      });
    });

    document.getElementById('personName').addEventListener('input', validateAddForm);
    document.getElementById('plantSeedBtn').addEventListener('click', (e) => { haptic('heavy'); addRipple(e, e.currentTarget); doPlantSeed(); });

    document.getElementById('waterReminder').addEventListener('click', () => {
      haptic('medium');
      const thirsty = plants.find(p => getHealth(p) < 50);
      if (thirsty) showPlantDetail(thirsty.id);
    });

    renderGarden();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
