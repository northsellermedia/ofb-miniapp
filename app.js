'use strict';

const API_BASE = 'https://n8n.northsellermedia.com/webhook/';

const API = {
  PROFILE: `${API_BASE}ofb-api-profile`,
  TEAM_SEARCH: `${API_BASE}ofb-api-team-search`,
  TEAM_CARD: `${API_BASE}ofb-api-team-card`,
  SUBSCRIBE: `${API_BASE}ofb-api-subscribe`,
  UPDATE_FLAGS: `${API_BASE}ofb-api-update-flags`,
  UNSUBSCRIBE: `${API_BASE}ofb-api-unsubscribe`,
  TEAM_FIXTURES: `${API_BASE}ofb-api-team-fixtures`,
  TEAM_PROFILE: `${API_BASE}ofb-api-team-profile`,
  TEAM_SQUAD: `${API_BASE}ofb-api-team-squad`,
  TEAM_TRANSFERS: `${API_BASE}ofb-api-team-transfers`,
  TEAM_STATS: `${API_BASE}ofb-api-team-season-stats`,
};

const TEST_MAX_USER_ID = 5712595;
const TEAM_IMAGE_BASE = 'https://media.api-sports.io/football/teams';

const state = {
  user: null,
  subscriptions: [],
  searchQuery: '',
  searchResults: [],
  selectedTeam: null,
  activeScreen: 'loading',
  activeTeamTab: 'fixtures',
  teamDetails: {
    fixtures: null,
    profile: null,
    squad: null,
    transfers: null,
    stats: null,
  },
  teamLoading: {
    fixtures: false,
    profile: false,
    squad: false,
    transfers: false,
    stats: false,
  },
  teamErrors: {
    fixtures: null,
    profile: null,
    squad: null,
    transfers: null,
    stats: null,
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  loadingView: $('loadingView'),
  homeView: $('homeView'),
  searchView: $('searchView'),
  teamView: $('teamView'),
  welcomeText: $('welcomeText'),
  subsCount: $('subsCount'),
  planText: $('planText'),
  subscriptionsList: $('subscriptionsList'),
  searchInput: $('searchInput'),
  searchStatus: $('searchStatus'),
  searchResults: $('searchResults'),
  teamScreen: $('teamScreen'),
  tabHome: $('tabHome'),
  tabSearch: $('tabSearch'),
  goSearchBtn: $('goSearchBtn'),
  refreshBtn: $('refreshBtn'),
  toast: $('toast'),
};

const NOTIFY_DEFS = [
  { key: 'news', title: 'Новости', desc: 'Новости по выбранной команде' },
  { key: 'goals', title: 'Голы', desc: 'Сообщать о забитых мячах' },
  { key: 'final', title: 'Финальный счёт', desc: 'Итог матча после финального свистка' },
  { key: 'reminder', title: 'Напоминание', desc: 'Напомнить перед началом матча' },
  { key: 'match_start', title: 'Начало матча', desc: 'Уведомление в момент старта' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getMaxUserId() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('max_user_id') || params.get('user_id');
    if (fromQuery && Number.isFinite(Number(fromQuery))) return Number(fromQuery);

    const maxApp = window.MAX || window.max || window.Max;
    const possibleUser =
      maxApp?.initDataUnsafe?.user ||
      maxApp?.WebApp?.initDataUnsafe?.user ||
      window.Telegram?.WebApp?.initDataUnsafe?.user;

    const id = possibleUser?.id || possibleUser?.user_id || possibleUser?.max_user_id;
    if (id && Number.isFinite(Number(id))) return Number(id);
  } catch (error) {
    console.warn('Не удалось определить MAX user:', error);
  }

  return TEST_MAX_USER_ID;
}

function teamLogoUrl(teamId) {
  const id = Number(teamId);
  if (!Number.isFinite(id)) return 'assets/logo-ofb.jpg';
  return `${TEAM_IMAGE_BASE}/${id}.png`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

function showScreen(name) {
  state.activeScreen = name;
  const map = {
    loading: els.loadingView,
    home: els.homeView,
    search: els.searchView,
    team: els.teamView,
  };

  Object.values(map).forEach((el) => el.classList.remove('screen-active'));
  map[name].classList.add('screen-active');

  els.tabHome.classList.toggle('active', name === 'home');
  els.tabSearch.classList.toggle('active', name === 'search');
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    throw new Error(data?.message || data?.error || `Ошибка API ${res.status}`);
  }
  return data;
}

function formatDate(value) {
  if (!value) return 'Дата уточняется';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function normalizeTeam(raw = {}) {
  return {
    team_id: Number(raw.team_id ?? raw.id ?? raw.team?.id ?? 0),
    team_name: raw.team_name || raw.name || raw.team?.name || 'Команда',
    league_id: raw.league_id ?? raw.league?.id ?? null,
    league_name: raw.league_name || raw.league?.name || null,
    notify_flags: raw.notify_flags || {},
  };
}

function flagsSummary(flags = {}) {
  const names = [];
  if (flags.news) names.push('новости');
  if (flags.goals) names.push('голы');
  if (flags.final) names.push('финал');
  if (flags.reminder) names.push('напоминание');
  if (flags.match_start) names.push('старт');
  return names.length ? names.join(', ') : 'уведомления выключены';
}

function renderProfileHeader() {
  const name = state.user?.first_name || state.user?.username || 'болельщик';
  els.welcomeText.textContent = `${name}, выбирай команды и настраивай только нужные уведомления.`;
  els.subsCount.textContent = String(state.subscriptions.length);
  els.planText.textContent = state.user?.plan || 'free';
}

function renderSubscriptions() {
  if (!state.subscriptions.length) {
    els.subscriptionsList.innerHTML = `
      <article class="empty-state">
        <strong>Пока нет команд</strong>
        Нажми «Найти» и добавь первую подписку.
      </article>
    `;
    return;
  }

  els.subscriptionsList.innerHTML = state.subscriptions.map((team) => `
    <article class="card">
      <div class="card-row">
        <img class="team-avatar" src="${escapeHtml(teamLogoUrl(team.team_id))}" alt="${escapeHtml(team.team_name)}"
             onerror="this.onerror=null;this.src='assets/logo-ofb.jpg'" />
        <div class="card-main">
          <div class="item-title">${escapeHtml(team.team_name)}</div>
          <div class="item-meta">${escapeHtml(flagsSummary(team.notify_flags))}</div>
        </div>
        <div class="inline-actions">
          <button class="soft-btn" type="button" data-open-team="${team.team_id}">Открыть</button>
        </div>
      </div>
    </article>
  `).join('');
}

function renderProfileError(message) {
  els.welcomeText.textContent = 'Не удалось подключиться к backend. Попробуй обновить приложение.';
  els.subsCount.textContent = '—';
  els.planText.textContent = 'offline';
  els.subscriptionsList.innerHTML = `
    <article class="empty-state">
      <strong>Ошибка загрузки</strong>
      ${escapeHtml(message)}
      <div style="margin-top:14px">
        <button class="primary-btn" type="button" id="retryProfileBtn">Повторить</button>
      </div>
    </article>
  `;
}

async function loadProfile({ silent = false } = {}) {
  if (!silent) showScreen('loading');

  try {
    const data = await postJson(API.PROFILE, { max_user_id: getMaxUserId() });
    state.user = data.user || data.profile || null;
    state.subscriptions = Array.isArray(data.subscriptions)
      ? data.subscriptions.map(normalizeTeam)
      : Array.isArray(data.teams)
        ? data.teams.map(normalizeTeam)
        : [];

    renderProfileHeader();
    renderSubscriptions();
    if (!silent) showScreen('home');
  } catch (error) {
    console.error(error);
    renderProfileError(error.message);
    showScreen('home');
  }
}

let searchTimer = null;
function scheduleSearch(query) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => searchTeams(query), 360);
}

