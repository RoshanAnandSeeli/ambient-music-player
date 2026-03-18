// ── Audio setup ──────────────────────────────────────────────
const audio = new Audio();
audio.crossOrigin = 'anonymous';
const ctx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = ctx.createAnalyser();
analyser.fftSize = 256;
const src = ctx.createMediaElementSource(audio);
src.connect(analyser);
analyser.connect(ctx.destination);
const freqData = new Uint8Array(analyser.frequencyBinCount);

// ── State ─────────────────────────────────────────────────────
let tracks = [];        // master ordered list, never reordered
let queue = [];         // active playback list (ordered or shuffled)

let current = 0;        // index into queue
let playing = false;
let shuffleOn = false, loopMode = 'none';

// ── DOM ───────────────────────────────────────────────────────
const bgBlur         = document.getElementById('bg-blur');
const artwork        = document.getElementById('artwork');
const artPlaceholder = document.getElementById('artwork-placeholder');
const artWrap        = document.getElementById('artwork-wrap');
const trackTitle     = document.getElementById('track-title');
const trackArtist    = document.getElementById('track-artist');
const timeCurrent    = document.getElementById('time-current');
const timeTotal      = document.getElementById('time-total');
const progressBar    = document.getElementById('progress-bar');
const player         = document.getElementById('player');
const btnPlay        = document.getElementById('btn-play');
const btnPrev        = document.getElementById('btn-prev');
const btnNext        = document.getElementById('btn-next');
const btnShuffle     = document.getElementById('btn-shuffle');
const btnLoop        = document.getElementById('btn-loop');
const btnQueue       = document.getElementById('btn-queue');
const btnLyrics      = document.getElementById('btn-lyrics');
const volSlider      = document.getElementById('volume');
const fileInput      = document.getElementById('file-input');
const panelQueue     = document.getElementById('panel-queue');
const panelLyrics    = document.getElementById('panel-lyrics');
const queueList      = document.getElementById('queue-list');
const lyricsDisplay  = document.getElementById('lyrics-display');
const lyricsInput    = document.getElementById('lyrics-input');
const artOverlay     = document.getElementById('art-overlay');
const artOverlayImg  = document.getElementById('art-overlay-img');
const artOverlayPh   = document.getElementById('art-overlay-placeholder');
const btnTheme       = document.getElementById('btn-theme');

// inject edit button into lyrics panel
const lyricsEditBtn = document.createElement('button');
lyricsEditBtn.id = 'lyrics-edit-btn';
lyricsEditBtn.textContent = 'Edit Lyrics';
panelLyrics.appendChild(lyricsEditBtn);

// ── Particles ─────────────────────────────────────────────────
const canvas = document.getElementById('particles');
const pc = canvas.getContext('2d');
let particles = [];

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

function spawnParticle(energy) {
  const angle = Math.random() * Math.PI * 2;
  const speed = 0.3 + energy * 2.5;
  particles.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1,
    decay: 0.004 + Math.random() * 0.006,
    size: 1 + energy * 3,
    hue: 260 + Math.random() * 60
  });
}

function drawParticles(energy) {
  pc.clearRect(0, 0, canvas.width, canvas.height);
  const spawnCount = playing ? Math.floor(energy * 12) + 1 : 0;
  for (let i = 0; i < spawnCount; i++) spawnParticle(energy);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy -= 0.012;
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    pc.save();
    pc.globalAlpha = p.life * 0.75;
    pc.shadowBlur  = 12 + energy * 20;
    pc.shadowColor = `hsl(${p.hue},90%,70%)`;
    pc.fillStyle   = `hsl(${p.hue},80%,75%)`;
    pc.beginPath();
    pc.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    pc.fill();
    pc.restore();
  }
}

// ── Custom cursor ────────────────────────────────────────────
const cursorEl = document.getElementById('cursor');
let mouseX = -100, mouseY = -100;
document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });

// ── Animation loop ────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  analyser.getByteFrequencyData(freqData);
  const avg = freqData.reduce((a, b) => a + b, 0) / freqData.length;
  const energy = avg / 255;

  cursorEl.style.left = mouseX + 'px';
  cursorEl.style.top  = mouseY + 'px';
  const cursorScale = 1 + energy * 1.2;
  const cursorGlow  = 8 + energy * 24;
  cursorEl.style.transform = `translate(-50%, -50%) scale(${cursorScale})`;
  cursorEl.style.boxShadow = `0 0 ${cursorGlow}px ${cursorGlow/3}px var(--glow), 0 0 ${cursorGlow*2}px ${cursorGlow/2}px rgba(167,139,250,0.35)`;

  const scale = 1 + energy * 0.12;
  artWrap.style.transform = `scale(${scale})`;
  artWrap.style.boxShadow = `0 0 ${40 + energy * 120}px rgba(167,139,250,${0.2 + energy * 0.7}), 0 8px 32px rgba(0,0,0,0.5)`;

  drawParticles(energy);
}
loop();

