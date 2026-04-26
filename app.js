const CFG = window.OFB_CONFIG || {};
const API_BASE = (CFG.API_BASE || '').replace(/\/$/, '');
const REQUIRE_MAX_INIT_DATA = CFG.REQUIRE_MAX_INIT_DATA !== false;
const TIMEOUT_MS = Number(CFG.REQUEST_TIMEOUT_MS || 15000);

const state = {
  profile: null,
  selectedTeam: null,
  selectedTeamId: null,
  activeTab: 'overview',
  cache: new Map(),
  searchTimer: null,
  currentController: null,
  flags: { goals: true, match_start: true },
  autoOpened: false
};

const $ = (id) => document.getElementById(id);
const appRoot = $('appRoot');
const searchInput = $('teamSearch');
const searchResults = $('searchResults');
const profileGrid = $('profileGrid');
const teamPanel = $('teamPanel');
const teamHeader = $('teamHeader');
const tabContent = $('tabContent');
const toastEl = $('toast');
const connectionStatus = $('connectionStatus');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

function pick(obj, paths, fallback = '') {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function asArray(data, keys = []) {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    const value = pick(data, [key], null);
    if (Array.isArray(value)) return value;
  }
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.response)) return data.response;
  if (Array.isArray(data?.teams)) return data.teams;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function getMaxInitData() {
  return window.WebApp?.initData || '';
}

function isInsideMax() {
  return Boolean(getMaxInitData());
}

function toast(message, ms = 2700) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

function setStatus(text, mode = 'normal') {
  connectionStatus.textContent = text;
  connectionStatus.style.color = mode === 'error' ? 'var(--danger)' : mode === 'ok' ? 'var(--good)' : 'var(--muted)';
}

