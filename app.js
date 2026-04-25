const PROFILE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-profile';
const TEAM_SEARCH_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-search';
const TEAM_CARD_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-card';
const SUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-subscribe';
const UPDATE_FLAGS_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-update-flags';
const UNSUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-unsubscribe';

const TEST_MAX_USER_ID = 5712595;

const state = {
  user: null,
  maxUserId: null,
  teams: [],
  searchResults: [],
  currentTeamCard: null,
  currentScreen: 'home',
  previousScreen: 'home',
  loading: false,
};

const screens = ['home', 'teams', 'search', 'team', 'settings'];

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  initMax();
  loadProfile();
});

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => showScreen(button.dataset.tab));
  });

  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => showScreen(button.dataset.nav));
  });

  document.querySelectorAll('[data-action="refresh"]').forEach((button) => {
    button.addEventListener('click', () => loadProfile(true));
  });

  document.getElementById('searchButton')?.addEventListener('click', searchTeams);

  document.getElementById('searchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchTeams();
  });

  document.getElementById('backButton')?.addEventListener('click', goBack);

  document.getElementById('quietSwitch')?.addEventListener('click', () => {
    showToast('Тихий режим подключим после проверки MVP.');
  });
}

function getWebApp() {
  return window.WebApp || null;
}

function initMax() {
  const webApp = getWebApp();

  if (!webApp) {
    setText('statusPill', 'Browser');
    setText('userLine', 'Тестовый режим');
    return;
  }

  try {
    webApp.ready?.();
    webApp.expand?.();
  } catch (e) {}

  const unsafeUser = webApp.initDataUnsafe?.user || null;

  if (unsafeUser?.first_name || unsafeUser?.name) {
    setText('userLine', unsafeUser.first_name || unsafeUser.name);
  }

  setText('statusPill', 'MAX');
}

function getMaxUserId() {
  const unsafeUser = getWebApp()?.initDataUnsafe?.user || null;

  const fromMax = Number(
    unsafeUser?.id ||
    unsafeUser?.user_id ||
    unsafeUser?.max_user_id ||
    0
  );

  return fromMax || TEST_MAX_USER_ID;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { ok: false, raw: text };
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }

  return data;
}

function showScreen(name, options = {}) {
  if (!screens.includes(name)) name = 'home';

  if (!options.silent) {
    state.previousScreen = state.currentScreen;
  }

  state.currentScreen = name;

  screens.forEach((screen) => {
    document.getElementById(`screen-${screen}`)?.classList.toggle('is-hidden', screen !== name);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === name);
  });

  document.getElementById('backButton')?.classList.toggle('is-hidden', name === 'home');

  if (name === 'teams') renderTeams();
  if (name === 'home') renderHomeTeams();
}

function goBack() {
  if (state.currentScreen === 'team') {
    showScreen(state.previousScreen === 'search' ? 'search' : 'teams', { silent: true });
    return;
  }

  showScreen('home', { silent: true });
}

async function loadProfile(showSuccess = false) {
  state.maxUserId = getMaxUserId();

  try {
    setText('statusPill', 'Sync');

    const data = await postJson(PROFILE_API, {
      max_user_id: state.maxUserId,
    });

    state.user = data.user || null;
    state.teams = normalizeSubscriptions(data.subscriptions || data.teams || []);

    const name =
      data.user?.first_name ||
      data.user?.username ||
      getWebApp()?.initDataUnsafe?.user?.first_name ||
      getWebApp()?.initDataUnsafe?.user?.name ||
      'Около футбола | OFB';

    setText('userLine', name);
    setText('statusPill', 'Online');
    setText('quickTeams', `${state.teams.length} подписки`);

    renderHomeTeams();
    renderTeams();

    if (showSuccess) showToast('Данные обновлены.');
    return data;
  } catch (error) {
    setText('statusPill', 'Error');
    setText('quickTeams', 'Ошибка загрузки');
    renderError('homeTeams', 'Не удалось загрузить профиль', error.message);
    renderError('teamsList', 'Не удалось загрузить команды', error.message);
    return null;
  }
}

