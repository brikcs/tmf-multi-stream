(() => {
  'use strict';

  const HOST = location.hostname;
  const MAX_STREAMS = 12;
  const STORE_KEY = 'tmf-multi-stream';
  // Written every ~10 minutes by .github/workflows/discover.yml.
  const LIVE_URL = 'https://raw.githubusercontent.com/brikcs/tmf-multi-stream/live-data/live.json';
  const LIVE_REFRESH_MS = 3 * 60 * 1000;
  const GAP = 8;
  const HEAD = 38; // tile header + borders
  const isYtChannel = (id) => /^UC[\w-]{22}$/.test(id);

  const PLATFORMS = {
    twitch: {
      label: 'Twitch',
      color: '#a970ff',
      valid: (c) => /^[a-z0-9_]{2,25}$/.test(c),
      player: (c) => `https://player.twitch.tv/?channel=${c}&parent=${HOST}&muted=true&autoplay=true`,
      chat: (c) => `https://www.twitch.tv/embed/${c}/chat?parent=${HOST}&darkpopout`,
      chatPopout: (c) => `https://www.twitch.tv/popout/${c}/chat?popout=`,
      url: (c) => `https://www.twitch.tv/${c}`,
    },
    kick: {
      label: 'Kick',
      color: '#53fc18',
      valid: (c) => /^[a-z0-9_-]{2,40}$/.test(c),
      player: (c) => `https://player.kick.com/${c}?muted=true&autoplay=true`,
      chat: (c) => `https://kick.com/popout/${c}/chat`,
      chatPopout: (c) => `https://kick.com/popout/${c}/chat`,
      url: (c) => `https://kick.com/${c}`,
    },
    youtube: {
      label: 'YouTube',
      color: '#ff4e45',
      caseSensitive: true,
      valid: (c) => /^[\w-]{11}$/.test(c) || isYtChannel(c),
      player: (c) => isYtChannel(c)
        ? `https://www.youtube.com/embed/live_stream?channel=${c}&autoplay=1&mute=1`
        : `https://www.youtube.com/embed/${c}?autoplay=1&mute=1`,
      chat: (c) => isYtChannel(c) ? null : `https://www.youtube.com/live_chat?v=${c}&embed_domain=${HOST}`,
      chatPopout: (c) => isYtChannel(c) ? null : `https://www.youtube.com/live_chat?is_popout=1&v=${c}`,
      url: (c) => isYtChannel(c) ? `https://www.youtube.com/channel/${c}/live` : `https://www.youtube.com/watch?v=${c}`,
    },
  };

  const ICONS = {
    focus: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    reload: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
  };
  const icon = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const watch = $('watch');
  const chat = $('chat');
  const chatTabs = $('chat-tabs');
  const chatBody = $('chat-body');
  const input = $('add-input');
  const tiles = new Map(); // id -> element

  const state = {
    streams: [],      // [{ id, platform, channel }]
    layout: 'grid',   // 'grid' | 'focus'
    focusId: null,
    chatOpen: false,
    chatId: null,
    theater: false,
    platform: 'twitch',
  };

  /* ---------- Parsing ---------- */

  function makeStream(platform, channel) {
    const p = PLATFORMS[platform];
    if (!p) return null;
    channel = channel.trim().replace(/^@/, '');
    if (!p.caseSensitive) channel = channel.toLowerCase();
    if (!p.valid(channel)) return null;
    return { id: `${platform}:${channel}`, platform, channel };
  }

  // Returns { stream } or { error }.
  function parseEntry(raw, fallbackPlatform) {
    const text = raw.trim();
    if (!text) return {};
    const fail = (error) => ({ error });

    const prefixed = text.match(/^(twitch|kick|youtube|yt):(.+)$/i);
    if (prefixed) {
      const platform = prefixed[1].toLowerCase() === 'yt' ? 'youtube' : prefixed[1].toLowerCase();
      const stream = makeStream(platform, prefixed[2]);
      return stream ? { stream } : fail(`"${text}" is not a valid ${PLATFORMS[platform].label} channel`);
    }

    if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/|$)/i.test(text)) {
      let url;
      try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); } catch { return fail(`Could not read "${text}"`); }
      const host = url.hostname.replace(/^(www|m|player|go)\./, '');
      const parts = url.pathname.split('/').filter(Boolean);
      let stream = null;
      if (host === 'twitch.tv') {
        stream = makeStream('twitch', url.searchParams.get('channel') || (parts[0] === 'popout' ? parts[1] : parts[0]) || '');
      } else if (host === 'kick.com') {
        stream = makeStream('kick', (parts[0] === 'popout' ? parts[1] : parts[0]) || '');
      } else if (host === 'youtu.be') {
        stream = makeStream('youtube', parts[0] || '');
      } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (parts[0] && parts[0].startsWith('@')) return fail('For YouTube, paste the live video link instead of the @handle');
        const id = url.searchParams.get('v') || (['live', 'embed', 'shorts', 'channel'].includes(parts[0]) ? parts[1] : '');
        stream = makeStream('youtube', id || '');
      } else {
        return fail(`${host} is not supported — use Twitch, Kick or YouTube`);
      }
      return stream ? { stream } : fail(`Could not find a channel in "${text}"`);
    }

    const stream = makeStream(fallbackPlatform, text);
    if (stream) return { stream };
    return fail(fallbackPlatform === 'youtube'
      ? 'For YouTube, paste the live video link or its 11-character video ID'
      : `"${text}" is not a valid ${PLATFORMS[fallbackPlatform].label} channel name`);
  }

  /* ---------- State changes ---------- */

  function addFromText(text) {
    const entries = text.split(/[\s,]+/).filter(Boolean);
    let added = 0;
    const errors = [];
    for (const entry of entries) {
      const { stream, error } = parseEntry(entry, state.platform);
      if (error) { errors.push(error); continue; }
      if (!stream) continue;
      if (state.streams.some((s) => s.id === stream.id)) { errors.push(`${stream.channel} is already in the lineup`); continue; }
      if (state.streams.length >= MAX_STREAMS) { errors.push(`Lineup is full — ${MAX_STREAMS} streams max`); break; }
      state.streams.push(stream);
      added++;
    }
    if (errors.length) toast(errors[0]);
    if (added) render();
    return added > 0 && !errors.length;
  }

  function removeStream(id) {
    state.streams = state.streams.filter((s) => s.id !== id);
    render();
  }

  function setLayout(layout) {
    state.layout = layout;
    render();
  }

  function focusStream(id) {
    state.focusId = id;
    state.layout = 'focus';
    render();
  }

  function setChat(open, id) {
    state.chatOpen = open;
    if (id) state.chatId = id;
    render();
  }

  function setTheater(on) {
    state.theater = on && state.streams.length > 0;
    render();
  }

  /* ---------- Rendering ---------- */

  function createTile(stream) {
    const p = PLATFORMS[stream.platform];
    const el = document.createElement('article');
    el.className = 'tile';
    el.dataset.id = stream.id;
    el.style.setProperty('--pc', p.color);
    el.innerHTML = `
      <div class="tile-head" draggable="true" title="Drag to reorder">
        <span class="badge">${p.label}</span>
        <a class="tile-name" href="${p.url(stream.channel)}" target="_blank" rel="noopener noreferrer" draggable="false"></a>
        <div class="tile-actions">
          <button type="button" class="tile-btn" data-act="focus" aria-label="Focus this stream" title="Focus">${icon('focus')}</button>
          <button type="button" class="tile-btn hide-compact" data-act="chat" aria-label="Show chat" title="Chat">${icon('chat')}</button>
          <button type="button" class="tile-btn hide-compact" data-act="reload" aria-label="Reload stream" title="Reload">${icon('reload')}</button>
          <button type="button" class="tile-btn danger" data-act="remove" aria-label="Remove stream" title="Remove">${icon('close')}</button>
        </div>
      </div>
      <div class="tile-video">
        <iframe allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>
      </div>`;
    el.querySelector('.tile-name').textContent = stream.channel;
    const frame = el.querySelector('iframe');
    frame.title = `${stream.channel} on ${p.label}`;
    frame.src = p.player(stream.channel);
    return el;
  }

  function render() {
    const { streams } = state;
    const ids = new Set(streams.map((s) => s.id));
    if (!ids.has(state.focusId)) state.focusId = streams[0] ? streams[0].id : null;
    if (!ids.has(state.chatId)) state.chatId = state.focusId;
    if (!streams.length) { state.theater = false; state.chatOpen = false; }

    for (const [id, el] of tiles) {
      if (!ids.has(id)) { el.remove(); tiles.delete(id); }
    }
    for (const s of streams) {
      if (!tiles.has(s.id)) {
        const el = createTile(s);
        tiles.set(s.id, el);
        stage.appendChild(el);
      }
    }

    const has = streams.length > 0;
    document.body.classList.toggle('has-streams', has);
    document.body.classList.toggle('theater', state.theater);
    watch.hidden = !has;
    $('empty').hidden = has;
    $('clear-all').hidden = !has;
    $('exit-theater').hidden = !state.theater;
    chat.hidden = !state.chatOpen;

    document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === state.layout)));
    document.querySelectorAll('[data-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.toggle === 'chat' ? state.chatOpen : state.theater)));
    document.querySelectorAll('[data-platform]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.platform === state.platform)));

    renderChat();
    renderLive();
    layout();
    persist();
  }

  // Tiles never move in the DOM (that would reload their iframes); order and
  // placement are driven entirely by CSS order / grid properties.
  function layout() {
    const { streams } = state;
    const n = streams.length;
    if (!n) return;

    const W = stage.clientWidth;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const H = Math.max(260, window.innerHeight - top - 12);
    const narrow = W < 640;
    const focusMode = state.layout === 'focus' && n > 1;

    stage.classList.toggle('is-compact', focusMode || n > 6);
    stage.style.gridTemplateRows = '';
    chat.style.height = window.innerWidth >= 900 ? `${H}px` : '';

    streams.forEach((s, i) => {
      const el = tiles.get(s.id);
      const isFocus = focusMode && s.id === state.focusId;
      el.classList.toggle('is-focus', isFocus);
      el.style.order = isFocus ? -1 : i;
      el.style.gridColumn = '';
      el.style.gridRow = '';
      el.querySelector('[data-act="focus"]').setAttribute('aria-pressed', String(isFocus));
    });

    if (focusMode) {
      const main = tiles.get(state.focusId);
      if (narrow) {
        stage.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        main.style.gridColumn = '1 / -1';
        return;
      }
      const sideW = Math.round(Math.min(340, Math.max(190, W * 0.22)));
      const mainW = Math.floor(Math.min(W - sideW - GAP, (H - HEAD) * 16 / 9));
      stage.style.gridTemplateColumns = `${mainW}px ${sideW}px`;
      // The trailing 1fr row soaks up the main tile's extra height so the
      // side tiles stay packed at the top.
      stage.style.gridTemplateRows = `repeat(${n - 1}, auto) 1fr`;
      main.style.gridColumn = '1';
      main.style.gridRow = `1 / span ${n}`;
      streams.forEach((s) => { if (s.id !== state.focusId) tiles.get(s.id).style.gridColumn = '2'; });
      return;
    }

    if (narrow) {
      stage.style.gridTemplateColumns = 'minmax(0, 1fr)';
      return;
    }
    // Pick the column count that gives the largest 16:9 tiles inside W x H.
    let best = { w: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const byWidth = (W - GAP * (cols - 1)) / cols;
      const byHeight = ((H - GAP * (rows - 1)) / rows - HEAD) * 16 / 9;
      const w = Math.min(byWidth, byHeight);
      if (w > best.w) best = { w, cols };
    }
    stage.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(Math.max(best.w, 220))}px)`;
  }

  let chatShown = null;
  function renderChat() {
    if (!state.chatOpen) {
      if (chatShown) { chatBody.replaceChildren(); chatShown = null; }
      return;
    }
    chatTabs.replaceChildren(...state.streams.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.id === state.chatId));
      b.textContent = s.channel;
      b.title = `${s.channel} · ${PLATFORMS[s.platform].label}`;
      b.addEventListener('click', () => setChat(true, s.id));
      return b;
    }));

    if (chatShown === state.chatId) return;
    chatShown = state.chatId;
    const s = state.streams.find((x) => x.id === state.chatId);
    if (!s) { chatBody.replaceChildren(); return; }
    const p = PLATFORMS[s.platform];
    const src = p.chat(s.channel);
    chatBody.replaceChildren();
    chat.querySelector('.chat-pop')?.remove();
    if (!src) {
      const div = document.createElement('div');
      div.className = 'chat-empty';
      div.textContent = 'Chat is only available for YouTube streams added by video link.';
      chatBody.appendChild(div);
      return;
    }
    const frame = document.createElement('iframe');
    frame.title = `${s.channel} chat`;
    frame.src = src;
    chatBody.appendChild(frame);
    const pop = document.createElement('a');
    pop.className = 'chat-pop';
    pop.href = p.chatPopout(s.channel);
    pop.target = '_blank';
    pop.rel = 'noopener noreferrer';
    pop.textContent = 'Chat not loading? Open in a new window';
    chat.appendChild(pop);
  }

  /* ---------- Persistence & sharing ---------- */

  function encodeHash() {
    if (!state.streams.length) return '';
    const parts = [`s=${state.streams.map((s) => s.id).join(',')}`];
    if (state.layout === 'focus') parts.push('l=focus', `f=${state.focusId}`);
    return `#${parts.join('&')}`;
  }

  function persist() {
    const hash = encodeHash();
    if (hash !== location.hash) history.replaceState(null, '', hash || location.pathname + location.search);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ hash, platform: state.platform, chatOpen: state.chatOpen }));
    } catch { /* storage unavailable */ }
  }

  function restore() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { /* ignore */ }
    if (PLATFORMS[saved.platform]) state.platform = saved.platform;
    const hash = location.hash.length > 1 ? location.hash : (saved.hash || '');
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    for (const id of (params.get('s') || '').split(',')) {
      const [platform, ...rest] = id.split(':');
      const stream = makeStream(platform, rest.join(':'));
      if (stream && state.streams.length < MAX_STREAMS && !state.streams.some((s) => s.id === stream.id)) state.streams.push(stream);
    }
    if (params.get('l') === 'focus') state.layout = 'focus';
    state.focusId = params.get('f');
    state.chatOpen = Boolean(saved.chatOpen) && state.streams.length > 0 && window.innerWidth >= 900;
  }

  async function share() {
    if (!state.streams.length) { toast('Add a stream first'); return; }
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast('Lineup link copied');
    } catch {
      window.prompt('Copy this link to share the lineup:', url);
    }
  }

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  /* ---------- Events ---------- */

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) { input.focus(); return; }
    if (addFromText(input.value)) input.value = '';
  });

  document.querySelectorAll('[data-platform]').forEach((b) => b.addEventListener('click', () => {
    state.platform = b.dataset.platform;
    render();
    input.focus();
  }));
  document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));

  $('header-add').addEventListener('click', () => {
    if (state.theater) setTheater(false);
    window.scrollTo({ top: 0 });
    input.focus();
  });
  document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
    if (!state.streams.length) toast('Add a stream first');
    else if (b.dataset.toggle === 'chat') setChat(!state.chatOpen);
    else setTheater(!state.theater);
  }));
  $('exit-theater').addEventListener('click', () => setTheater(false));
  $('chat-close').addEventListener('click', () => setChat(false));
  $('share').addEventListener('click', share);
  $('reload-all').addEventListener('click', () => {
    if (!state.streams.length) { toast('Add a stream first'); return; }
    tiles.forEach((el) => { const f = el.querySelector('iframe'); f.src = f.src; });
    toast('Streams reloaded');
  });
  $('clear-all').addEventListener('click', () => {
    if (window.confirm('Remove every stream from the lineup?')) { state.streams = []; render(); }
  });

  stage.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.tile').dataset.id;
    const act = btn.dataset.act;
    if (act === 'remove') removeStream(id);
    else if (act === 'reload') { const f = tiles.get(id).querySelector('iframe'); f.src = f.src; }
    else if (act === 'chat') setChat(!(state.chatOpen && state.chatId === id), id);
    else if (act === 'focus') {
      if (state.layout === 'focus' && state.focusId === id) setLayout('grid');
      else focusStream(id);
    }
  });

  // Drag a tile header onto another tile to move it there.
  let dragId = null;
  const endDrag = () => {
    dragId = null;
    document.body.classList.remove('is-reordering');
    stage.querySelectorAll('.drag-over, .is-dragging').forEach((el) => el.classList.remove('drag-over', 'is-dragging'));
  };
  stage.addEventListener('dragstart', (e) => {
    const head = e.target.closest?.('.tile-head');
    if (!head) return;
    const tile = head.closest('.tile');
    dragId = tile.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.setDragImage(head, 20, 18);
    // Iframes swallow drag events, so make them inert while reordering.
    setTimeout(() => { document.body.classList.add('is-reordering'); tile.classList.add('is-dragging'); });
  });
  stage.addEventListener('dragover', (e) => {
    if (!dragId) return;
    const tile = e.target.closest?.('.tile');
    if (!tile) return;
    e.preventDefault();
    stage.querySelectorAll('.drag-over').forEach((el) => el !== tile && el.classList.remove('drag-over'));
    if (tile.dataset.id !== dragId) tile.classList.add('drag-over');
  });
  stage.addEventListener('drop', (e) => {
    const tile = e.target.closest?.('.tile');
    if (!dragId || !tile) return;
    e.preventDefault();
    const from = state.streams.findIndex((s) => s.id === dragId);
    const to = state.streams.findIndex((s) => s.id === tile.dataset.id);
    const movedOntoFocus = state.layout === 'focus' && tile.dataset.id === state.focusId;
    if (from !== -1 && to !== -1 && from !== to) {
      if (movedOntoFocus) state.focusId = dragId;
      else state.streams.splice(to, 0, state.streams.splice(from, 1)[0]);
    }
    endDrag();
    render();
  });
  stage.addEventListener('dragend', endDrag);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.activeElement === input) input.blur();
      else if (state.theater) setTheater(false);
      return;
    }
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const n = state.streams.length;
    if (key === '/') { e.preventDefault(); $('header-add').click(); }
    else if (!n) return;
    else if (key === 'g') setLayout('grid');
    else if (key === 'f') setLayout('focus');
    else if (key === 'c') setChat(!state.chatOpen);
    else if (key === 't') setTheater(!state.theater);
    else if (/^[1-9]$/.test(key) && state.streams[key - 1]) focusStream(state.streams[key - 1].id);
    else if ((key === 'arrowright' || key === 'arrowleft') && state.layout === 'focus') {
      const i = state.streams.findIndex((s) => s.id === state.focusId);
      focusStream(state.streams[(i + (key === 'arrowright' ? 1 : n - 1)) % n].id);
    }
  });

  let resizeFrame;
  const relayout = () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(layout); };
  window.addEventListener('resize', relayout);
  new ResizeObserver(relayout).observe(stage);
  window.addEventListener('hashchange', () => {
    if (location.hash === encodeHash()) return;
    state.streams = [];
    state.layout = 'grid';
    restore();
    render();
  });

  /* ---------- Live discovery ---------- */

  const live = { data: null, failed: false, filter: 'all' };
  const liveGrid = $('live-grid');

  const ago = (iso) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  };
  const duration = (iso) => {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  function liveStreams() {
    if (!live.data) return [];
    return live.data.streams
      .map((s) => ({ info: s, stream: PLATFORMS[s.platform] && s.platform !== 'youtube' ? makeStream(s.platform, String(s.channel || '')) : null }))
      .filter((x) => x.stream);
  }

  function liveStatus(all) {
    if (live.failed && !live.data) return 'Live list is not available yet · Add channels by name above';
    if (!live.data) return 'Checking for live streams';
    const src = live.data.sources || {};
    const names = { twitch: 'Twitch', kick: 'Kick' };
    const notes = [];
    for (const key of ['twitch', 'kick']) {
      const s = src[key] || {};
      if (s.configured === false) notes.push(`${names[key]} is not connected yet`);
      else if (!s.ok) notes.push(`${names[key]} check failed`);
    }
    if (src.kick && src.kick.ok && src.kick.partial) notes.push('Kick results can be incomplete');
    const stale = Date.now() - new Date(live.data.updated).getTime() > 45 * 60 * 1000;
    return [`${all.length} live`, `Updated ${ago(live.data.updated)}${stale ? ' (stale)' : ''}`, ...notes].join(' · ');
  }

  function renderLive() {
    const all = liveStreams();
    const shown = all.filter((x) => live.filter === 'all' || x.stream.platform === live.filter);
    const inLineup = new Set(state.streams.map((s) => s.id));

    $('discover-meta').textContent = liveStatus(all);
    $('discover-actions').hidden = !all.length;
    document.querySelectorAll('.live-count').forEach((el) => { el.textContent = all.length; el.hidden = !all.length; });
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === live.filter)));

    liveGrid.replaceChildren(...shown.map(({ info, stream }) => {
      const p = PLATFORMS[stream.platform];
      const added = inLineup.has(stream.id);
      const card = document.createElement('article');
      card.className = `live-card${added ? ' in-lineup' : ''}`;
      card.style.setProperty('--pc', p.color);
      card.innerHTML = `
        <a class="live-thumb" target="_blank" rel="noopener noreferrer">
          <span class="live-flag"><i></i>Live</span>
          <span class="live-viewers"></span>
          <span class="badge">${p.label}</span>
        </a>
        <p class="live-title"></p>
        <p class="live-name"></p>
        <p class="live-sub"></p>
        <div class="live-buttons">
          <button type="button"></button>
          <a target="_blank" rel="noopener noreferrer">Open</a>
        </div>`;
      const url = p.url(stream.channel);
      const thumb = card.querySelector('.live-thumb');
      thumb.href = url;
      if (typeof info.thumb === 'string' && /^https:\/\//.test(info.thumb)) {
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = info.thumb;
        img.addEventListener('error', () => img.remove());
        thumb.prepend(img);
      }
      card.querySelector('.live-viewers').textContent = `${Number(info.viewers) || 0} watching`;
      card.querySelector('.live-title').textContent = info.title || '';
      card.querySelector('.live-name').textContent = info.name || stream.channel;
      card.querySelector('.live-sub').textContent = [info.started ? duration(info.started) : '', info.game || ''].filter(Boolean).join(' · ');
      card.querySelector('.live-buttons a').href = url;
      const btn = card.querySelector('button');
      btn.textContent = added ? 'In lineup · Remove' : 'Watch here';
      btn.addEventListener('click', () => {
        if (added) { removeStream(stream.id); return; }
        if (state.streams.length >= MAX_STREAMS) { toast(`Lineup is full — ${MAX_STREAMS} streams max`); return; }
        state.streams.push(stream);
        render();
        toast(`${stream.channel} added`);
      });
      return card;
    }));
  }

  async function loadLive() {
    try {
      const res = await fetch(`${LIVE_URL}?t=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data || !Array.isArray(data.streams)) throw new Error('bad data');
      live.data = data;
      live.failed = false;
    } catch {
      live.failed = true;
    }
    renderLive();
  }

  document.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { live.filter = b.dataset.filter; renderLive(); }));
  document.querySelectorAll('.js-live').forEach((b) => b.addEventListener('click', () => {
    if (state.theater) setTheater(false);
    $('discover').scrollIntoView({ behavior: 'smooth' });
  }));
  $('add-all').addEventListener('click', () => {
    const have = new Set(state.streams.map((s) => s.id));
    const fresh = liveStreams()
      .filter((x) => (live.filter === 'all' || x.stream.platform === live.filter) && !have.has(x.stream.id))
      .map((x) => x.stream);
    const room = MAX_STREAMS - state.streams.length;
    if (!fresh.length) { toast('Everything here is already in the lineup'); return; }
    if (room <= 0) { toast(`Lineup is full — ${MAX_STREAMS} streams max`); return; }
    state.streams.push(...fresh.slice(0, room));
    render();
    toast(fresh.length > room ? `Added the top ${room} — lineup is full` : `Added ${fresh.length} stream${fresh.length === 1 ? '' : 's'}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  setInterval(() => { if (!document.hidden) loadLive(); }, LIVE_REFRESH_MS);

  if (!HOST) {
    const notice = $('notice');
    notice.textContent = 'This page is open as a local file. Twitch only plays when the page is served from a web address (localhost or a real domain).';
    notice.hidden = false;
  }

  restore();
  render();
  loadLive();
})();
