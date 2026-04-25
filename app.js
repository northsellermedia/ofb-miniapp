const PROFILE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-profile';
const TEAM_SEARCH_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-search';
const TEAM_CARD_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-card';
const SUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-subscribe';
const UPDATE_FLAGS_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-update-flags';
const UNSUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-unsubscribe';

const TEST_MAX_USER_ID = 5712595;
const SEARCH_DEBOUNCE_MS = 420;

const state = {
  view: 'home',
  maxUserId: null,
  initData: '',
  user: null,
  subscriptions: [],
  searchQuery: '',
  searchResults: [],
  selectedTeam: null,
  selectedTeamCard: null,
  loading: false,
  searching: false,
  actionLoading: false,
  error: null
};

const appEl = document.getElementById('app');
const toastEl = document.getElementById('toast');
const refreshButton = document.getElementById('refreshButton');
const connectionStatus = document.getElementById('connectionStatus');
let searchTimer = null;
let toastTimer = null;

function initMaxBridge() {
  const webApp = window.WebApp;

  try {
    webApp?.ready?.();
    webApp?.expand?.();
    webApp?.setHeaderColor?.('#090A10');
    webApp?.setBackgroundColor?.('#090A10');
  } catch (error) {
    console.warn('MAX bridge init skipped:', error);
  }

  state.maxUserId = getMaxUserId();
  state.initData = getMaxInitData();
}

function getMaxUserId() {
  const webApp = window.WebApp;
  const unsafe = webApp?.initDataUnsafe || {};
  const user = unsafe.user || {};

  const id = user.id || unsafe.user_id || unsafe.max_user_id || null;
  return Number(id || TEST_MAX_USER_ID);
}