async function searchTeams(query) {
  state.searchQuery = query.trim();

  if (state.searchQuery.length < 2) {
    state.searchResults = [];
    els.searchStatus.textContent = 'Введите минимум 2 символа';
    els.searchResults.innerHTML = '';
    return;
  }

  els.searchStatus.innerHTML = `<span class="loader-line"><span class="spinner"></span>Ищем команду...</span>`;

  try {
    const data = await postJson(API.TEAM_SEARCH, { q: state.searchQuery, query: state.searchQuery });
    state.searchResults = Array.isArray(data.teams) ? data.teams.map(normalizeTeam) : [];
    renderSearchResults(data.source || 'postgres');
  } catch (error) {
    console.error(error);
    els.searchStatus.textContent = `Ошибка поиска: ${error.message}`;
    els.searchResults.innerHTML = '';
  }
}

function renderSearchResults(source) {
  if (!state.searchResults.length) {
    els.searchStatus.textContent = 'Команда не найдена. Попробуйте другое название.';
    els.searchResults.innerHTML = '';
    return;
  }

  els.searchStatus.textContent = `Найдено: ${state.searchResults.length}. Источник: ${source}.`;
  els.searchResults.innerHTML = state.searchResults.map((team) => `
    <article class="card">
      <div class="card-row">
        <img class="team-avatar" src="${escapeHtml(teamLogoUrl(team.team_id))}" alt="${escapeHtml(team.team_name)}"
             onerror="this.onerror=null;this.src='assets/logo-ofb.jpg'" />
        <div class="card-main">
          <div class="item-title">${escapeHtml(team.team_name)}</div>
          <div class="item-meta">ID команды: ${escapeHtml(team.team_id)}</div>
        </div>
        <div class="inline-actions">
          <button class="primary-btn" type="button" data-open-team="${team.team_id}">Открыть</button>
        </div>
      </div>
    </article>
  `).join('');
}