// ── Helpers ───────────────────────────────────────────────────
function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function setArtwork(url) {
  if (url) {
    artwork.src = url;
    artwork.style.display = 'block';
    artPlaceholder.style.display = 'none';
    bgBlur.style.backgroundImage = `url(${url})`;
  } else {
    artwork.style.display = 'none';
    artPlaceholder.style.display = 'flex';
    bgBlur.style.backgroundImage = 'none';
  }
}

function buildShuffleQueue() {
  const currentTrack = queue[current];
  const rest = tracks.filter(t => t !== currentTrack);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  queue = [currentTrack, ...rest];
  current = 0;
}

function loadTrack(index) {
  const t = queue[index];
  current = index;
  audio.src = t.url;
  trackTitle.textContent  = t.title  || t.file.name;
  trackArtist.textContent = t.artist || '—';
  setArtwork(t.artwork || null);
  progressBar.value = 0;
  timeCurrent.textContent = '0:00';
  timeTotal.textContent   = '0:00';
  lyricsDisplay.textContent = t.lyrics || '';
  lyricsInput.value = t.lyrics || '';
  renderQueue();
}

function togglePlay() {
  if (ctx.state === 'suspended') ctx.resume();
  if (playing) {
    audio.pause();
    playing = false;
    btnPlay.innerHTML = '<span class="play-icon">&#9654;</span>';
    player.classList.remove('playing');
  } else {
    audio.play();
    playing = true;
    btnPlay.innerHTML = '<span class="pause-bar"></span><span class="pause-bar"></span>';
    player.classList.add('playing');
  }
}

function nextTrack() {
  if (!queue.length) return;
  if (loopMode === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (loopMode === 'none' && current === queue.length - 1) return;
  if (shuffleOn && current === queue.length - 1) {
    buildShuffleQueue(); // reshuffle for next cycle
  } else {
    current = (current + 1) % queue.length;
  }
  loadTrack(current);
  audio.play();
}

// ── Queue panel ───────────────────────────────────────────────
function renderQueue() {
  queueList.innerHTML = '';
  queue.forEach((t, i) => {
    const li = document.createElement('li');
    if (i === current) li.classList.add('active');

    const thumb = document.createElement('div');
    thumb.className = 'q-thumb';
    if (t.artwork) {
      const img = document.createElement('img');
      img.src = t.artwork;
      thumb.appendChild(img);
    } else {
      thumb.textContent = '♪';
    }

    const num = document.createElement('span');
    num.className = 'q-num';
    num.textContent = i + 1;

    const info = document.createElement('div');
    info.className = 'q-info';
    info.innerHTML = `<div class="q-title">${t.title || t.file.name}</div><div class="q-artist">${t.artist || '—'}</div>`;

    li.append(thumb, num, info);
    li.addEventListener('click', () => {
      loadTrack(i);
      if (playing) audio.play();
    });
    queueList.appendChild(li);
  });
  const active = queueList.querySelector('.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function togglePanel(panel, btn) {
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  btn.classList.toggle('active', !isOpen);
}

// ── Shuffle / Loop ────────────────────────────────────────────
btnShuffle.addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  btnShuffle.classList.toggle('active', shuffleOn);
  if (shuffleOn) {
    buildShuffleQueue();
  } else {
    // restore ordered queue, find current track's position in it
    const currentTrack = queue[current];
    queue = [...tracks];
    current = queue.indexOf(currentTrack);
  }
  renderQueue();
});

btnLoop.addEventListener('click', () => {
  if (loopMode === 'none')      { loopMode = 'all'; btnLoop.classList.add('active'); btnLoop.title = 'Loop All'; }
  else if (loopMode === 'all')  { loopMode = 'one'; btnLoop.textContent = '①'; btnLoop.title = 'Loop One'; }
  else                          { loopMode = 'none'; btnLoop.innerHTML = '&#x21BA;'; btnLoop.classList.remove('active'); btnLoop.title = 'Loop'; }
});

btnQueue.addEventListener('click', () => togglePanel(panelQueue, btnQueue));
btnLyrics.addEventListener('click', () => togglePanel(panelLyrics, btnLyrics));

