// Finds live Twitch and Kick streams whose title contains KEYWORD and prints
// them as JSON. Run by .github/workflows/discover.yml; the site reads the result.
//
// Needs API credentials in the environment (see README):
//   TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, KICK_CLIENT_ID, KICK_CLIENT_SECRET

const KEYWORD = (process.env.KEYWORD || 'tmfrz').toLowerCase();
const GAME = 'Grand Theft Auto V';
const MAX_TWITCH_PAGES = 150; // 100 streams per page
const matches = (title) => typeof title === 'string' && title.toLowerCase().includes(KEYWORD);

async function getJson(url, options = {}, attempt = 0) {
  const res = await fetch(url, options);
  if (res.status === 429 && attempt < 3) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return getJson(url, options, attempt + 1);
  }
  if (!res.ok) throw new Error(`${new URL(url).hostname}${new URL(url).pathname} returned ${res.status}`);
  return res.json();
}

async function appToken(url, id, secret) {
  const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
  const data = await getJson(url, { method: 'POST', body });
  if (!data.access_token) throw new Error('no access token returned');
  return data.access_token;
}

/* ---------- Twitch ---------- */

async function twitch() {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return { configured: false, streams: [] };

  const token = await appToken('https://id.twitch.tv/oauth2/token', id, secret);
  const api = (path) => getJson(`https://api.twitch.tv/helix/${path}`, {
    headers: { 'Client-Id': id, Authorization: `Bearer ${token}` },
  });
  const found = new Map();
  const add = (s) => {
    if (s.type && s.type !== 'live') return;
    if (!matches(s.title)) return;
    found.set(s.user_login, {
      platform: 'twitch',
      channel: s.user_login,
      name: s.user_name || s.user_login,
      title: s.title,
      game: s.game_name || '',
      viewers: s.viewer_count || 0,
      started: s.started_at || null,
      thumb: (s.thumbnail_url || '').replace('{width}', '440').replace('{height}', '248'),
    });
  };

  // Twitch has no title search, so walk every live stream in the game's
  // category and filter by title.
  let gameId = '32982';
  try {
    const games = await api(`games?name=${encodeURIComponent(GAME)}`);
    if (games.data?.[0]?.id) gameId = games.data[0].id;
  } catch { /* fall back to the known id */ }

  let cursor = '';
  let scanned = 0;
  for (let page = 0; page < MAX_TWITCH_PAGES; page++) {
    const data = await api(`streams?game_id=${gameId}&first=100${cursor ? `&after=${cursor}` : ''}`);
    (data.data || []).forEach(add);
    scanned += (data.data || []).length;
    cursor = data.pagination?.cursor;
    if (!cursor || !(data.data || []).length) break;
  }

  // Channel search catches matching streams listed under another category.
  try {
    const search = await api(`search/channels?query=${encodeURIComponent(KEYWORD)}&live_only=true&first=100`);
    const extra = (search.data || [])
      .filter((c) => c.is_live && matches(c.title) && !found.has(c.broadcaster_login))
      .map((c) => c.broadcaster_login);
    if (extra.length) {
      const data = await api(`streams?first=100&${extra.map((l) => `user_login=${encodeURIComponent(l)}`).join('&')}`);
      (data.data || []).forEach(add);
    }
  } catch (err) {
    console.error(`twitch channel search skipped: ${err.message}`);
  }

  return { configured: true, scanned, streams: [...found.values()] };
}

/* ---------- Kick ---------- */

async function kick() {
  const id = process.env.KICK_CLIENT_ID;
  const secret = process.env.KICK_CLIENT_SECRET;
  if (!id || !secret) return { configured: false, streams: [] };

  const token = await appToken('https://id.kick.com/oauth/token', id, secret);
  const api = (path) => getJson(`https://api.kick.com/public/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const found = new Map();
  let scanned = 0;
  const collect = async (query) => {
    const data = await api(`livestreams?limit=100&${query}`);
    for (const s of data.data || []) {
      scanned++;
      if (!s.slug || !matches(s.stream_title)) continue;
      found.set(s.slug, {
        platform: 'kick',
        channel: s.slug,
        name: s.slug,
        title: s.stream_title,
        game: s.category?.name || '',
        viewers: s.viewer_count || 0,
        started: s.started_at || null,
        thumb: s.thumbnail || '',
      });
    }
  };

  // Kick's API has no title search and returns at most 100 streams per
  // request, so this samples the game's category from both ends (most watched
  // and most recently started). Small streams in between can be missed.
  let categoryIds = [];
  try {
    const cats = await api(`categories?q=${encodeURIComponent('Grand Theft Auto')}`);
    categoryIds = (cats.data || []).filter((c) => /grand theft auto v|gta/i.test(c.name || '')).map((c) => c.id);
  } catch (err) {
    console.error(`kick category lookup failed: ${err.message}`);
  }
  const queries = ['sort=started_at', 'sort=viewer_count'];
  for (const cat of categoryIds.slice(0, 5)) {
    queries.push(`category_id=${cat}&sort=viewer_count`, `category_id=${cat}&sort=started_at`);
  }
  let failures = 0;
  let lastError;
  for (const q of queries) {
    try { await collect(q); } catch (err) { failures++; lastError = err; }
  }
  if (failures === queries.length) throw lastError;

  return { configured: true, scanned, partial: true, streams: [...found.values()] };
}

/* ---------- Output ---------- */

const out = { updated: new Date().toISOString(), keyword: KEYWORD, sources: {}, streams: [] };
for (const [name, run] of [['twitch', twitch], ['kick', kick]]) {
  try {
    const { streams, ...info } = await run();
    out.sources[name] = { ok: info.configured, ...info, count: streams.length };
    out.streams.push(...streams);
  } catch (err) {
    console.error(`${name} failed: ${err.message}`);
    out.sources[name] = { ok: false, configured: true, error: err.message, count: 0 };
  }
}
out.streams.sort((a, b) => b.viewers - a.viewers);
console.log(JSON.stringify(out, null, 1));