function resetTeamState() {
  state.teamDetails = { fixtures: null, profile: null, squad: null, transfers: null, stats: null };
  state.teamLoading = { fixtures: false, profile: false, squad: false, transfers: false, stats: false };
  state.teamErrors = { fixtures: null, profile: null, squad: null, transfers: null, stats: null };
  state.activeTeamTab = 'fixtures';
}

async function openTeam(teamId) {
  showScreen('team');
  resetTeamState();
  els.teamScreen.innerHTML = `
    <article class="panel">
      <div class="loader-line"><span class="spinner"></span>Загружаем карточку команды...</div>
    </article>
  `;

  try {
    const data = await postJson(API.TEAM_CARD, {
      max_user_id: getMaxUserId(),
      team_id: Number(teamId),
    });

    const normalized = normalizeTeam(data.team || data);
    state.selectedTeam = {
      team: normalized,
      is_subscribed: Boolean(data.is_subscribed || data.subscribed),
      notify_flags: {
        news: true,
        goals: true,
        final: true,
        reminder: true,
        match_start: true,
        ...(data.notify_flags || normalized.notify_flags || {}),
      },
      next_fixtures: Array.isArray(data.next_fixtures) ? data.next_fixtures : [],
    };

    renderTeamScreen();
    await loadTeamTab('fixtures');
    await loadTeamTab('profile', { silent: true });
  } catch (error) {
    console.error(error);
    els.teamScreen.innerHTML = `
      <article class="empty-state">
        <strong>Не удалось открыть карточку</strong>
        ${escapeHtml(error.message)}
      </article>
    `;
  }
}

function renderTeamScreen() {
  const data = state.selectedTeam;
  if (!data?.team) return;
  const team = data.team;
  const profile = state.teamDetails.profile?.profile || null;
  const logo = profile?.logo_url || teamLogoUrl(team.team_id);

  els.teamScreen.innerHTML = `
    <article class="team-shell glass">
      <div class="team-head">
        <div>
          <div class="pill small-pill">${data.is_subscribed ? 'Вы подписаны' : 'Нет подписки'}</div>
          <h1>${escapeHtml(team.team_name)}</h1>
          <div class="team-subtitle">${team.league_name ? escapeHtml(team.league_name) : `ID команды: ${escapeHtml(team.team_id)}`}</div>
        </div>
        <img class="big-team-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(team.team_name)}"
             onerror="this.onerror=null;this.src='assets/logo-ofb.jpg'" />
      </div>

      <div class="team-actions">
        ${data.is_subscribed
          ? `<button class="danger-btn" type="button" data-unsubscribe="${team.team_id}">Отписаться</button>`
          : `<button class="primary-btn" type="button" data-subscribe="${team.team_id}">Подписаться</button>`}
      </div>

      <div class="tabs-wrap">
        <div class="team-tabs" role="tablist">
          ${renderTeamTabButton('fixtures', 'Матчи')}
          ${renderTeamTabButton('profile', 'Профиль')}
          ${renderTeamTabButton('squad', 'Состав')}
          ${renderTeamTabButton('stats', 'Статистика')}
          ${renderTeamTabButton('transfers', 'Трансферы')}
          ${renderTeamTabButton('notify', 'Уведомления')}
        </div>
      </div>

      <div id="teamTabContent" class="tab-content">${renderActiveTeamTab()}</div>
    </article>
  `;
}

