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

  document.getElementById('refreshButton')?.addEventListener('click', () => loadProfile(true));
  document.getElementById('searchButton')?.addEventListener('click', searchTeams);
  document.getElementById('backButton')?.addEventListener('click', goBack);

  document.getElementById('searchInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchTeams();
  });

  document.getElementById('quietSwitch')?.addEventListener('click', () => {
    showToast('Тихий режим подключим отдельным backend endpoint.');
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

  if (name === 'home') renderHomeTeams();
  if (name === 'teams') renderTeams();
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
  } catch (error) {
    setText('statusPill', 'Error');
    setText('quickTeams', 'Ошибка');
    renderError('homeTeams', 'Не удалось загрузить профиль', error.message);
    renderError('teamsList', 'Не удалось загрузить команды', error.message);
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
      <div class="empty">
        <span>🏟️</span>
        <b>Подписок пока нет</b>
        <p>Найди команду и включи уведомления.</p>
      </div>
    `;
    return;
  }

  box.innerHTML = teams.map((team) => renderTeamRow(team, 'teams')).join('');
}

function renderTeams() {
  const box = document.getElementById('teamsList');
  if (!box) return;

  if (!state.teams.length) {
    box.innerHTML = `
      <div class="empty">
        <span>🏟️</span>
        <b>Команд пока нет</b>
        <p>Добавь первую команду через поиск.</p>
      </div>
    `;
    return;
  }

  box.innerHTML = state.teams.map((team) => renderTeamRow(team, 'teams')).join('');
}

function renderTeamRow(team, source) {
  return `
    <button class="row-card" onclick="openTeam(${team.team_id}, '${source}')">
      <div class="row-content">
        <div>
          <div class="row-title">⚽ ${escapeHtml(team.team_name)}</div>
          <div class="row-sub">${escapeHtml(team.league_name || 'Подписка активна')}</div>
        </div>
        <div class="chev">›</div>
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
    <div class="empty">
      <span>⏳</span>
      <b>Ищу в базе OFB</b>
      <p>Без запросов в API-Football.</p>
    </div>
  `;

  try {
    const data = await postJson(TEAM_SEARCH_API, { q });
    const teams = normalizeSearchTeams(data.teams || []);
    state.searchResults = teams;

    if (!teams.length) {
      box.innerHTML = `
        <div class="empty">
          <span>🙈</span>
          <b>Ничего не найдено</b>
          <p>Попробуй другое название или английское написание.</p>
        </div>
      `;
      return;
    }

    box.innerHTML = teams.map((team) => `
      <button class="row-card" onclick="openTeam(${team.team_id}, 'search')">
        <div class="row-content">
          <div>
            <div class="row-title">⚽ ${escapeHtml(team.team_name)}</div>
            <div class="row-sub">ID команды: ${team.team_id}</div>
          </div>
          <div class="chev">›</div>
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

  const area = document.getElementById('teamArea');
  if (area) {
    area.innerHTML = `
      <div class="empty">
        <span>⏳</span>
        <b>Загружаю карточку</b>
        <p>Берём данные из Postgres cache.</p>
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
    renderError('teamArea', 'Ошибка карточки команды', error.message);
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
  const area = document.getElementById('teamArea');
  if (!area) return;

  const fixtures = card.next_fixtures || [];
  const nextFixture = fixtures[0] || null;
  const flags = card.notify_flags || {};

  area.innerHTML = `
    <div class="team-head">
      <div class="team-top">
        <div>
          <div class="team-label">Карточка команды</div>
          <div class="team-name">${escapeHtml(card.team_name)}</div>
        </div>
        <div class="sub-badge ${card.is_subscribed ? 'on' : 'off'}">
          ${card.is_subscribed ? 'Подписка' : 'Не подписан'}
        </div>
      </div>

      <div class="team-actions">
        ${
          card.is_subscribed
            ? `<button class="danger" onclick="unsubscribeTeam(${card.team_id})">Отписаться</button>`
            : `<button class="primary" onclick="subscribeTeam(${card.team_id}, '${escapeJs(card.team_name)}')">Подписаться</button>`
        }
      </div>
    </div>

    <div class="section-title"><h2>Ближайший матч</h2></div>
    ${nextFixture ? renderFixture(nextFixture) : renderNoFixture()}

    <div class="section-title"><h2>Разделы</h2></div>
    <div class="action-grid">
      <button class="action-button" onclick="scrollToBlock('fixturesBlock')"><span>📅</span><b>Расписание</b><em>Из кэша</em></button>
      <button class="action-button" onclick="scrollToBlock('notifyBlock')"><span>🔔</span><b>Уведомления</b><em>${card.is_subscribed ? 'Настроить' : 'После подписки'}</em></button>
      <button class="action-button" onclick="comingSoon('Состав')"><span>👥</span><b>Состав</b><em>Скоро</em></button>
      <button class="action-button" onclick="comingSoon('Трансферы')"><span>🔄</span><b>Трансферы</b><em>Скоро</em></button>
      <button class="action-button" onclick="comingSoon('Статистика')"><span>📊</span><b>Статистика</b><em>Скоро</em></button>
      <button class="action-button" onclick="comingSoon('Live')"><span>⚡</span><b>Live</b><em>Скоро</em></button>
    </div>

    ${
      card.is_subscribed
        ? `
          <div id="notifyBlock" class="section-title"><h2>Уведомления</h2></div>
          ${renderFlag(card.team_id, 'goals', '⚽ Голы', 'Уведомления о голах', flags.goals)}
          ${renderFlag(card.team_id, 'final', '🏁 Итог матча', 'Финальный результат', flags.final)}
          ${renderFlag(card.team_id, 'reminder', '⏰ Напоминание', 'Перед матчем', flags.reminder)}
          ${renderFlag(card.team_id, 'news', '📰 Новости', 'Важные новости', flags.news)}
        `
        : `
          <div id="notifyBlock" class="notice">
            <b>🔔 Уведомления</b>
            <p>Подпишись на команду, чтобы настроить голы, итоги матчей, напоминания и новости.</p>
          </div>
        `
    }

    <div id="fixturesBlock" class="section-title"><h2>Следующие матчи</h2></div>
    <div class="list">
      ${fixtures.length ? fixtures.map(renderFixture).join('') : renderNoFixture()}
    </div>

    <div class="notice">
      <b>📊 Состав, трансферы и статистика</b>
      <p>Разделы добавим после backend/cache workflow. Пользовательские клики не будут тратить API-Football.</p>
    </div>
  `;
}

function renderFixture(fixture) {
  const home = fixture.home_team || fixture.home || 'Хозяева';
  const away = fixture.away_team || fixture.away || 'Гости';
  const date = formatDate(fixture.kickoff_utc || fixture.date || fixture.kickoff || '');
  const status = fixture.status_short || fixture.status || 'Матч';

  return `
    <div class="match">
      <div class="match-kicker">${escapeHtml(status)}</div>
      <div class="match-title">${escapeHtml(home)} — ${escapeHtml(away)}</div>
      <div class="match-meta">${escapeHtml(date)}</div>
    </div>
  `;
}

function renderNoFixture() {
  return `
    <div class="match">
      <div class="match-kicker">Кэш</div>
      <div class="match-title">Матчей пока нет</div>
      <div class="match-meta">Данные подтянет фоновый workflow Fixture Cache.</div>
    </div>
  `;
}

function renderFlag(teamId, flagKey, title, subtitle, value) {
  return `
    <div class="flag">
      <div>
        <b>${escapeHtml(title)}</b>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <button class="switch ${value ? 'on' : ''}" onclick="toggleNotifyFlag(${teamId}, '${flagKey}')" aria-label="${escapeHtml(title)}"></button>
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

  const current = normalizeNotifyFlags(state.currentTeamCard.notify_flags || {});
  const next = {
    ...current,
    [flagKey]: !Boolean(current[flagKey]),
  };

  try {
    const data = await postJson(UPDATE_FLAGS_API, {
      max_user_id: getMaxUserId(),
      team_id: Number(teamId),
      notify_flags: {
        goals: Boolean(next.goals),
        final: Boolean(next.final),
        reminder: Boolean(next.reminder),
        news: Boolean(next.news),
      },
    });

    state.currentTeamCard.notify_flags = normalizeNotifyFlags(
      data.subscription?.notify_flags || data.notify_flags || next
    );

    renderTeamCard(state.currentTeamCard);
    await loadProfile();
    showToast('Настройки обновлены.');
  } catch (error) {
    showToast(`Ошибка: ${error.message}`);
  }
}

function comingSoon(name) {
  showToast(`${name}: добавим после backend/cache workflow.`);
}

function scrollToBlock(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    <div class="empty">
      <span>⚠️</span>
      <b>${escapeHtml(title)}</b>
      <p>${escapeHtml(message || 'Неизвестная ошибка')}</p>
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
