const PROFILE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-profile';
const TEAM_SEARCH_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-search';
const TEAM_CARD_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-team-card';
const SUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-subscribe';
const UPDATE_FLAGS_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-update-flags';
const UNSUBSCRIBE_API = 'https://n8n.northsellermedia.com/webhook/ofb-api-unsubscribe';

// Старый общий endpoint пока НЕ удаляем в n8n.
// Во frontend его больше не используем как основной API.
// const OLD_API_BASE = 'https://n8n.northsellermedia.com/webhook/ofb-miniapp-api';

const TEST_MAX_USER_ID = 5712595;

const state = {
  user: null,
  maxUserId: null,
  teams: [],
  searchResults: [],
  currentTeamCard: null,
  quietHours: false,
};

function getWebApp() {
  return window.WebApp || null;
}

function initMax() {
  const webApp = getWebApp();

  if (!webApp) {
    setText('statusPill', 'Browser');
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
  const webApp = getWebApp();
  const unsafeUser = webApp?.initDataUnsafe?.user || null;

  const fromMax = Number(
    unsafeUser?.id ||
    unsafeUser?.user_id ||
    unsafeUser?.max_user_id ||
    0
  );

  if (fromMax) return fromMax;

  // Временный fallback для теста в обычном браузере.
  // Внутри MAX должен прийти реальный user_id.
  return TEST_MAX_USER_ID;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });

  const text = await res.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { ok: false, raw: text };
  }

  if (!res.ok || data.ok === false) {
    const message = data.error || data.message || `HTTP ${res.status}`;
    throw new Error(message);
  }

  return data;
}

function showScreen(name) {
  ['home', 'teams', 'search', 'matches', 'settings'].forEach((screen) => {
    const el = document.getElementById(`screen-${screen}`);
    if (el) el.classList.toggle('hidden', screen !== name);
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });

  if (name === 'teams') {
    renderTeams();
  }
}