function renderTeamTabButton(key, label) {
  return `
    <button class="team-tab ${state.activeTeamTab === key ? 'active' : ''}" type="button" data-team-tab="${key}">
      ${label}
    </button>
  `;
}

function renderActiveTeamTab() {
  if (state.activeTeamTab === 'notify') return renderNotifyTab();

  const tabKey = state.activeTeamTab;
  if (state.teamLoading[tabKey]) {
    return `<article class="panel"><div class="loader-line"><span class="spinner"></span>Загружаем данные...</div></article>`;
  }

  if (state.teamErrors[tabKey]) {
    return `
      <article class="empty-state">
        <strong>Не удалось загрузить данные</strong>
        ${escapeHtml(state.teamErrors[tabKey])}
      </article>
    `;
  }

  switch (tabKey) {
    case 'fixtures': return renderFixturesTab();
    case 'profile': return renderProfileTab();
    case 'squad': return renderSquadTab();
    case 'stats': return renderStatsTab();
    case 'transfers': return renderTransfersTab();
    default: return `<article class="empty-state">Выбери вкладку</article>`;
  }
}

async function loadTeamTab(tabKey, { silent = false } = {}) {
  if (!state.selectedTeam?.team) return;
  if (tabKey === 'notify') {
    if (!silent) renderTeamScreen();
    return;
  }
  if (state.teamDetails[tabKey]) {
    if (!silent) renderTeamScreen();
    return;
  }

  const map = {
    fixtures: { url: API.TEAM_FIXTURES },
    profile: { url: API.TEAM_PROFILE },
    squad: { url: API.TEAM_SQUAD },
    transfers: { url: API.TEAM_TRANSFERS },
    stats: { url: API.TEAM_STATS },
  };

  state.teamLoading[tabKey] = true;
  state.teamErrors[tabKey] = null;
  if (!silent) renderTeamScreen();

  try {
    state.teamDetails[tabKey] = await postJson(map[tabKey].url, {
      max_user_id: getMaxUserId(),
      team_id: Number(state.selectedTeam.team.team_id),
    });
  } catch (error) {
    console.error(error);
    state.teamErrors[tabKey] = error.message;
  } finally {
    state.teamLoading[tabKey] = false;
    if (!silent) renderTeamScreen();
  }
}

function renderFixturesTab() {
  const payload = state.teamDetails.fixtures;
  const fixtures = Array.isArray(payload?.fixtures)
    ? payload.fixtures
    : Array.isArray(state.selectedTeam?.next_fixtures)
      ? state.selectedTeam.next_fixtures
      : [];

  if (!fixtures.length) {
    return `<article class="empty-state"><strong>Матчи пока не найдены</strong>Данные появятся после обновления кэша.</article>`;
  }

  const now = new Date();
  const upcoming = fixtures.filter((f) => new Date(f.kickoff_utc) >= now);
  const past = fixtures.filter((f) => new Date(f.kickoff_utc) < now);

  return `
    ${renderMatchesBlock('Ближайшие', upcoming.slice(0, 6), true)}
    ${renderMatchesBlock('Прошедшие', past.slice(-6).reverse(), false)}
  `;
}