async function ofbApi(path, payload = {}, options = {}) {
  const initData = getMaxInitData();
  if (!initData && REQUIRE_MAX_INIT_DATA) {
    throw new Error('Откройте мини-приложение внутри MAX. initData не найден.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const requestPath = path.startsWith('/') ? path : `/${path}`;
  try {
    const response = await fetch(`${API_BASE}${requestPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, payload }),
      signal: options.signal || controller.signal
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || data?.message || `API error ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTeam(raw = {}) {
  const teamObj = raw.team || raw;
  return {
    id: Number(pick(raw, ['team_id', 'id', 'team.id', 'teamId', 'api_team_id', 'api_football_team_id'], 0)),
    name: pick(raw, ['team_name', 'name', 'team.name'], 'Команда'),
    country: pick(raw, ['country', 'team.country', 'league.country'], ''),
    logo: pick(raw, ['logo', 'team.logo', 'team_logo', 'image', 'crest', 'teamLogo'], ''),
    venue: pick(raw, ['venue.name', 'stadium', 'team.venue'], ''),
    raw: teamObj
  };
}

function normalizeProfile(data = {}) {
  let teams = asArray(data, ['subscriptions', 'teams', 'favorite_teams', 'data.subscriptions', 'profile.teams']).map(normalizeTeam).filter((t) => t.id);
  const single = data?.subscription || data?.current_subscription || data?.team || data?.favorite_team || data?.data?.subscription || data?.data?.team;
  if (!teams.length && single) {
    const team = normalizeTeam(single);
    if (team.id) teams = [team];
  }
  return { teams: teams.slice(0, 1), raw: data };
}

function getCurrentSubscription() {
  const teams = state.profile?.teams || [];
  return teams.length ? teams[0] : null;
}

function getSubscribeMode(team) {
  const current = getCurrentSubscription();
  if (!current) return 'subscribe';
  if (Number(current.id) === Number(team?.id || state.selectedTeamId)) return 'unsubscribe';
  return 'replace';
}

function getSubscribeButtonText(mode) {
  if (mode === 'unsubscribe') return 'Отписаться';
  if (mode === 'replace') return 'Заменить команду';
  return 'Подписаться';
}

function getTeamLogo(obj = {}, fallback = '') {
  return pick(obj, ['team.logo', 'logo', 'team_logo', 'image', 'crest'], fallback);
}

function normalizeScore(item = {}) {
  const direct = pick(item, ['score_text', 'scoreText', 'result_text', 'result'], '');
  if (typeof direct === 'string' && direct.trim()) return direct;
  const gh = pick(item, ['goals.home', 'score.home', 'home_score', 'score.fulltime.home', 'score.ft.home'], null);
  const ga = pick(item, ['goals.away', 'score.away', 'away_score', 'away_team_score', 'score.fulltime.away', 'score.ft.away'], null);
  if (gh !== null && ga !== null && gh !== '' && ga !== '') return `${gh}:${ga}`;
  return '';
}

function playerPhoto(p = {}) {
  return pick(p, ['photo', 'player.photo', 'player_photo', 'image', 'avatar', 'headshot', 'profile.photo', 'profile.image', 'person.photo', 'player_image', 'player.avatar'], '');
}

function setLoading(container, count = 3) {
  container.innerHTML = Array.from({ length: count }, () => '<div class="skeleton-line"></div>').join('');
}

function renderProfile() {
  const teams = state.profile?.teams || [];
  if (!teams.length) {
    profileGrid.innerHTML = `<article class="empty-card glass-card"><h2>Команды пока не выбраны</h2><p class="muted">Найдите клуб и подпишитесь на уведомления о матчах и голах. Можно выбрать только одну команду.</p></article>`;
    return;
  }
  profileGrid.innerHTML = `<article class="profile-card glass-card"><h2>Моя команда</h2><div class="team-list">${teams.map((team) => `
    <button class="team-row" type="button" data-team-id="${team.id}">
      ${team.logo ? `<img class="mini-logo" src="${escapeHtml(team.logo)}" alt="">` : `<span class="mini-logo avatar placeholder">${escapeHtml(team.name[0] || 'O')}</span>`}
      <span><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml(team.country || 'Открыть карточку')}</small></span>
    </button>`).join('')}</div></article>`;
  profileGrid.querySelectorAll('[data-team-id]').forEach((btn) => {
    btn.addEventListener('click', () => selectTeam(teams.find((t) => String(t.id) === btn.dataset.teamId), { scroll: true }));
  });
}

function renderSearchResults(items = []) {
  if (!items.length) {
    searchResults.innerHTML = '';
    return;
  }
  searchResults.innerHTML = items.slice(0, 7).map((raw) => {
    const team = normalizeTeam(raw);
    return `<button class="result-item" type="button" data-team='${escapeHtml(JSON.stringify(team))}'>
      ${team.logo ? `<img src="${escapeHtml(team.logo)}" alt="">` : `<span class="avatar placeholder">${escapeHtml(team.name[0] || 'O')}</span>`}
      <span class="result-copy"><strong>${escapeHtml(team.name)}</strong><small>${escapeHtml([team.country, team.venue].filter(Boolean).join(' · ') || 'Выбрать команду')}</small></span>
    </button>`;
  }).join('');
  searchResults.querySelectorAll('.result-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const team = JSON.parse(btn.dataset.team);
      searchInput.value = team.name;
      searchResults.innerHTML = '';
      selectTeam(team, { scroll: true });
    });
  });
}

async function searchTeams(query) {
  const q = query.trim();
  if (q.length < Number(CFG.SEARCH_MIN_LENGTH || 2)) {
    renderSearchResults([]);
    return;
  }
  searchResults.innerHTML = '<div class="skeleton-line"></div>';
  try {
    const data = await ofbApi('/ofb-api-team-search', { query: q });
    renderSearchResults(asArray(data, ['teams', 'data', 'response', 'results']));
  } catch (err) {
    searchResults.innerHTML = `<div class="muted">${escapeHtml(err.message)}</div>`;
  }
}

function renderTeamHeader(details = {}) {
  const team = state.selectedTeam || normalizeTeam(details);
  const mode = getSubscribeMode(team);
  const current = getCurrentSubscription();
  const logo = getTeamLogo(details, team.logo);
  const name = pick(details, ['team.name', 'name', 'team_name'], team.name);
  const country = pick(details, ['team.country', 'country', 'league.country'], team.country);
  teamHeader.innerHTML = `
    <div class="team-main">
      ${logo ? `<img class="team-logo" src="${escapeHtml(logo)}" alt="">` : `<span class="team-logo avatar placeholder">${escapeHtml(name[0] || 'O')}</span>`}
      <div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(country || 'Команда')}</p></div>
    </div>
    <div class="team-actions">
      <button class="primary-btn" id="subscribeBtn" type="button">${getSubscribeButtonText(mode)}</button>
      <button class="secondary-btn" id="refreshBtn" type="button">Обновить</button>
    </div>
    ${mode === 'replace' && current ? `<p class="replace-note">Сейчас выбрана: ${escapeHtml(current.name)}. Новая команда заменит старую подписку.</p>` : ''}
    <div class="flags">
      <button class="chip ${state.flags.goals ? 'active' : ''}" type="button" data-flag="goals">Голы</button>
      <button class="chip ${state.flags.match_start ? 'active' : ''}" type="button" data-flag="match_start">Старт матча</button>
    </div>`;
  $('subscribeBtn').addEventListener('click', () => toggleSubscription(mode));
  $('refreshBtn').addEventListener('click', () => loadTeamData(true));
  teamHeader.querySelectorAll('[data-flag]').forEach((btn) => btn.addEventListener('click', async () => {
    const flag = btn.dataset.flag;
    state.flags[flag] = !state.flags[flag];
    renderTeamHeader(details);
    await updateFlags();
  }));
}

async function toggleSubscription(mode) {
  if (!state.selectedTeamId) return;
  const btn = $('subscribeBtn');
  btn.disabled = true;
  try {
    if (mode === 'unsubscribe') {
      await ofbApi('/ofb-api-unsubscribe', { team_id: state.selectedTeamId });
      toast('Подписка отключена');
    } else {
      await ofbApi('/ofb-api-subscribe', { team_id: state.selectedTeamId, replace_existing: true });
      toast(mode === 'replace' ? 'Команда заменена' : 'Подписка включена');
    }
    await loadProfile({ autoOpen: false });
    renderTeamHeader(state.cache.get('profile') || state.selectedTeam || {});
  } catch (err) {
    toast(err.message, 3800);
  } finally {
    btn.disabled = false;
  }
}

async function updateFlags() {
  if (!state.selectedTeamId) return;
  try {
    await ofbApi('/ofb-api-update-flags', { team_id: state.selectedTeamId, flags: state.flags });
    toast('Уведомления обновлены');
  } catch (err) {
    toast(err.message, 3800);
  }
}

async function selectTeam(team, opts = {}) {
  if (!team?.id) {
    toast('Не найден team_id');
    return;
  }
  state.selectedTeam = team;
  state.selectedTeamId = Number(team.id);
  state.activeTab = 'overview';
  teamPanel.classList.remove('hidden');
  renderTeamHeader(team);
  setActiveTab('overview');
  loadTeamData(false);
  if (opts.scroll) teamPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setActiveTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
  renderActiveTab();
}

async function loadTeamData(force = false) {
  if (!state.selectedTeamId) return;
  const key = `team:${state.selectedTeamId}`;
  if (state.cache.has(key) && !force) {
    renderActiveTab();
    return;
  }

  if (force) state.cache.delete(key);
  state.cache.set(key, {
    profile: state.selectedTeam || {},
    card: {},
    fixtures: null,
    stats: null
  });

  renderOverview(state.cache.get(key), true);

  Promise.allSettled([
    ofbApi('/ofb-api-team-profile', { team_id: state.selectedTeamId }),
    ofbApi('/ofb-api-team-card', { team_id: state.selectedTeamId })
  ]).then(([profile, card]) => {
    const old = state.cache.get(key) || {};
    const next = {
      ...old,
      profile: profile.status === 'fulfilled' ? profile.value : old.profile,
      card: card.status === 'fulfilled' ? card.value : old.card
    };
    state.cache.set(key, next);
    renderTeamHeader(next.profile || next.card || state.selectedTeam || {});
    renderActiveTab();
  });

  Promise.allSettled([
    ofbApi('/ofb-api-team-fixtures', { team_id: state.selectedTeamId }),
    ofbApi('/ofb-api-team-season-stats', { team_id: state.selectedTeamId })
  ]).then(([fixtures, stats]) => {
    const old = state.cache.get(key) || {};
    state.cache.set(key, {
      ...old,
      fixtures: fixtures.status === 'fulfilled' ? fixtures.value : { error: fixtures.reason?.message || 'Матчи не загрузились' },
      stats: stats.status === 'fulfilled' ? stats.value : { error: stats.reason?.message || 'Статистика не загрузилась' }
    });
    renderActiveTab();
  });
}

async function ensureLazy(tab) {
  const key = `team:${state.selectedTeamId}`;
  const data = state.cache.get(key) || {};
  if (tab === 'squad' && !data.squad) {
    setLoading(tabContent, 4);
    data.squad = await ofbApi('/ofb-api-team-squad', { team_id: state.selectedTeamId }).catch((e) => ({ error: e.message }));
    state.cache.set(key, data);
  }
  if (tab === 'transfers' && !data.transfers) {
    setLoading(tabContent, 4);
    data.transfers = await ofbApi('/ofb-api-team-transfers', { team_id: state.selectedTeamId }).catch((e) => ({ error: e.message }));
    state.cache.set(key, data);
  }
}

function renderActiveTab() {
  const key = `team:${state.selectedTeamId}`;
  const data = state.cache.get(key) || {};
  if (!state.selectedTeamId) return;
  if (state.activeTab === 'overview') renderOverview(data);
  if (state.activeTab === 'fixtures') renderFixtures(data.fixtures);
  if (state.activeTab === 'squad') renderSquad(data.squad);
  if (state.activeTab === 'transfers') renderTransfers(data.transfers);
}

function renderOverview(data = {}, loading = false) {
  const stats = data.stats || {};
  const card = data.card || {};
  const founded = pick(card, ['founded', 'team.founded', 'data.founded'], '—');
  const venue = pick(card, ['venue.name', 'stadium', 'team.venue', 'data.venue.name'], '—');
  const wins = pick(stats, ['wins.total', 'fixtures.wins.total', 'data.wins', 'response.fixtures.wins.total'], '—');
  const goals = pick(stats, ['goals.for.total.total', 'goals.total', 'data.goals', 'response.goals.for.total.total'], '—');
  tabContent.innerHTML = `
    <article class="panel-card glass-card"><h3>Быстрый обзор</h3><div class="stat-grid">
      <div class="stat"><strong>${escapeHtml(founded)}</strong><small>Основан</small></div>
      <div class="stat"><strong>${escapeHtml(wins)}</strong><small>Победы</small></div>
      <div class="stat"><strong>${escapeHtml(goals)}</strong><small>Голы</small></div>
      <div class="stat"><strong>${escapeHtml(venue)}</strong><small>Стадион</small></div>
    </div>${loading ? '<p class="muted load-note">Данные обновляются…</p>' : ''}</article>`;
}

function renderFixtures(fixturesData = {}) {
  if (!fixturesData) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Матчи</h3><div class="skeleton-line"></div><div class="skeleton-line"></div></article>`;
    return;
  }
  if (fixturesData?.error) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Матчи</h3><p class="muted">${escapeHtml(fixturesData.error)}</p></article>`;
    return;
  }
  const fixtures = asArray(fixturesData, ['fixtures', 'matches', 'data', 'response', 'items', 'rows']).slice(0, 12);
  if (!fixtures.length) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Матчи</h3><p class="muted">Матчи пока не найдены.</p></article>`;
    return;
  }
  tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Ближайшие и последние</h3>${fixtures.map((item) => {
    const home = pick(item, ['home.name', 'teams.home.name', 'home_team', 'home'], 'Дом');
    const away = pick(item, ['away.name', 'teams.away.name', 'away_team', 'away'], 'Гости');
    const homeLogo = pick(item, ['home.logo', 'teams.home.logo', 'home_team_logo', 'home_logo', 'homeTeam.logo'], '');
    const awayLogo = pick(item, ['away.logo', 'teams.away.logo', 'away_team_logo', 'away_logo', 'awayTeam.logo'], '');
    const dateRaw = pick(item, ['date', 'fixture.date', 'kickoff', 'match_date'], '');
    const score = normalizeScore(item);
    const meta = [formatDate(dateRaw), pick(item, ['league.name', 'league', 'competition'], '')].filter(Boolean).join(' · ');
    return `<div class="fixture with-logos">
      <div class="fixture-teams">
        <span class="team-side">${homeLogo ? `<img src="${escapeHtml(homeLogo)}" alt="">` : ''}<b>${escapeHtml(home)}</b></span>
        <span class="score-pill">${escapeHtml(score || '—')}</span>
        <span class="team-side right"><b>${escapeHtml(away)}</b>${awayLogo ? `<img src="${escapeHtml(awayLogo)}" alt="">` : ''}</span>
      </div>
      <div class="fixture-meta">${escapeHtml(meta)}</div>
      <span class="badge">${escapeHtml(pick(item, ['status.short', 'fixture.status.short', 'status'], ''))}</span>
    </div>`;
  }).join('')}</article>`;
}