function normalizeSubscriptions(items) {
  return (items || [])
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      team_id: Number(item.team_id),
      team_name: item.team_name || item.name || `Команда ${item.team_id}`,
      league_id: item.league_id || null,
      league_name: item.league_name || '',
      notify_flags: item.notify_flags || {},
    }))
    .filter((item) => item.team_id);
}

function normalizeSearchTeams(items) {
  return (items || [])
    .filter(Boolean)
    .map((item) => ({
      team_id: Number(item.team_id || item.id),
      team_name: item.team_name || item.name || `Команда ${item.team_id || item.id}`,
    }))
    .filter((item) => item.team_id);
}

function renderHomeTeams() {
  const box = document.getElementById('homeTeams');
  if (!box) return;

  const teams = state.teams.slice(0, 3);

  if (!teams.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏟️</div>
        <div class="empty-title">Подписок пока нет</div>
        <div class="empty-text">Найди команду и включи уведомления в пару касаний.</div>
      </div>
    `;
    return;
  }

  box.innerHTML = teams.map(renderTeamListCard).join('');
}

function renderTeams() {
  const box = document.getElementById('teamsList');
  if (!box) return;

  if (!state.teams.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏟️</div>
        <div class="empty-title">Команд пока нет</div>
        <div class="empty-text">Добавь первую команду через поиск.</div>
      </div>
    `;
    return;
  }

  box.innerHTML = state.teams.map(renderTeamListCard).join('');
}

function renderTeamListCard(team) {
  return `
    <button class="entity-card" onclick="openTeam(${team.team_id}, 'teams')">
      <div class="entity-card-row">
        <div class="entity-main">
          <div class="entity-title">⚽ ${escapeHtml(team.team_name)}</div>
          <div class="entity-subtitle">${escapeHtml(team.league_name || 'Подписка активна')}</div>
        </div>
        <div class="chevron">›</div>
      </div>
    </button>
  `;
}

async function searchTeams() {
  const input = document.getElementById('searchInput');
  const box = document.getElementById('searchResults');
  if (!input || !box) return;

  const q = input.value.trim();

  if (!q) {
    renderError('searchResults', 'Введите название команды', 'Например: zenit, spartak, barcelona.');
    return;
  }

  box.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⏳</div>
      <div class="empty-title">Ищу в базе OFB</div>
      <div class="empty-text">Без запросов в API-Football.</div>
    </div>
  `;

  try {
    const data = await postJson(TEAM_SEARCH_API, { q });
    const teams = normalizeSearchTeams(data.teams || []);
    state.searchResults = teams;

    if (!teams.length) {
      box.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🙈</div>
          <div class="empty-title">Ничего не найдено</div>
          <div class="empty-text">Попробуй другое название или английское написание.</div>
        </div>
      `;
      return;
    }

    box.innerHTML = teams.map((team) => `
      <button class="entity-card" onclick="openTeam(${team.team_id}, 'search')">
        <div class="entity-card-row">
          <div class="entity-main">
            <div class="entity-title">⚽ ${escapeHtml(team.team_name)}</div>
            <div class="entity-subtitle">ID команды: ${team.team_id}</div>
          </div>
          <div class="chevron">›</div>
        </div>
      </button>
    `).join('');
  } catch (error) {
    renderError('searchResults', 'Ошибка поиска', error.message);
  }
}