document.querySelectorAll('.panel-close').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.panel);
    target.classList.remove('open');
    if (btn.dataset.panel === 'panel-queue') btnQueue.classList.remove('active');
    if (btn.dataset.panel === 'panel-lyrics') btnLyrics.classList.remove('active');
  });
});

// ── Theme toggle ─────────────────────────────────────────────
btnTheme.addEventListener('click', () => {
  document.body.classList.toggle('light');
  const isLight = document.body.classList.contains('light');
  btnTheme.innerHTML = isLight ? '&#9790;' : '&#9728;';
  btnTheme.title = isLight ? 'Dark mode' : 'Light mode';
});

// ── Artwork fullscreen ────────────────────────────────────────
artWrap.addEventListener('click', () => {
  const hasArt = artwork.style.display !== 'none';
  artOverlayImg.style.display = hasArt ? 'block' : 'none';
  artOverlayPh.style.display  = hasArt ? 'none'  : 'block';
  if (hasArt) artOverlayImg.src = artwork.src;
  artOverlay.classList.add('open');
});
artOverlay.addEventListener('click', () => {
  artOverlay.classList.remove('open');
});

// ── Lyrics edit ───────────────────────────────────────────────
let editingLyrics = false;
lyricsEditBtn.addEventListener('click', () => {
  editingLyrics = !editingLyrics;
  if (editingLyrics) {
    lyricsDisplay.style.display = 'none';
    lyricsInput.style.display = 'block';
    lyricsInput.focus();
    lyricsEditBtn.textContent = 'Save';
  } else {
    const text = lyricsInput.value;
    lyricsDisplay.textContent = text;
    lyricsDisplay.style.display = '';
    lyricsInput.style.display = 'none';
    lyricsEditBtn.textContent = 'Edit Lyrics';
    if (tracks[current]) tracks[current].lyrics = text;
  }
});

// ── Mobile tap ripple ─────────────────────────────────────────
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  const el = document.createElement('div');
  el.className = 'tap-ripple';
  el.style.left = t.clientX + 'px';
  el.style.top  = t.clientY + 'px';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}, { passive: true });

// ── Tag reading ───────────────────────────────────────────────
function readTags(file, cb) {
  if (!window.jsmediatags) { cb({}); return; }
  jsmediatags.read(file, {
    onSuccess({ tags }) {
      const info = { title: tags.title, artist: tags.artist };
      if (tags.picture) {
        const { data, format } = tags.picture;
        const blob = new Blob([new Uint8Array(data)], { type: format });
        info.artwork = URL.createObjectURL(blob);
      }
      cb(info);
    },
    onError() { cb({}); }
  });
}

// ── File input ────────────────────────────────────────────────
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files].filter(f => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(f.name));
  if (!files.length) return;
  let loaded = 0;
  files.forEach(file => {
    readTags(file, info => {
      const track = { file, url: URL.createObjectURL(file), lyrics: '', ...info };
      tracks.push(track);
      if (shuffleOn) {
        queue.push(track); // append new track at end of shuffled queue
      } else {
        queue = [...tracks];
      }
      loaded++;
      if (loaded === files.length) {
        if (tracks.length === files.length) {
          queue = [...tracks];
          current = 0;
          loadTrack(current);
        } else {
          renderQueue();
        }
      }
    });
  });
});

// ── Controls ──────────────────────────────────────────────────
btnPlay.addEventListener('click', togglePlay);

btnPrev.addEventListener('click', () => {
  if (!queue.length) return;
  current = Math.max(0, current - 1);
  loadTrack(current);
  if (playing) audio.play();
});

btnNext.addEventListener('click', () => {
  if (!queue.length) return;
  if (shuffleOn && current === queue.length - 1) {
    buildShuffleQueue();
  } else {
    current = (current + 1) % queue.length;
  }
  loadTrack(current);
  if (playing) audio.play();
});

audio.addEventListener('ended', nextTrack);

// ── Progress ──────────────────────────────────────────────────
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  progressBar.value = (audio.currentTime / audio.duration) * 1000;
  timeCurrent.textContent = fmt(audio.currentTime);
  timeTotal.textContent   = fmt(audio.duration);
});

progressBar.addEventListener('input', () => {
  if (!audio.duration) return;
  audio.currentTime = (progressBar.value / 1000) * audio.duration;
});

// ── Volume ────────────────────────────────────────────────────
audio.volume = volSlider.value;
volSlider.addEventListener('input', () => { audio.volume = volSlider.value; });
