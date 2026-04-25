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

const state = {
  user: null,
  subscriptions: [],
  searchQuery: '',
  searchResults: [],
  selectedTeam: null,
  activeTeamTab: 'fixtures',
  teamDetails: {
    fixtures: null,
    profile: null,
    squad: null,
    transfers: null,
    stats: null,
  },
  teamLoading: {},
  teamErrors: {},
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
  teamCard: $('teamCard'),
  toast: $('toast'),
  tabHome: $('tabHome'),
  tabSearch: $('tabSearch'),
  goSearchBtn: $('goSearchBtn'),
  refreshBtn: $('refreshBtn'),
};

function normalizeTeam(raw) {
  return {
    team_id: Number(raw?.team_id ?? raw?.id),
    team_name: raw?.team_name || raw?.name || raw?.team?.name || 'Команда',
    league_id: raw?.league_id ?? null,
    league_name: raw?.league_name ?? null,
    notify_flags: raw?.notify_flags || {},
  };
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
    console.warn('MAX user detection failed:', error);
  }

  return TEST_MAX_USER_ID;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.ok === false) {
    throw new Error(data?.message || data?.error || `Ошибка API: ${res.status}`);
  }

  return data;
}

function showScreen(name) {
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

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return 'Дата уточняется';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function flagsSummary(flags = {}) {
  const labels = [];
  if (flags.news) labels.push('новости');
  if (flags.goals) labels.push('голы');
  if (flags.final) labels.push('финал');
  if (flags.reminder) labels.push('напоминание');
  if (flags.match_start) labels.push('старт');
  return labels.length ? labels.join(', ') : 'уведомления выключены';
}

async function loadProfile({ silent = false } = {}) {
  if (!silent) showScreen('loading');

  try {
    const max_user_id = getMaxUserId();
    const data = await postJson(API.PROFILE, { max_user_id });

    state.user = data.user || data.profile || null;
    state.subscriptions = Array.isArray(data.subscriptions)
      ? data.subscriptions.map(normalizeTeam)
      : Array.isArray(data.teams)
        ? data.teams.map(normalizeTeam)
        : [];

    renderProfile();
    renderSubscriptions();
    if (!silent) showScreen('home');
  } catch (error) {
    console.error(error);
    renderProfileError(error.message);
    showScreen('home');
  }
}

function renderProfile() {
  const name = state.user?.first_name || state.user?.username || 'болельщик';
  els.welcomeText.textContent = `${name}, выбирай команды и настраивай только нужные уведомления.`;
  els.subsCount.textContent = state.subscriptions.length;
  els.planText.textContent = state.user?.plan || 'free';
}

function renderProfileError(message) {
  els.welcomeText.textContent = 'Не удалось подключиться к backend. Проверь n8n endpoint или попробуй ещё раз.';
  els.subsCount.textContent = '—';
  els.planText.textContent = 'offline';
  els.subscriptionsList.innerHTML = `
    <div class="empty-state">
      <strong>Ошибка загрузки</strong><br />
      ${escapeHtml(message)}<br /><br />
      <button class="primary-btn" type="button" onclick="loadProfile()">Повторить</button>
    </div>
  `;
}

function renderSubscriptions() {
  if (!state.subscriptions.length) {
    els.subscriptionsList.innerHTML = `
      <div class="empty-state">
        Пока нет подписок.<br />
        Нажми «Найти» и добавь первую команду.
      </div>
    `;
    return;
  }

  els.subscriptionsList.innerHTML = state.subscriptions.map((team) => `
    <article class="item-card">
      <div class="item-card-row">
        <div>
          <div class="item-title">${escapeHtml(team.team_name)}</div>
          <div class="item-meta">${escapeHtml(flagsSummary(team.notify_flags))}</div>
        </div>
        <button class="soft-btn" type="button" data-open-team="${team.team_id}">Открыть</button>
      </div>
    </article>
  `).join('');
}

async function searchTeams(query) {
  state.searchQuery = query.trim();

  if (state.searchQuery.length < 2) {
    state.searchResults = [];
    els.searchStatus.textContent = 'Введите минимум 2 символа';
    els.searchResults.innerHTML = '';
    return;
  }

  els.searchStatus.innerHTML = '<span class="small-loader"></span> Ищем команду...';

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
    <article class="item-card">
      <div class="item-card-row">
        <div>
          <div class="item-title">${escapeHtml(team.team_name)}</div>
          <div class="item-meta">ID команды: ${escapeHtml(team.team_id)}</div>
        </div>
        <button class="primary-btn" type="button" data-open-team="${team.team_id}">Открыть</button>
      </div>
    </article>
  `).join('');
}

async function openTeam(teamId) {
  showScreen('team');
  state.activeTeamTab = 'fixtures';
  state.teamDetails = { fixtures: null, profile: null, squad: null, transfers: null, stats: null };
  state.teamLoading = {};
  state.teamErrors = {};

  els.teamCard.innerHTML = `
    <div class="team-title-card glass-panel">
      <span class="small-loader"></span> Загружаем карточку команды...
    </div>
  `;

  try {
    const data = await postJson(API.TEAM_CARD, {
      max_user_id: getMaxUserId(),
      team_id: Number(teamId),
    });

    state.selectedTeam = {
      ...data,
      team: normalizeTeam(data.team || data),
      is_subscribed: Boolean(data.is_subscribed || data.subscribed),
      notify_flags: data.notify_flags || data.team?.notify_flags || {},
      next_fixtures: data.next_fixtures || data.fixtures || data.matches || [],
    };

    renderTeamCard();
    await loadTeamTab('fixtures');
    await loadTeamTab('profile', { silent: true });
  } catch (error) {
    console.error(error);
    els.teamCard.innerHTML = `
      <div class="empty-state">
        Не удалось открыть карточку.<br />
        ${escapeHtml(error.message)}<br /><br />
        <button class="primary-btn" type="button" onclick="openTeam(${Number(teamId)})">Повторить</button>
      </div>
    `;
  }
}

function renderTeamCard() {
  const card = state.selectedTeam;
  if (!card?.team) return;
  const team = card.team;
  const flags = {
    news: true,
    goals: true,
    final: true,
    reminder: true,
    match_start: true,
    ...card.notify_flags,
  };

  els.teamCard.innerHTML = `
    <section class="team-title-card glass-panel">
      <div class="team-hero-row">
        <div>
          <div class="status-pill">${card.is_subscribed ? 'Вы подписаны' : 'Нет подписки'}</div>
          <h1>${escapeHtml(team.team_name)}</h1>
          <p class="item-meta">ID команды: ${escapeHtml(team.team_id)}</p>
        </div>
        ${renderTeamLogo()}
      </div>

      <div class="team-actions">
        ${card.is_subscribed
          ? `<button class="danger-btn" type="button" data-unsubscribe="${team.team_id}">Отписаться</button>`
          : `<button class="primary-btn" type="button" data-subscribe="${team.team_id}">Подписаться</button>`}
      </div>
    </section>

    <section class="item-card tabs-card">
      <div class="team-tabs" role="tablist">
        ${renderTabButton('fixtures', 'Матчи')}
        ${renderTabButton('profile', 'Профиль')}
        ${renderTabButton('squad', 'Состав')}
        ${renderTabButton('stats', 'Статистика')}
        ${renderTabButton('transfers', 'Трансферы')}
        ${renderTabButton('notify', 'Уведомления')}
      </div>
      <div id="teamTabContent" class="team-tab-content">
        ${renderActiveTab(flags)}
      </div>
    </section>
  `;
}

function renderTeamLogo() {
  const logo = state.teamDetails.profile?.profile?.logo_url || state.teamDetails.profile?.profile?.logo || '';
  if (!logo) return '<div class="team-logo-placeholder">OFB</div>';
  return `<img class="team-logo" src="${escapeHtml(logo)}" alt="Логотип команды" loading="lazy" />`;
}

function renderTabButton(key, label) {
  return `<button class="team-tab ${state.activeTeamTab === key ? 'active' : ''}" type="button" data-team-tab="${key}">${label}</button>`;
}

function renderActiveTab(flags) {
  const key = state.activeTeamTab;
  if (key === 'fixtures') return renderFixturesTab();
  if (key === 'profile') return renderProfileTab();
  if (key === 'squad') return renderSquadTab();
  if (key === 'stats') return renderStatsTab();
  if (key === 'transfers') return renderTransfersTab();
  if (key === 'notify') return renderNotifyTab(flags);
  return '';
}

async function selectTeamTab(key) {
  state.activeTeamTab = key;
  renderTeamCard();
  if (['fixtures', 'profile', 'squad', 'stats', 'transfers'].includes(key)) {
    await loadTeamTab(key);
  }
}

function teamPayload() {
  return {
    max_user_id: getMaxUserId(),
    team_id: Number(state.selectedTeam.team.team_id),
  };
}

async function loadTeamTab(key, { silent = false } = {}) {
  if (!state.selectedTeam?.team) return;
  if (state.teamDetails[key] || state.teamLoading[key]) return;

  const urlMap = {
    fixtures: API.TEAM_FIXTURES,
    profile: API.TEAM_PROFILE,
    squad: API.TEAM_SQUAD,
    transfers: API.TEAM_TRANSFERS,
    stats: API.TEAM_STATS,
  };

  if (!urlMap[key]) return;

  state.teamLoading[key] = true;
  delete state.teamErrors[key];
  if (!silent) renderTeamCard();

  try {
    state.teamDetails[key] = await postJson(urlMap[key], teamPayload());
  } catch (error) {
    console.error(error);
    state.teamErrors[key] = error.message;
  } finally {
    state.teamLoading[key] = false;
    renderTeamCard();
  }
}

function renderTabLoader(key) {
  if (state.teamLoading[key]) return `<div class="inline-state"><span class="small-loader"></span> Загружаем...</div>`;
  if (state.teamErrors[key]) return `<div class="empty-state">Ошибка: ${escapeHtml(state.teamErrors[key])}</div>`;
  return `<div class="inline-state">Данные загружаются...</div>`;
}

function renderFixturesTab() {
  if (!state.teamDetails.fixtures) {
    const fallback = state.selectedTeam?.next_fixtures || [];
    if (fallback.length && !state.teamLoading.fixtures) return renderFixturesSections(fallback);
    return renderTabLoader('fixtures');
  }

  return renderFixturesSections(state.teamDetails.fixtures.fixtures || []);
}

function renderFixturesSections(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return `<div class="empty-state">Матчи пока не найдены</div>`;
  }

  const now = Date.now();
  const normalized = fixtures.map(normalizeFixture).sort((a, b) => new Date(a.date) - new Date(b.date));
  const upcoming = normalized.filter((m) => new Date(m.date).getTime() >= now).slice(0, 8);
  const past = normalized.filter((m) => new Date(m.date).getTime() < now).reverse().slice(0, 6);

  return `
    <div class="subsection-title">Ближайшие</div>
    <div class="fixtures-list">${upcoming.length ? upcoming.map(renderFixtureCard).join('') : '<div class="empty-mini">Ближайших матчей нет</div>'}</div>
    <div class="subsection-title top-gap">Последние</div>
    <div class="fixtures-list">${past.length ? past.map(renderFixtureCard).join('') : '<div class="empty-mini">Прошедших матчей нет</div>'}</div>
  `;
}

function normalizeFixture(match) {
  return {
    home: match.home_team || match.home_team_name || 'Хозяева',
    away: match.away_team || match.away_team_name || 'Гости',
    date: match.kickoff_utc || match.fixture_date || match.date,
    status: match.status_short || 'NS',
    league: match.league_name || '',
    venue: match.venue || match.city || '',
    scoreHome: match.score_home ?? match.home_goals ?? null,
    scoreAway: match.score_away ?? match.away_goals ?? null,
  };
}

function renderFixtureCard(match) {
  const hasScore = match.scoreHome !== null && match.scoreAway !== null;
  return `
    <div class="fixture-card">
      <div class="fixture-line">
        <div class="fixture-teams">${escapeHtml(match.home)} — ${escapeHtml(match.away)}</div>
        ${hasScore ? `<div class="score-pill">${escapeHtml(match.scoreHome)}:${escapeHtml(match.scoreAway)}</div>` : ''}
      </div>
      <div class="item-meta">${escapeHtml(formatDate(match.date))} · ${escapeHtml(match.status)}</div>
      ${match.league || match.venue ? `<div class="item-meta">${escapeHtml([match.league, match.venue].filter(Boolean).join(' · '))}</div>` : ''}
    </div>
  `;
}

function renderProfileTab() {
  const data = state.teamDetails.profile;
  if (!data) return renderTabLoader('profile');
  if (data.profile_found === false || !data.profile) return `<div class="empty-state">Профиль команды обновляется</div>`;

  const p = data.profile;
  return `
    <div class="profile-grid">
      ${statBox('Страна', p.country)}
      ${statBox('Город', p.city || p.venue_city)}
      ${statBox('Основан', p.founded)}
      ${statBox('Стадион', p.venue_name)}
      ${statBox('Вместимость', p.venue_capacity ? Number(p.venue_capacity).toLocaleString('ru-RU') : null)}
      ${statBox('Адрес', p.venue_address)}
    </div>
  `;
}

function renderSquadTab() {
  const data = state.teamDetails.squad;
  if (!data) return renderTabLoader('squad');
  const squad = Array.isArray(data.squad) ? data.squad : [];
  if (data.squad_found === false || !squad.length) return `<div class="empty-state">Состав скоро появится</div>`;

  const groups = groupByPosition(squad);
  return Object.entries(groups).map(([position, players]) => `
    <div class="subsection-title">${escapeHtml(position)}</div>
    <div class="players-list">
      ${players.map(renderPlayer).join('')}
    </div>
  `).join('');
}

function groupByPosition(players) {
  const order = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Forward', 'Unknown'];
  const labels = {
    Goalkeeper: 'Вратари', Defender: 'Защитники', Midfielder: 'Полузащитники', Attacker: 'Атака', Forward: 'Атака', Unknown: 'Другие',
  };
  const map = {};
  players.forEach((player) => {
    const raw = player.position || 'Unknown';
    const key = order.includes(raw) ? raw : raw;
    const label = labels[key] || key;
    if (!map[label]) map[label] = [];
    map[label].push(player);
  });
  return map;
}

function renderPlayer(player) {
  return `
    <div class="player-row">
      ${player.photo_url ? `<img class="player-photo" src="${escapeHtml(player.photo_url)}" alt="" loading="lazy" />` : '<div class="player-photo placeholder">⚽</div>'}
      <div>
        <div class="item-title small-title">${escapeHtml(player.player_name)}</div>
        <div class="item-meta">${player.number ? `№ ${escapeHtml(player.number)} · ` : ''}${player.age ? `${escapeHtml(player.age)} лет` : 'возраст н/д'}</div>
      </div>
    </div>
  `;
}

function renderStatsTab() {
  const data = state.teamDetails.stats;
  if (!data) return renderTabLoader('stats');
  const stats = Array.isArray(data.stats) ? data.stats[0] : data.stats;
  if (data.stats_found === false || !stats) return `<div class="empty-state">Статистика обновляется</div>`;

  const wins = Number(stats.wins || 0);
  const draws = Number(stats.draws || 0);
  const goalsFor = Number(stats.goals_for || 0);
  const goalsAgainst = Number(stats.goals_against || 0);
  const points = wins * 3 + draws;
  const goalDiff = goalsFor - goalsAgainst;

  return `
    <div class="profile-grid">
      ${statBox('Матчи', stats.played)}
      ${statBox('Очки', points)}
      ${statBox('Победы', stats.wins)}
      ${statBox('Ничьи', stats.draws)}
      ${statBox('Поражения', stats.losses)}
      ${statBox('Голы', `${goalsFor}:${goalsAgainst}`)}
      ${statBox('Разница', goalDiff > 0 ? `+${goalDiff}` : goalDiff)}
      ${statBox('Сухие матчи', stats.clean_sheets)}
    </div>
    ${stats.form ? `<div class="form-strip">${String(stats.form).split('').slice(-12).map(renderFormBadge).join('')}</div>` : ''}
  `;
}

function renderFormBadge(letter) {
  const label = letter === 'W' ? 'В' : letter === 'D' ? 'Н' : letter === 'L' ? 'П' : letter;
  return `<span class="form-badge form-${escapeHtml(letter)}">${escapeHtml(label)}</span>`;
}

function renderTransfersTab() {
  const data = state.teamDetails.transfers;
  if (!data) return renderTabLoader('transfers');
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  if (data.transfers_found === false || !transfers.length) return `<div class="empty-state">Трансферы пока не загружены</div>`;

  return `<div class="transfers-list">${transfers.map((t) => `
    <div class="transfer-row">
      <div>
        <div class="item-title small-title">${escapeHtml(t.player_name)}</div>
        <div class="item-meta">${escapeHtml(t.from_team || '—')} → ${escapeHtml(t.to_team || '—')}</div>
        <div class="item-meta">${escapeHtml(formatDate(t.transfer_date))}</div>
      </div>
      <div class="transfer-type">${escapeHtml(t.transfer_type || '—')}</div>
    </div>
  `).join('')}</div>`;
}

function renderNotifyTab(flags) {
  return `
    <div class="item-title">Уведомления</div>
    <div class="item-meta">Переключатели сохраняются сразу.</div>
    <div class="flags-list">${renderFlags(flags)}</div>
  `;
}

function statBox(label, value) {
  return `
    <div class="stat-box">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? '—')}</strong>
    </div>
  `;
}

function renderFlags(flags) {
  const config = [
    ['news', 'Новости команды'],
    ['goals', 'Голы'],
    ['final', 'Финальный счёт'],
    ['reminder', 'Напоминание'],
    ['match_start', 'Начало матча'],
  ];

  return config.map(([key, label]) => `
    <label class="flag-row">
      <span class="flag-label">${label}</span>
      <span class="switch">
        <input type="checkbox" data-flag="${key}" ${flags[key] ? 'checked' : ''} ${state.selectedTeam?.is_subscribed ? '' : 'disabled'} />
        <span class="slider"></span>
      </span>
    </label>
  `).join('');
}

async function subscribeTeam(teamId) {
  const cardTeam = state.selectedTeam?.team;
  const foundTeam = state.searchResults.find((t) => Number(t.team_id) === Number(teamId));
  const team = cardTeam?.team_id ? cardTeam : foundTeam;

  if (!team) return toast('Команда не найдена в состоянии приложения');

  try {
    await postJson(API.SUBSCRIBE, {
      max_user_id: getMaxUserId(),
      team_id: Number(team.team_id),
      team_name: team.team_name,
    });

    toast('Подписка оформлена');
    await loadProfile({ silent: true });
    await openTeam(team.team_id);
  } catch (error) {
    console.error(error);
    toast(`Ошибка подписки: ${error.message}`);
  }
}

async function unsubscribeTeam(teamId) {
  try {
    await postJson(API.UNSUBSCRIBE, {
      max_user_id: getMaxUserId(),
      team_id: Number(teamId),
    });

    toast('Подписка удалена');
    await loadProfile({ silent: true });
    await openTeam(teamId);
  } catch (error) {
    console.error(error);
    toast(`Ошибка отписки: ${error.message}`);
  }
}

async function updateNotifyFlags(flag, value) {
  const card = state.selectedTeam;
  if (!card?.is_subscribed) {
    toast('Сначала подпишитесь на команду');
    renderTeamCard();
    return;
  }

  const nextFlags = { ...card.notify_flags, [flag]: value };
  card.notify_flags = nextFlags;
  renderTeamCard();

  try {
    const data = await postJson(API.UPDATE_FLAGS, {
      max_user_id: getMaxUserId(),
      team_id: Number(card.team.team_id),
      notify_flags: nextFlags,
    });

    state.selectedTeam.notify_flags = data.notify_flags || nextFlags;
    toast('Настройки сохранены');
    await loadProfile({ silent: true });
  } catch (error) {
    console.error(error);
    toast(`Ошибка сохранения: ${error.message}`);
    await openTeam(card.team.team_id);
  }
}

function debounce(fn, delay = 450) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function bindEvents() {
  els.goSearchBtn.addEventListener('click', () => showScreen('search'));
  els.tabHome.addEventListener('click', () => showScreen('home'));
  els.tabSearch.addEventListener('click', () => showScreen('search'));
  els.refreshBtn.addEventListener('click', () => loadProfile());

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.back || 'home'));
  });

  const debouncedSearch = debounce((event) => searchTeams(event.target.value), 500);
  els.searchInput.addEventListener('input', debouncedSearch);

  document.addEventListener('click', (event) => {
    const openBtn = event.target.closest('[data-open-team]');
    const subscribeBtn = event.target.closest('[data-subscribe]');
    const unsubscribeBtn = event.target.closest('[data-unsubscribe]');
    const teamTabBtn = event.target.closest('[data-team-tab]');

    if (openBtn) openTeam(openBtn.dataset.openTeam);
    if (subscribeBtn) subscribeTeam(subscribeBtn.dataset.subscribe);
    if (unsubscribeBtn) unsubscribeTeam(unsubscribeBtn.dataset.unsubscribe);
    if (teamTabBtn) selectTeamTab(teamTabBtn.dataset.teamTab);
  });

  document.addEventListener('change', (event) => {
    const flagInput = event.target.closest('[data-flag]');
    if (flagInput) updateNotifyFlags(flagInput.dataset.flag, flagInput.checked);
  });
}

bindEvents();
loadProfile();