function renderMatchesBlock(title, matches, upcoming) {
  if (!matches.length) {
    return `
      <article class="panel">
        <h3 class="mini-title">${title}</h3>
        <div class="muted">${upcoming ? 'Ближайшие матчи пока не найдены' : 'Прошедших матчей пока нет'}</div>
      </article>
    `;
  }

  return `
    <article class="panel">
      <h3 class="mini-title">${title}</h3>
      <div class="stack">
        ${matches.map((match) => {
          const home = match.home_team || 'Home';
          const away = match.away_team || 'Away';
          const score = match.score_home == null || match.score_away == null
            ? `${home} — ${away}`
            : `${match.score_home} : ${match.score_away}`;
          const venue = [match.venue, match.city].filter(Boolean).join(', ');
          return `
            <article class="card">
              <div class="mini-title" style="margin-bottom:6px">${escapeHtml(home)} — ${escapeHtml(away)}</div>
              <div class="meta-line">${escapeHtml(match.league_name || 'Турнир')} ${match.round ? `• ${escapeHtml(match.round)}` : ''}</div>
              <div class="match-score" style="margin-top:10px">${escapeHtml(score)}</div>
              <div class="match-status">${escapeHtml(match.status_short || 'NS')}</div>
              <div class="item-meta" style="margin-top:10px">${escapeHtml(formatDate(match.kickoff_utc))}</div>
              ${venue ? `<div class="item-meta">${escapeHtml(venue)}</div>` : ''}
            </article>
          `;
        }).join('')}
      </div>
    </article>
  `;
}

function renderProfileTab() {
  const profile = state.teamDetails.profile?.profile;
  if (!profile) {
    return `<article class="empty-state"><strong>Профиль обновляется</strong>Попробуй открыть вкладку чуть позже.</article>`;
  }

  return `
    <article class="panel">
      <div class="card-row" style="align-items:flex-start">
        <img class="big-team-logo" src="${escapeHtml(profile.logo_url || teamLogoUrl(profile.team_id))}" alt="${escapeHtml(profile.team_name)}"
             onerror="this.onerror=null;this.src='assets/logo-ofb.jpg'" />
        <div class="card-main">
          <div class="item-title">${escapeHtml(profile.team_name || state.selectedTeam.team.team_name)}</div>
          <div class="item-meta">${escapeHtml(profile.country || 'Страна не указана')}${profile.city ? ` • ${escapeHtml(profile.city)}` : ''}</div>
          ${profile.founded ? `<div class="item-meta">Основан: ${escapeHtml(profile.founded)}</div>` : ''}
        </div>
      </div>
    </article>

    <article class="panel">
      <h3 class="mini-title">Стадион</h3>
      <div class="meta-grid">
        <div class="row"><div class="meta-label">Название</div><div class="meta-value">${escapeHtml(profile.venue_name || '—')}</div></div>
        <div class="row"><div class="meta-label">Город</div><div class="meta-value">${escapeHtml(profile.venue_city || '—')}</div></div>
        <div class="row"><div class="meta-label">Вместимость</div><div class="meta-value">${escapeHtml(profile.venue_capacity || '—')}</div></div>
        <div class="row"><div class="meta-label">Адрес</div><div class="meta-value">${escapeHtml(profile.venue_address || '—')}</div></div>
      </div>
    </article>
  `;
}

function renderSquadTab() {
  const payload = state.teamDetails.squad;
  const squad = Array.isArray(payload?.squad) ? payload.squad : [];

  if (!squad.length) {
    return `<article class="empty-state"><strong>Состав скоро появится</strong>Данные ещё не подтянулись из кэша.</article>`;
  }

  const groups = {
    Goalkeeper: [], Defender: [], Midfielder: [], Attacker: [], Forward: [], Other: [],
  };

  squad.forEach((player) => {
    const pos = player.position || 'Other';
    if (groups[pos]) groups[pos].push(player);
    else groups.Other.push(player);
  });

  const order = [
    ['Goalkeeper', 'Вратари'],
    ['Defender', 'Защитники'],
    ['Midfielder', 'Полузащитники'],
    ['Attacker', 'Нападающие'],
    ['Forward', 'Нападающие'],
    ['Other', 'Остальные'],
  ];

  return order.map(([key, title]) => {
    const players = groups[key] || [];
    if (!players.length) return '';
    return `
      <article class="panel squad-group">
        <h3 class="group-title">${title}</h3>
        ${players.map((player) => `
          <div class="card-row">
            <img class="player-avatar" src="${escapeHtml(player.photo_url || 'assets/logo-ofb.jpg')}" alt="${escapeHtml(player.player_name)}"
                 onerror="this.onerror=null;this.src='assets/logo-ofb.jpg'" />
            <div class="card-main">
              <div class="item-title" style="font-size:17px">${escapeHtml(player.player_name)}</div>
              <div class="player-meta">${player.number ? `#${escapeHtml(player.number)} • ` : ''}${escapeHtml(player.position || 'Игрок')}${player.age ? ` • ${escapeHtml(player.age)} лет` : ''}</div>
            </div>
          </div>
        `).join('')}
      </article>
    `;
  }).join('');
}

