'use strict';

const PROFILE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-profile';
const TEAM_SEARCH_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-search';
const TEAM_CARD_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-card';
const SUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-subscribe';
const UPDATE_FLAGS_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-update-flags';
const UNSUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-unsubscribe';

const TEST_MAX_USER_ID = 5712595;

const state = {
  user: null,
  subscriptions: [],
  searchQuery: '',
  searchResults: [],
  selectedTeam: null,
  loading: false,
  searchLoading: false,
  error: null,
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
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
    const data = await postJson(PROFILE_API, { max_user_id });

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
    state.error = error.message;
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

  state.searchLoading = true;
  els.searchStatus.innerHTML = '<span class="small-loader"></span> Ищем команду...';

  try {
    const data = await postJson(TEAM_SEARCH_API, { q: state.searchQuery, query: state.searchQuery });
    state.searchResults = Array.isArray(data.teams) ? data.teams.map(normalizeTeam) : [];
    renderSearchResults(data.source || 'postgres');
  } catch (error) {
    console.error(error);
    els.searchStatus.textContent = `Ошибка поиска: ${error.message}`;
    els.searchResults.innerHTML = '';
  } finally {
    state.searchLoading = false;
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
  els.teamCard.innerHTML = `
    <div class="team-title-card glass-panel">
      <span class="small-loader"></span> Загружаем карточку команды...
    </div>
  `;

  try {
    const data = await postJson(TEAM_CARD_API, {
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
      <div class="status-pill">${card.is_subscribed ? 'Вы подписаны' : 'Нет подписки'}</div>
      <h1>${escapeHtml(team.team_name)}</h1>
      <p class="item-meta">ID команды: ${escapeHtml(team.team_id)}</p>

      <div class="team-actions">
        ${card.is_subscribed
          ? `<button class="danger-btn" type="button" data-unsubscribe="${team.team_id}">Отписаться</button>`
          : `<button class="primary-btn" type="button" data-subscribe="${team.team_id}">Подписаться</button>`}
      </div>
    </section>

    <section class="item-card">
      <div class="item-title">Ближайшие матчи</div>
      <div class="fixtures-list">
        ${renderFixtures(card.next_fixtures)}
      </div>
    </section>

    <section class="item-card" style="margin-top:12px;">
      <div class="item-title">Уведомления</div>
      <div class="item-meta">Переключатели сохраняются сразу.</div>
      <div class="flags-list">
        ${renderFlags(flags)}
      </div>
    </section>
  `;
}

function renderFixtures(fixtures) {
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return `<div class="empty-state">Ближайшие матчи пока не найдены</div>`;
  }

  return fixtures.map((match) => {
    const home = match.home_team || match.home_team_name || 'Хозяева';
    const away = match.away_team || match.away_team_name || 'Гости';
    const date = match.kickoff_utc || match.fixture_date || match.date;
    const status = match.status_short || 'NS';

    return `
      <div class="fixture-card">
        <div class="fixture-teams">${escapeHtml(home)} — ${escapeHtml(away)}</div>
        <div class="item-meta">${escapeHtml(formatDate(date))} · ${escapeHtml(status)}</div>
      </div>
    `;
  }).join('');
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

  if (!team) {
    toast('Команда не найдена в состоянии приложения');
    return;
  }

  try {
    await postJson(SUBSCRIBE_API, {
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
    await postJson(UNSUBSCRIBE_API, {
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

  const nextFlags = {
    ...card.notify_flags,
    [flag]: value,
  };

  card.notify_flags = nextFlags;
  renderTeamCard();

  try {
    const data = await postJson(UPDATE_FLAGS_API, {
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

    if (openBtn) openTeam(openBtn.dataset.openTeam);
    if (subscribeBtn) subscribeTeam(subscribeBtn.dataset.subscribe);
    if (unsubscribeBtn) unsubscribeTeam(unsubscribeBtn.dataset.unsubscribe);
  });

  document.addEventListener('change', (event) => {
    const flagInput = event.target.closest('[data-flag]');
    if (flagInput) updateNotifyFlags(flagInput.dataset.flag, flagInput.checked);
  });
}

bindEvents();
loadProfile();