function extractPlayers(squadData = {}) {
  if (!squadData) return [];
  if (Array.isArray(squadData?.players)) return squadData.players;
  if (Array.isArray(squadData?.squad)) {
    if (squadData.squad[0]?.players) return squadData.squad.flatMap((x) => x.players || []);
    return squadData.squad;
  }
  if (Array.isArray(squadData?.response)) {
    if (squadData.response[0]?.players) return squadData.response.flatMap((x) => x.players || []);
    return squadData.response;
  }
  return asArray(squadData, ['data.players', 'data', 'items', 'rows']);
}

function renderSquad(squadData = {}) {
  if (!squadData) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Состав</h3><div class="skeleton-line"></div><div class="skeleton-line"></div></article>`;
    return;
  }
  if (squadData?.error) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Состав</h3><p class="muted">${escapeHtml(squadData.error)}</p></article>`;
    return;
  }
  const players = extractPlayers(squadData).slice(0, 60);
  if (!players.length) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Состав</h3><p class="muted">Игроки пока не найдены.</p></article>`;
    return;
  }
  tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Состав команды</h3>${players.map((p) => {
    const name = pick(p, ['name', 'player.name', 'firstname', 'player'], 'Игрок');
    const pos = pick(p, ['position', 'player.position', 'statistics.0.games.position'], '');
    const number = pick(p, ['number', 'player.number'], '');
    const photo = playerPhoto(p);
    return `<div class="person">${photo ? `<img class="avatar" src="${escapeHtml(photo)}" alt="">` : `<span class="avatar placeholder">${escapeHtml(String(name)[0] || 'O')}</span>`}<div class="person-main"><div class="person-title">${escapeHtml(name)}</div><div class="person-meta">${escapeHtml([pos, number ? `№ ${number}` : ''].filter(Boolean).join(' · '))}</div></div></div>`;
  }).join('')}</article>`;
}