function renderTransfersTab() {
  const payload = state.teamDetails.transfers;
  const transfers = Array.isArray(payload?.transfers) ? payload.transfers : [];

  if (!transfers.length) {
    return `<article class="empty-state"><strong>Трансферы пока не загружены</strong>Проверь позже.</article>`;
  }

  return `
    <article class="panel">
      <h3 class="mini-title">Последние трансферы</h3>
      <div class="stack">
        ${transfers.map((t) => `
          <article class="card">
            <div class="item-title" style="font-size:18px">${escapeHtml(t.player_name || 'Игрок')}</div>
            <div class="item-meta">${escapeHtml(t.transfer_date || 'Дата не указана')} ${t.transfer_type ? `• ${escapeHtml(t.transfer_type)}` : ''}</div>
            <div class="item-meta" style="margin-top:8px">${escapeHtml(t.from_team || '—')} → ${escapeHtml(t.to_team || '—')}</div>
          </article>
        `).join('')}
      </div>
    </article>
  `;
}

function renderStatsTab() {
  const statsPayload = state.teamDetails.stats;
  const stats = Array.isArray(statsPayload?.stats) ? statsPayload.stats[0] : null;

  if (!stats) {
    return `<article class="empty-state"><strong>Статистика обновляется</strong>Данные скоро появятся.</article>`;
  }

  const points = Number(stats.wins || 0) * 3 + Number(stats.draws || 0);
  const goalDiff = Number(stats.goals_for || 0) - Number(stats.goals_against || 0);
  const form = String(stats.form || '').split('').filter(Boolean).slice(-10);

  return `
    <article class="panel">
      <h3 class="mini-title">Сезон ${escapeHtml(stats.season || '')}</h3>
      <div class="two-col">
        <div class="stat-box"><strong>${escapeHtml(stats.played || 0)}</strong><span>матчей</span></div>
        <div class="stat-box"><strong>${escapeHtml(points)}</strong><span>очков</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.wins || 0)}</strong><span>побед</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.draws || 0)}</strong><span>ничьих</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.losses || 0)}</strong><span>поражений</span></div>
        <div class="stat-box"><strong>${escapeHtml(goalDiff)}</strong><span>разница мячей</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.goals_for || 0)}</strong><span>забито</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.goals_against || 0)}</strong><span>пропущено</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.clean_sheets || 0)}</strong><span>сухих матчей</span></div>
        <div class="stat-box"><strong>${escapeHtml(stats.failed_to_score || 0)}</strong><span>без голов</span></div>
      </div>
    </article>

    <article class="panel">
      <h3 class="mini-title">Форма</h3>
      <div class="form-row">
        ${form.length
          ? form.map((letter) => `
              <span class="form-chip form-${/^[WDL]$/.test(letter) ? letter : 'other'}">${escapeHtml(letter)}</span>
            `).join('')
          : '<span class="muted">Форма пока не указана</span>'}
      </div>
    </article>
  `;
}