async function loadProfile() {
  state.maxUserId = getMaxUserId();

  try {
    const data = await postJson(PROFILE_API, {
      max_user_id: state.maxUserId,
    });

    state.user = data.user || null;
    state.teams = normalizeSubscriptions(data.subscriptions || data.teams || []);
    state.quietHours = Boolean(data.user?.quiet_hours || state.quietHours);

    setText('quickTeams', `Подписок: ${state.teams.length}`);
    setText('statusPill', 'Online');

    const userName =
      data.user?.first_name ||
      data.user?.username ||
      getWebApp()?.initDataUnsafe?.user?.first_name ||
      getWebApp()?.initDataUnsafe?.user?.name ||
      '';

    if (userName) setText('userLine', userName);

    updateQuietSwitch();
    renderTeams();

    return data;
  } catch (e) {
    setText('quickTeams', `Ошибка профиля: ${e.message}`);
    setText('statusPill', 'API error');
    renderError('teamsList', 'Не удалось загрузить профиль', e.message);
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

function renderTeams() {
  const box = document.getElementById('teamsList');
  if (!box) return;

  box.className = '';

  if (!state.teams.length) {
    box.innerHTML = `
      <div class="card">
        <div class="team-name">Команд пока нет</div>
        <div class="league">Добавь первую команду через поиск.</div>
      </div>
    `;
    return;
  }

  box.innerHTML = state.teams.map((team) => `
    <div class="card">
      <div class="row">
        <div>
          <div class="team-name">⚽ ${escapeHtml(team.team_name)}</div>
          <div class="league">${escapeHtml(team.league_name || 'Подписка активна')}</div>
        </div>
        <button class="btn secondary" onclick="openTeam(${team.team_id})">Открыть</button>
      </div>
    </div>
  `).join('');
}

async function searchTeams() {
  const input = document.getElementById('searchInput');
  const box = document.getElementById('searchResults');

  if (!input || !box) return;

  const q = input.value.trim();

  if (!q) {
    box.innerHTML = `
      <div class="card">
        <div class="team-name">Введите название команды</div>
        <div class="league">Например: zenit, spartak, barcelona</div>
      </div>
    `;
    return;
  }

  box.innerHTML = '<div class="loader">Ищу в базе OFB…</div>';

  try {
    const data = await postJson(TEAM_SEARCH_API, { q });
    const teams = normalizeSearchTeams(data.teams || []);

    state.searchResults = teams;

    if (!teams.length) {
      box.innerHTML = `
        <div class="card">
          <div class="team-name">Ничего не найдено</div>
          <div class="league">Попробуй другое название или английское написание.</div>
        </div>
      `;
      return;
    }

    box.innerHTML = teams.map((team) => `
      <div class="card">
        <div class="row">
          <div>
            <div class="team-name">⚽ ${escapeHtml(team.team_name)}</div>
            <div class="league">ID команды: ${team.team_id}</div>
          </div>
          <button class="btn" onclick="openTeam(${team.team_id})">Открыть</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    renderError('searchResults', 'Ошибка поиска команды', e.message);
  }
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

async function openTeam(teamId) {
  state.maxUserId = getMaxUserId();

  const box = document.getElementById('matchesList');
  if (!box) return;

  showScreen('matches');
  box.innerHTML = '<div class="loader">Загружаю карточку команды…</div>';

  try {
    const data = await postJson(TEAM_CARD_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
    });

    state.currentTeamCard = normalizeTeamCard(data, teamId);

    renderTeamCard(state.currentTeamCard);
  } catch (e) {
    renderError('matchesList', 'Ошибка карточки команды', e.message);
  }
}

function normalizeTeamCard(data, fallbackTeamId) {
  const team = data.team || {};

  return {
    team_id: Number(team.team_id || data.team_id || fallbackTeamId),
    team_name: team.team_name || data.team_name || `Команда ${fallbackTeamId}`,
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
  const box = document.getElementById('matchesList');
  if (!box) return;

  const fixturesHtml = renderFixtures(card.next_fixtures);
  const notifyHtml = card.is_subscribed ? renderNotifyFlags(card) : '';

  const mainButton = card.is_subscribed
    ? `<button class="btn danger full" onclick="unsubscribeTeam(${card.team_id})">❌ Отписаться</button>`
    : `<button class="btn full" onclick="subscribeTeam(${card.team_id}, '${escapeJs(card.team_name)}')">🔔 Подписаться</button>`;

  box.innerHTML = `
    <div class="card">
      <div class="team-name">⚽ ${escapeHtml(card.team_name)}</div>
      <div class="league">
        ${card.is_subscribed ? 'Ты подписан на эту команду' : 'Ты пока не подписан на эту команду'}
      </div>

      ${mainButton}

      <button class="btn secondary full" onclick="showScreen('teams')">← Мои команды</button>
    </div>

    ${notifyHtml}

    <div class="section-title">Ближайшие матчи</div>
    ${fixturesHtml}
  `;
}

function renderFixtures(fixtures) {
  if (!fixtures || !fixtures.length) {
    return `
      <div class="card">
        <div class="team-name">Матчей пока нет в кэше</div>
        <div class="league">Данные подтянет фоновый workflow Fixture Cache.</div>
      </div>
    `;
  }

  return fixtures.map((fixture) => {
    const home = fixture.home_team || fixture.home || 'Хозяева';
    const away = fixture.away_team || fixture.away || 'Гости';
    const date = formatDate(fixture.kickoff_utc || fixture.date || fixture.kickoff || '');
    const status = fixture.status_short || fixture.status || '';

    return `
      <div class="card">
        <div class="team-name">${escapeHtml(home)} — ${escapeHtml(away)}</div>
        <div class="league">${escapeHtml(date)}${status ? ` · ${escapeHtml(status)}` : ''}</div>
      </div>
    `;
  }).join('');
}

function renderNotifyFlags(card) {
  const flags = card.notify_flags || {};

  return `
    <div class="section-title">Уведомления</div>

    ${renderFlagRow(card.team_id, 'goals', '⚽ Голы', 'Уведомления о голах', flags.goals)}
    ${renderFlagRow(card.team_id, 'final', '🏁 Итог матча', 'Финальный результат', flags.final)}
    ${renderFlagRow(card.team_id, 'reminder', '⏰ Напоминание', 'Перед началом матча', flags.reminder)}
    ${renderFlagRow(card.team_id, 'news', '📰 Новости', 'Важные новости по команде', flags.news)}
  `;
}

function renderFlagRow(teamId, flagKey, title, subtitle, value) {
  return `
    <div class="card">
      <div class="row">
        <div>
          <div class="team-name">${escapeHtml(title)}</div>
          <div class="league">${escapeHtml(subtitle)}</div>
        </div>
        <div
          class="switch ${value ? 'on' : ''}"
          onclick="toggleNotifyFlag(${teamId}, '${flagKey}')"
        ></div>
      </div>
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

    await loadProfile();
    await openTeam(teamId);
  } catch (e) {
    alert(`Не удалось подписаться: ${e.message}`);
  }
}

async function unsubscribeTeam(teamId) {
  state.maxUserId = getMaxUserId();

  try {
    await postJson(UNSUBSCRIBE_API, {
      max_user_id: state.maxUserId,
      team_id: Number(teamId),
    });

    await loadProfile();
    await openTeam(teamId);
  } catch (e) {
    alert(`Не удалось отписаться: ${e.message}`);
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
  } catch (e) {
    alert(`Не удалось обновить настройки: ${e.message}`);
  }
}

async function toggleQuietHours() {
  alert('Тихий режим подключим отдельным backend endpoint после проверки MVP.');
}

function updateQuietSwitch() {
  const el = document.getElementById('quietSwitch');
  if (el) el.classList.toggle('on', Boolean(state.quietHours));
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

  box.className = '';
  box.innerHTML = `
    <div class="card">
      <div class="team-name">⚠️ ${escapeHtml(title)}</div>
      <div class="league">${escapeHtml(message || 'Неизвестная ошибка')}</div>
    </div>
  `;
}

function formatDate(value) {
  if (!value) return 'Дата не указана';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }) + ' МСК';
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

initMax();
loadProfile();