function renderTransfers(transfersData = {}) {
  if (!transfersData) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Трансферы</h3><div class="skeleton-line"></div><div class="skeleton-line"></div></article>`;
    return;
  }
  if (transfersData?.error) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Трансферы</h3><p class="muted">${escapeHtml(transfersData.error)}</p></article>`;
    return;
  }
  const transfers = asArray(transfersData, ['transfers', 'data', 'response', 'items', 'rows']).slice(0, 40);
  if (!transfers.length) {
    tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Трансферы</h3><p class="muted">Трансферы пока не найдены.</p></article>`;
    return;
  }
  tabContent.innerHTML = `<article class="panel-card glass-card"><h3>Трансферы</h3>${transfers.map((t) => {
    const player = pick(t, ['player.name', 'name', 'player'], 'Игрок');
    const photo = playerPhoto(t);
    const type = pick(t, ['type', 'transfer.type', 'transfers.0.type'], '');
    const date = formatDate(pick(t, ['date', 'transfer.date', 'transfers.0.date'], ''));
    const from = pick(t, ['from.name', 'teams.out.name', 'team_from', 'out', 'transfers.0.teams.out.name'], '');
    const to = pick(t, ['to.name', 'teams.in.name', 'team_to', 'in', 'transfers.0.teams.in.name'], '');
    const meta = [date, type, [from, to].filter(Boolean).join(' → ')].filter(Boolean).join(' · ');
    return `<div class="transfer">${photo ? `<img class="avatar" src="${escapeHtml(photo)}" alt="">` : `<span class="avatar placeholder">${escapeHtml(String(player)[0] || 'O')}</span>`}<div class="transfer-main"><div class="transfer-title">${escapeHtml(player)}</div><div class="transfer-meta">${escapeHtml(meta)}</div></div></div>`;
  }).join('')}</article>`;
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: value.includes('T') ? '2-digit' : undefined, minute: value.includes('T') ? '2-digit' : undefined });
}

async function loadProfile(options = { autoOpen: true }) {
  profileGrid.innerHTML = `<article class="profile-card glass-card"><h2>Загрузка профиля</h2><div class="skeleton-line"></div></article>`;
  try {
    const data = await ofbApi('/ofb-api-profile', {});
    state.profile = normalizeProfile(data);
    setStatus('Защищено', 'ok');
    renderProfile();
    const team = getCurrentSubscription();
    if (options.autoOpen !== false && team && !state.autoOpened) {
      state.autoOpened = true;
      selectTeam(team, { scroll: false });
    }
  } catch (err) {
    setStatus('Нет MAX', 'error');
    profileGrid.innerHTML = `<article class="empty-card glass-card"><h2>Нужен запуск из MAX</h2><p class="muted">${escapeHtml(err.message)}</p></article>`;
  }
}

function bindEvents() {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchTeams(e.target.value), Number(CFG.SEARCH_DEBOUNCE_MS || 450));
  });
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tab = btn.dataset.tab;
      setActiveTab(tab);
      await ensureLazy(tab);
      renderActiveTab();
    });
  });
  $('brandButton').addEventListener('click', () => {
    const url = CFG.CHANNEL_URL || 'https://max.ru/ofb24news';
    if (window.WebApp?.openLink) window.WebApp.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  });
}

async function init() {
  bindEvents();
  if (window.WebApp?.disableClosingConfirmation) window.WebApp.disableClosingConfirmation();
  setStatus(isInsideMax() ? 'MAX' : 'Preview', isInsideMax() ? 'ok' : 'normal');
  await loadProfile({ autoOpen: true });
  if (!state.selectedTeamId && CFG.DEFAULT_TEAM_ID) selectTeam({ id: Number(CFG.DEFAULT_TEAM_ID), name: 'Команда' }, { scroll: false });
}

init();