async function openTeam(teamId, fromScreen = 'teams') {
  state.maxUserId = getMaxUserId();
  state.previousScreen = fromScreen;
  showScreen('team', { silent: true });

  const area = document.getElementById('teamCardArea');
  if (area) {
    area.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <div class="empty-title">Загружаю карточку</div>
        <div class="empty-text">Берём данные из Postgres cache.</div>
      </div>
    `;
  }

  try {
    const data = await postJson(TEAM_CARD_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
    });

    state.currentTeamCard = normalizeTeamCard(data, teamId);
    renderTeamCard(state.currentTeamCard);
  } catch (error) {
    renderError('teamCardArea', 'Ошибка карточки команды', error.message);
  }
}

function normalizeTeamCard(data, fallbackTeamId) {
  const team = data.team || {};

  return {
    team_id: Number(team.team_id || data.team_id || fallbackTeamId),
    team_name: team.team_name || data.team_name || findTeamName(fallbackTeamId) || `Команда ${fallbackTeamId}`,
    is_subscribed: Boolean(data.is_subscribed),
    notify_flags: normalizeNotifyFlags(data.notify_flags || {}),
    next_fixtures: data.next_fixtures || data.fixtures || [],
  };
}

function normalizeNotifyFlags(flags) {
  return {
    goals: Boolean(flags.goals),
    final: Boolean(flags.final),
    reminder: Boolean(flags.reminder),
    news: Boolean(flags.news),
    ...flags,
  };
}

function renderTeamCard(card) {
  const area = document.getElementById('teamCardArea');
  if (!area) return;

  const nextFixture = card.next_fixtures?.[0] || null;
  const fixtures = card.next_fixtures || [];
  const flags = card.notify_flags || {};

  area.innerHTML = `
    <div class="team-hero">
      <div class="team-title-row">
        <div>
          <div class="team-kicker">Карточка команды</div>
          <div class="team-title">${escapeHtml(card.team_name)}</div>
        </div>
        <div class="subscription-badge ${card.is_subscribed ? 'on' : 'off'}">
          ${card.is_subscribed ? '● Подписка' : '○ Не подписан'}
        </div>
      </div>

      <div class="team-actions">
        ${
          card.is_subscribed
            ? `<button class="danger-button" onclick="unsubscribeTeam(${card.team_id})">Отписаться</button>`
            : `<button class="primary-button" onclick="subscribeTeam(${card.team_id}, '${escapeJs(card.team_name)}')">Подписаться</button>`
        }
      </div>
    </div>

    <div class="section-head">
      <h2>Ближайший матч</h2>
    </div>

    ${nextFixture ? renderFixtureCard(nextFixture) : renderNoFixtures()}

    ${
      card.is_subscribed
        ? `
          <div class="section-head">
            <h2>Уведомления</h2>
          </div>

          ${renderFlagRow(card.team_id, 'goals', '⚽ Голы', 'Уведомления о голах', flags.goals)}
          ${renderFlagRow(card.team_id, 'final', '🏁 Итог матча', 'Финальный результат', flags.final)}
          ${renderFlagRow(card.team_id, 'reminder', '⏰ Напоминание', 'Перед началом матча', flags.reminder)}
          ${renderFlagRow(card.team_id, 'news', '📰 Новости', 'Важные новости по команде', flags.news)}
        `
        : ''
    }

    <div class="section-head">
      <h2>Доступно позже</h2>
    </div>

    <div class="notice-card">
      <div class="entity-title">📊 Состав, трансферы и статистика</div>
      <div class="entity-subtitle">Добавим после backend/cache workflow. Пользовательские клики не будут тратить API-Football.</div>
    </div>

    ${
      fixtures.length > 1
        ? `
          <div class="section-head">
            <h2>Следующие матчи</h2>
          </div>
          <div class="stack">${fixtures.slice(1, 5).map(renderFixtureCard).join('')}</div>
        `
        : ''
    }
  `;
}

function renderFixtureCard(fixture) {
  const home = fixture.home_team || fixture.home || 'Хозяева';
  const away = fixture.away_team || fixture.away || 'Гости';
  const date = formatDate(fixture.kickoff_utc || fixture.date || fixture.kickoff || '');
  const status = fixture.status_short || fixture.status || '';

  return `
    <div class="match-card">
      <div class="match-label">${escapeHtml(status || 'Матч')}</div>
      <div class="match-title">${escapeHtml(home)} — ${escapeHtml(away)}</div>
      <div class="match-meta">${escapeHtml(date)}</div>
    </div>
  `;
}

function renderNoFixtures() {
  return `
    <div class="match-card">
      <div class="match-label">Кэш</div>
      <div class="match-title">Матчей пока нет</div>
      <div class="match-meta">Данные подтянет фоновый workflow Fixture Cache.</div>
    </div>
  `;
}

function renderFlagRow(teamId, flagKey, title, subtitle, value) {
  return `
    <div class="flag-row">
      <div>
        <div class="flag-title">${escapeHtml(title)}</div>
        <div class="flag-text">${escapeHtml(subtitle)}</div>
      </div>
      <button
        class="switch ${value ? 'is-on' : ''}"
        onclick="toggleNotifyFlag(${teamId}, '${flagKey}')"
        aria-label="${escapeHtml(title)}"
      ></button>
    </div>
  `;
}

async function subscribeTeam(teamId, teamName) {
  state.maxUserId = getMaxUserId();

  const resolvedName =
    teamName ||
    state.currentTeamCard?.team_name ||
    findTeamName(teamId) ||
    `Команда ${teamId}`;

  try {
    await postJson(SUBSCRIBE_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
      team_name: resolvedName,
    });

    showToast(`Подписка на ${resolvedName} включена.`);
    await loadProfile();
    await openTeam(teamId, 'team');
  } catch (error) {
    showToast(`Не удалось подписаться: ${error.message}`);
  }
}

async function unsubscribeTeam(teamId) {
  state.maxUserId = getMaxUserId();

  try {
    await postJson(UNSUBSCRIBE_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
    });

    showToast('Подписка отключена.');
    await loadProfile();
    await openTeam(teamId, 'team');
  } catch (error) {
    showToast(`Не удалось отписаться: ${error.message}`);
  }
}

async function toggleNotifyFlag(teamId, flagKey) {
  if (!state.currentTeamCard) return;

  state.maxUserId = getMaxUserId();

  const currentFlags = normalizeNotifyFlags(state.currentTeamCard.notify_flags || {});
  const nextFlags = {
    ...currentFlags,
    [flagKey]: !Boolean(currentFlags[flagKey]),
  };

  try {
    const data = await postJson(UPDATE_FLAGS_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
      notify_flags: {
        goals: Boolean(nextFlags.goals),
        final: Boolean(nextFlags.final),
        reminder: Boolean(nextFlags.reminder),
        news: Boolean(nextFlags.news),
      },
    });

    const updatedFlags =
      data.subscription?.notify_flags ||
      data.notify_flags ||
      nextFlags;

    state.currentTeamCard.notify_flags = normalizeNotifyFlags(updatedFlags);
    renderTeamCard(state.currentTeamCard);
    await loadProfile();

    showToast('Настройки обновлены.');
  } catch (error) {
    showToast(`Не удалось обновить настройки: ${error.message}`);
  }
}

function findTeamName(teamId) {
  const id = Number(teamId);

  const fromSubscriptions = state.teams.find((team) => Number(team.team_id) === id);
  if (fromSubscriptions?.team_name) return fromSubscriptions.team_name;

  const fromSearch = state.searchResults.find((team) => Number(team.team_id) === id);
  if (fromSearch?.team_name) return fromSearch.team_name;

  return '';
}

function renderError(targetId, title, message) {
  const box = document.getElementById(targetId);
  if (!box) return;

  box.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-title">${escapeHtml(title)}</div>
      <div class="empty-text">${escapeHtml(message || 'Неизвестная ошибка')}</div>
    </div>
  `;
}

function formatDate(value) {
  if (!value) return 'Дата не указана';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }) + ' МСК';
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove('is-hidden');

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.add('is-hidden');
  }, 2600);
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJs(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}