function getMaxInitData() {
  return window.WebApp?.initData || '';
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      init_data: state.initData || getMaxInitData()
    })
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error('Backend вернул не JSON');
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Ошибка запроса ${response.status}`);
  }

  return data;
}

async function loadProfile({ silent = false } = {}) {
  state.loading = !silent;
  state.error = null;
  renderApp();

  try {
    const data = await postJson(PROFILE_API, {
      max_user_id: state.maxUserId
    });

    state.user = data.user || null;
    state.subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : [];
    setConnection(true);
  } catch (error) {
    state.error = error.message || 'Не удалось загрузить профиль';
    setConnection(false);
  } finally {
    state.loading = false;
    renderApp();
  }
}

async function searchTeams(query) {
  const q = String(query || '').trim();
  state.searchQuery = q;

  if (searchTimer) clearTimeout(searchTimer);

  if (q.length < 2) {
    state.searchResults = [];
    state.searching = false;
    renderApp();
    return;
  }

  state.searching = true;
  renderApp();

  searchTimer = setTimeout(async () => {
    try {
      const data = await postJson(TEAM_SEARCH_API, { q });
      state.searchResults = Array.isArray(data.teams) ? data.teams : [];
      setConnection(true);
    } catch (error) {
      showToast(error.message || 'Ошибка поиска');
      state.searchResults = [];
      setConnection(false);
    } finally {
      state.searching = false;
      renderApp();
      focusSearchInput();
    }
  }, SEARCH_DEBOUNCE_MS);
}

async function openTeam(teamId, teamName = '') {
  state.view = 'team';
  state.selectedTeam = { team_id: Number(teamId), team_name: teamName };
  state.selectedTeamCard = null;
  state.error = null;
  state.loading = true;
  syncNav();
  renderApp();

  try {
    const data = await postJson(TEAM_CARD_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId)
    });

    state.selectedTeamCard = data;
    setConnection(true);
  } catch (error) {
    state.error = error.message || 'Не удалось открыть команду';
    setConnection(false);
  } finally {
    state.loading = false;
    renderApp();
  }
}

async function subscribeTeam(team) {
  if (!team?.team_id) return;

  state.actionLoading = true;
  renderApp();

  try {
    await postJson(SUBSCRIBE_API, {
      max_user_id: state.maxUserId,
      first_name: state.user?.first_name || '',
      username: state.user?.username || '',
      team_id: Number(team.team_id),
      team_name: normalizeTeamName(team)
    });

    showToast('Подписка оформлена');
    await loadProfile({ silent: true });
    await openTeam(team.team_id, normalizeTeamName(team));
  } catch (error) {
    showToast(error.message || 'Не удалось подписаться');
  } finally {
    state.actionLoading = false;
    renderApp();
  }
}

async function updateNotifyFlags(teamId, flags) {
  state.actionLoading = true;
  renderApp();

  try {
    await postJson(UPDATE_FLAGS_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
      notify_flags: flags
    });

    showToast('Сохранено');
    await loadProfile({ silent: true });
    await openTeam(teamId);
  } catch (error) {
    showToast(error.message || 'Не удалось сохранить');
  } finally {
    state.actionLoading = false;
    renderApp();
  }
}

async function unsubscribeTeam(teamId) {
  state.actionLoading = true;
  renderApp();

  try {
    await postJson(UNSUBSCRIBE_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId)
    });

    showToast('Подписка удалена');
    await loadProfile({ silent: true });
    await openTeam(teamId);
  } catch (error) {
    showToast(error.message || 'Не удалось отписаться');
  } finally {
    state.actionLoading = false;
    renderApp();
  }
}

function renderApp() {
  if (state.loading && !state.selectedTeam) {
    appEl.innerHTML = renderSkeleton();
    return;
  }

  if (state.error && !state.user && state.view !== 'team') {
    appEl.innerHTML = renderError(state.error);
    return;
  }

  const views = {
    home: renderHome,
    teams: renderTeamsView,
    search: renderSearchView,
    team: renderTeamView,
    settings: renderSettingsView
  };

  appEl.innerHTML = (views[state.view] || renderHome)();
  bindViewEvents();
}

function renderHome() {
  const name = escapeHtml(state.user?.first_name || 'болельщик');
  const teamsCount = state.subscriptions.length;
  const nextFixture = getNearestFixtureFromSelectedOrSubs();

  return `
    <section class="hero-card glass-card">
      <div class="hero-eyebrow"><span>⚽</span><span>OFB Mini App</span></div>
      <h1 class="hero-title">Привет, ${name}</h1>
      <p class="hero-text">Команды, матчи и уведомления — в одном лёгком футбольном центре внутри MAX.</p>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Активные подписки</h2>
          <p class="section-subtitle">Быстрый доступ к твоим командам.</p>
        </div>
      </div>
      ${renderSubscriptionPreview()}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Ближайший матч</h2>
          <p class="section-subtitle">Данные берутся из Postgres cache.</p>
        </div>
      </div>
      ${nextFixture ? renderFixture(nextFixture) : renderEmpty('Матчей пока нет', 'Фоновый cache workflow подтянет расписание автоматически.')}
    </section>
  `;
}

function renderSubscriptionPreview() {
  if (!state.subscriptions.length) {
    return renderEmpty('Команд пока нет', 'Найди клуб и включи уведомления по голам, финалу и новостям.');
  }

  return `<div class="card-list">${state.subscriptions.slice(0, 4).map(renderTeamCardSmall).join('')}</div>`;
}

function renderTeamsView() {
  return `
    <section class="hero-card glass-card">
      <div class="hero-eyebrow"><span>★</span><span>Мои команды</span></div>
      <h1 class="hero-title">Подписки</h1>
      <p class="hero-text">Здесь команды, по которым включены уведомления. Настройки — внутри карточки команды.</p>
      <div class="hero-actions">
        <button class="btn primary" data-go="search" type="button">Добавить команду</button>
      </div>
    </section>

    <section class="section">
      ${state.subscriptions.length ? `<div class="card-list">${state.subscriptions.map(renderTeamCardSmall).join('')}</div>` : renderEmpty('Нет подписок', 'Добавь первую команду через поиск.')}
    </section>
  `;
}

function renderSearchView() {
  return `
    <section class="hero-card glass-card">
      <div class="hero-eyebrow"><span>⌕</span><span>Поиск команды</span></div>
      <h1 class="hero-title">Найти клуб</h1>
      <p class="hero-text">Поиск работает только по базе OFB. API-Football на кликах не используется.</p>
      <div class="search-box">
        <span class="search-icon">⌕</span>
        <input class="search-input" id="teamSearchInput" type="search" placeholder="Например, Zenit" value="${escapeHtml(state.searchQuery)}" autocomplete="off" />
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Результаты</h2>
          <p class="section-subtitle">Введите минимум 2 символа.</p>
        </div>
      </div>
      ${renderSearchResults()}
    </section>
  `;
}

function renderSearchResults() {
  if (state.searching) return renderEmpty('Ищу…', 'Проверяем локальный словарь команд.');
  if (state.searchQuery.trim().length < 2) return renderEmpty('Начни вводить название', 'Лучше использовать английское написание.');
  if (!state.searchResults.length) return renderEmpty('Ничего не найдено', 'Команды может пока не быть в словаре OFB.');

  return `<div class="card-list">${state.searchResults.map((team) => {
    const teamName = normalizeTeamName(team);
    const subscribed = isSubscribed(team.team_id);
    return `
      <article class="search-card">
        <div class="team-card-top">
          <div>
            <h3 class="team-name">${escapeHtml(teamName)}</h3>
            <p class="team-meta">ID ${escapeHtml(team.team_id || '')}</p>
          </div>
          <span class="badge">${subscribed ? '✓ Подписан' : 'Команда'}</span>
        </div>
        <div class="button-row">
          <button class="btn secondary" data-open-team="${escapeHtml(team.team_id)}" data-team-name="${escapeHtml(teamName)}" type="button">Открыть</button>
          <button class="btn primary" data-subscribe-team="${escapeHtml(team.team_id)}" data-team-name="${escapeHtml(teamName)}" type="button" ${subscribed || state.actionLoading ? 'disabled' : ''}>${subscribed ? 'Уже подписан' : 'Подписаться'}</button>
        </div>
      </article>
    `;
  }).join('')}</div>`;
}

function renderTeamView() {
  if (state.loading && !state.selectedTeamCard) return renderSkeleton();
  if (state.error) return renderError(state.error);

  const card = state.selectedTeamCard || {};
  const team = card.team || state.selectedTeam || {};
  const teamId = Number(team.team_id || state.selectedTeam?.team_id || 0);
  const teamName = normalizeTeamName(team);
  const isSubscribedToTeam = Boolean(card.is_subscribed);
  const flags = normalizeFlags(card.notify_flags || {});
  const fixtures = Array.isArray(card.next_fixtures) ? card.next_fixtures : [];

  return `
    <section class="hero-card glass-card">
      <div class="hero-eyebrow"><span>${isSubscribedToTeam ? '✓' : '+'}</span><span>${isSubscribedToTeam ? 'Подписка активна' : 'Команда'}</span></div>
      <h1 class="hero-title">${escapeHtml(teamName)}</h1>
      <p class="hero-text">Матчи и настройки уведомлений. Всё сохраняется через Postgres backend.</p>
      <div class="hero-actions">
        ${isSubscribedToTeam
          ? `<button class="btn danger" data-unsubscribe="${teamId}" type="button" ${state.actionLoading ? 'disabled' : ''}>Отписаться</button>`
          : `<button class="btn primary" data-subscribe-team="${teamId}" data-team-name="${escapeHtml(teamName)}" type="button" ${state.actionLoading ? 'disabled' : ''}>Подписаться</button>`}
        <button class="btn secondary" data-go="teams" type="button">Назад</button>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Ближайшие матчи</h2>
          <p class="section-subtitle">Расписание обновляется фоновым workflow.</p>
        </div>
      </div>
      ${fixtures.length ? `<div class="card-list">${fixtures.map(renderFixture).join('')}</div>` : renderEmpty('Матчей пока нет', 'После фонового обновления cache они появятся здесь.')}
    </section>

    <section class="section">
      <div class="section-head">
        <div>
          <h2 class="section-title">Уведомления</h2>
          <p class="section-subtitle">Можно менять отдельно для каждой команды.</p>
        </div>
      </div>
      <div class="settings-card">
        ${renderSwitch('goals', 'Голы', 'Гол твоей команды и пропущенный гол', flags.goals, teamId, isSubscribedToTeam)}
        ${renderSwitch('final', 'Финальный счёт', 'Итог матча после завершения', flags.final, teamId, isSubscribedToTeam)}
        ${renderSwitch('reminder', 'Напоминания', 'Перед началом матча', flags.reminder, teamId, isSubscribedToTeam)}
        ${renderSwitch('news', 'Новости', 'Важные новости по команде', flags.news, teamId, isSubscribedToTeam)}
      </div>
    </section>
  `;
}

function renderSettingsView() {
  return `
    <section class="hero-card glass-card">
      <div class="hero-eyebrow"><span>⚙</span><span>Настройки</span></div>
      <h1 class="hero-title">OFB</h1>
      <p class="hero-text">Мини-приложение работает как быстрый слой над Postgres cache. API-Football остаётся только в фоновых workflow.</p>
    </section>

    <section class="section">
      <div class="settings-card">
        <div class="settings-line"><span>Пользователь</span><strong>${escapeHtml(state.user?.first_name || '—')}</strong></div>
        <div class="settings-line"><span>MAX ID</span><strong>${escapeHtml(state.maxUserId || '—')}</strong></div>
        <div class="settings-line"><span>Подписок</span><strong>${state.subscriptions.length}</strong></div>
        <div class="settings-line"><span>Источник</span><strong>Postgres cache</strong></div>
        <div class="settings-line"><span>Версия</span><strong>MVP</strong></div>
      </div>
    </section>
  `;
}

function renderTeamCardSmall(team) {
  const flags = normalizeFlags(team.notify_flags || {});
  const enabled = Object.entries(flags).filter(([, value]) => value).map(([key]) => flagLabel(key));
  const teamName = normalizeTeamName(team);

  return `
    <article class="team-card">
      <div class="team-card-top">
        <div>
          <h3 class="team-name">${escapeHtml(teamName)}</h3>
          <p class="team-meta">${escapeHtml(team.league_name || 'Уведомления OFB')}</p>
        </div>
        <span class="badge">✓ Активна</span>
      </div>
      <div class="badges">
        ${(enabled.length ? enabled : ['настройки']).slice(0, 4).map((label) => `<span class="badge">${escapeHtml(label)}</span>`).join('')}
      </div>
      <div class="button-row">
        <button class="btn secondary" data-open-team="${escapeHtml(team.team_id)}" data-team-name="${escapeHtml(teamName)}" type="button">Открыть</button>
      </div>
    </article>
  `;
}

function renderFixture(fixture) {
  const home = fixture.home_team || fixture.home || 'Команда 1';
  const away = fixture.away_team || fixture.away || 'Команда 2';
  const kickoff = fixture.kickoff_utc || fixture.fixture_date || fixture.date || null;
  const status = fixture.status_short || fixture.status || 'NS';

  return `
    <article class="fixture-card">
      <div class="fixture-main">
        <div class="fixture-title">${escapeHtml(home)} — ${escapeHtml(away)}</div>
        <div class="fixture-time">${escapeHtml(formatDateTime(kickoff))}</div>
      </div>
      <div class="fixture-status">${escapeHtml(status)}</div>
    </article>
  `;
}

function renderSwitch(key, title, desc, checked, teamId, enabled) {
  return `
    <div class="switch-row">
      <div>
        <div class="switch-title">${escapeHtml(title)}</div>
        <div class="switch-desc">${escapeHtml(desc)}</div>
      </div>
      <label class="switch">
        <input type="checkbox" data-flag="${escapeHtml(key)}" data-team-id="${teamId}" ${checked ? 'checked' : ''} ${!enabled || state.actionLoading ? 'disabled' : ''}>
        <span class="slider"></span>
      </label>
    </div>
  `;
}

function renderEmpty(title, text) {
  return `
    <div class="empty-card">
      <div class="empty-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(text)}</div>
    </div>
  `;
}

function renderError(message) {
  return `
    <section class="error-card">
      <strong>Ошибка</strong>
      <div style="margin-top: 6px;">${escapeHtml(message)}</div>
      <div class="button-row" style="margin-top: 14px;">
        <button class="btn secondary" id="retryButton" type="button">Повторить</button>
      </div>
    </section>
  `;
}

function renderSkeleton() {
  return `
    <section class="hero-card glass-card skeleton-block">
      <div class="skeleton-line big"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </section>
    <section class="section skeleton-block">
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </section>
  `;
}

function bindViewEvents() {
  appEl.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.go));
  });

  appEl.querySelectorAll('[data-open-team]').forEach((button) => {
    button.addEventListener('click', () => openTeam(button.dataset.openTeam, button.dataset.teamName || ''));
  });

  appEl.querySelectorAll('[data-subscribe-team]').forEach((button) => {
    button.addEventListener('click', () => subscribeTeam({
      team_id: Number(button.dataset.subscribeTeam),
      team_name: button.dataset.teamName || state.selectedTeam?.team_name || state.selectedTeamCard?.team?.team_name || ''
    }));
  });

  appEl.querySelectorAll('[data-unsubscribe]').forEach((button) => {
    button.addEventListener('click', () => unsubscribeTeam(Number(button.dataset.unsubscribe)));
  });

  appEl.querySelectorAll('[data-flag]').forEach((input) => {
    input.addEventListener('change', () => {
      const currentFlags = normalizeFlags(state.selectedTeamCard?.notify_flags || {});
      const nextFlags = { ...currentFlags, [input.dataset.flag]: input.checked };
      updateNotifyFlags(Number(input.dataset.teamId), nextFlags);
    });
  });

  const searchInput = document.getElementById('teamSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => searchTeams(event.target.value));
  }

  const retryButton = document.getElementById('retryButton');
  if (retryButton) retryButton.addEventListener('click', () => loadProfile());
}

function bindGlobalEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  refreshButton?.addEventListener('click', async () => {
    await loadProfile({ silent: true });
    if (state.selectedTeam?.team_id && state.view === 'team') {
      await openTeam(state.selectedTeam.team_id, state.selectedTeam.team_name || '');
    }
    showToast('Обновлено');
  });
}

function setView(view) {
  state.view = view;
  state.error = null;
  syncNav();
  renderApp();
  if (view === 'search') focusSearchInput();
}

function syncNav() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view || (state.view === 'team' && button.dataset.view === 'teams'));
  });
}

function focusSearchInput() {
  if (state.view !== 'search') return;
  setTimeout(() => {
    const input = document.getElementById('teamSearchInput');
    if (input && document.activeElement !== input) {
      const length = input.value.length;
      input.focus({ preventScroll: true });
      input.setSelectionRange(length, length);
    }
  }, 0);
}

function normalizeFlags(flags) {
  return {
    goals: Boolean(flags.goals ?? true),
    final: Boolean(flags.final ?? true),
    reminder: Boolean(flags.reminder ?? true),
    news: Boolean(flags.news ?? true),
    ...flags
  };
}

function flagLabel(key) {
  const labels = {
    goals: 'голы',
    final: 'финал',
    reminder: 'напоминания',
    news: 'новости',
    subs: 'замены',
    cards: 'карточки',
    digest: 'дайджест',
    lineups: 'составы',
    injuries: 'травмы'
  };
  return labels[key] || key;
}

function normalizeTeamName(team) {
  return String(team?.team_name || team?.name || team?.team || 'Команда').trim();
}

function isSubscribed(teamId) {
  return state.subscriptions.some((item) => Number(item.team_id) === Number(teamId));
}

function getNearestFixtureFromSelectedOrSubs() {
  const fixtures = state.selectedTeamCard?.next_fixtures;
  if (Array.isArray(fixtures) && fixtures.length) return fixtures[0];
  return null;
}

function formatDateTime(value) {
  if (!value) return 'Время уточняется';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2200);
}

function setConnection(ok) {
  if (!connectionStatus) return;
  connectionStatus.innerHTML = `<span class="status-dot"></span>${ok ? 'Online' : 'Offline'}`;
  connectionStatus.style.opacity = ok ? '1' : '.75';
}

async function bootstrap() {
  initMaxBridge();
  bindGlobalEvents();
  syncNav();
  await loadProfile();
}

bootstrap();