function renderNotifyTab() {
  const team = state.selectedTeam?.team;
  if (!team) return '';
  const flags = {
    news: true,
    goals: true,
    final: true,
    reminder: true,
    match_start: true,
    ...(state.selectedTeam.notify_flags || {}),
  };

  return `
    <article class="panel">
      <h3 class="mini-title">Уведомления</h3>
      <div class="switch-list">
        ${NOTIFY_DEFS.map((item) => `
          <div class="switch-row">
            <div class="switch-label">
              <strong>${item.title}</strong>
              <div class="muted">${item.desc}</div>
            </div>
            <button class="switch-control ${flags[item.key] ? 'on' : ''}" type="button"
                    aria-label="Переключить ${escapeHtml(item.title)}"
                    data-toggle-flag="${item.key}"></button>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

async function subscribeSelectedTeam(teamId) {
  const team = state.selectedTeam?.team;
  if (!team || Number(teamId) !== Number(team.team_id)) return;

  try {
    await postJson(API.SUBSCRIBE, {
      max_user_id: getMaxUserId(),
      team_id: team.team_id,
      team_name: team.team_name,
    });
    showToast('Подписка добавлена');
    await loadProfile({ silent: true });
    await openTeam(team.team_id);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Ошибка подписки');
  }
}

async function unsubscribeSelectedTeam(teamId) {
  const team = state.selectedTeam?.team;
  if (!team || Number(teamId) !== Number(team.team_id)) return;

  try {
    await postJson(API.UNSUBSCRIBE, {
      max_user_id: getMaxUserId(),
      team_id: team.team_id,
    });
    showToast('Подписка удалена');
    await loadProfile({ silent: true });
    await openTeam(team.team_id);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Ошибка отписки');
  }
}

async function toggleFlag(flagKey) {
  const team = state.selectedTeam?.team;
  if (!team) return;

  const nextFlags = {
    news: true,
    goals: true,
    final: true,
    reminder: true,
    match_start: true,
    ...(state.selectedTeam.notify_flags || {}),
  };

  nextFlags[flagKey] = !Boolean(nextFlags[flagKey]);

  try {
    await postJson(API.UPDATE_FLAGS, {
      max_user_id: getMaxUserId(),
      team_id: team.team_id,
      notify_flags: nextFlags,
    });
    state.selectedTeam.notify_flags = nextFlags;
    renderTeamScreen();
    await loadProfile({ silent: true });
    renderSubscriptions();
    showToast('Настройки обновлены');
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Ошибка обновления');
  }
}

function refreshCurrentView() {
  if (state.activeScreen === 'home') {
    loadProfile({ silent: false });
  } else if (state.activeScreen === 'search') {
    if (state.searchQuery) searchTeams(state.searchQuery);
    else showToast('Введите запрос для поиска');
  } else if (state.activeScreen === 'team' && state.selectedTeam?.team) {
    openTeam(state.selectedTeam.team.team_id);
  } else {
    loadProfile({ silent: false });
  }
}

function bindEvents() {
  els.tabHome.addEventListener('click', () => showScreen('home'));
  els.tabSearch.addEventListener('click', () => showScreen('search'));
  els.goSearchBtn.addEventListener('click', () => showScreen('search'));
  els.refreshBtn.addEventListener('click', refreshCurrentView);

  els.searchInput.addEventListener('input', (event) => scheduleSearch(event.target.value));

  document.addEventListener('click', async (event) => {
    const openBtn = event.target.closest('[data-open-team]');
    if (openBtn) {
      await openTeam(Number(openBtn.dataset.openTeam));
      return;
    }

    const backBtn = event.target.closest('[data-back]');
    if (backBtn) {
      showScreen(backBtn.dataset.back);
      return;
    }

    if (event.target.id === 'retryProfileBtn') {
      await loadProfile();
      return;
    }

    const teamTab = event.target.closest('[data-team-tab]');
    if (teamTab) {
      const key = teamTab.dataset.teamTab;
      state.activeTeamTab = key;
      renderTeamScreen();
      await loadTeamTab(key);
      return;
    }

    const subBtn = event.target.closest('[data-subscribe]');
    if (subBtn) {
      await subscribeSelectedTeam(Number(subBtn.dataset.subscribe));
      return;
    }

    const unsubBtn = event.target.closest('[data-unsubscribe]');
    if (unsubBtn) {
      await unsubscribeSelectedTeam(Number(unsubBtn.dataset.unsubscribe));
      return;
    }

    const toggleBtn = event.target.closest('[data-toggle-flag]');
    if (toggleBtn) {
      await toggleFlag(toggleBtn.dataset.toggleFlag);
    }
  });
}

async function init() {
  bindEvents();
  await loadProfile();
}

window.addEventListener('DOMContentLoaded', init);
