const API_BASE = '/api/ofb-miniapp';

const state = {
  initData: '',
  user: null,
  teams: [],
  quietHours: false,
};

function getWebApp() {
  return window.WebApp || null;
}

function initMax() {
  const webApp = getWebApp();

  if (!webApp) {
    document.getElementById('statusPill').textContent = 'Browser';
    return;
  }

  state.initData = webApp.initData || '';
  state.user = webApp.initDataUnsafe?.user || null;

  if (state.user?.first_name || state.user?.name) {
    document.getElementById('userLine').textContent = state.user.first_name || state.user.name;
  }

  try {
    webApp.ready?.();
    webApp.expand?.();
  } catch (e) {}
}

async function api(action, payload = {}) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      initData: state.initData,
      payload,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  return res.json();
}

function showScreen(name) {
  ['home', 'teams', 'search', 'matches', 'settings'].forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  });

  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });

  if (name === 'teams') loadTeams();
}

async function loadProfile() {
  try {
    const data = await api('profile');
    state.teams = data.teams || [];
    state.quietHours = !!data.quietHours;

    document.getElementById('quickTeams').textContent = `Подписок: ${state.teams.length}`;
    document.getElementById('quietSwitch').classList.toggle('on', state.quietHours);
    document.getElementById('statusPill').textContent = 'Online';
  } catch (e) {
    document.getElementById('quickTeams').textContent = 'Backend API ещё не подключён';
    document.getElementById('statusPill').textContent = 'API off';
  }
}

async function loadTeams() {
  const box = document.getElementById('teamsList');
  box.className = 'loader';
  box.textContent = 'Загрузка…';

  try {
    const data = await api('teams');
    state.teams = data.teams || [];
    renderTeams();
  } catch (e) {
    box.className = '';
    box.innerHTML = `
      <div class="card">
        <div class="team-name">API ещё не подключён</div>
        <div class="league">Следующий шаг — сделать n8n endpoint ofb-miniapp.</div>
      </div>
    `;
  }
}

function renderTeams() {
  const box = document.getElementById('teamsList');
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

  box.innerHTML = state.teams.map(t => `
    <div class="card">
      <div class="row">
        <div>
          <div class="team-name">⚽ ${escapeHtml(t.team_name || t.name || 'Команда')}</div>
          <div class="league">${escapeHtml(t.league_name || 'Лига не указана')}</div>
        </div>
        <button class="btn secondary" onclick="openTeam(${Number(t.team_id)})">Открыть</button>
      </div>
    </div>
  `).join('');
}

async function searchTeams() {
  const q = document.getElementById('searchInput').value.trim();
  const box = document.getElementById('searchResults');

  if (!q) return;

  box.innerHTML = '<div class="loader">Ищу…</div>';

  try {
    const data = await api('search_teams', { q });
    const teams = data.teams || [];

    if (!teams.length) {
      box.innerHTML = `
        <div class="card">
          <div class="team-name">Ничего не найдено</div>
          <div class="league">Попробуй английское название.</div>
        </div>
      `;
      return;
    }

    box.innerHTML = teams.map(t => `
      <div class="card">
        <div class="row">
          <div>
            <div class="team-name">⚽ ${escapeHtml(t.name)}</div>
            <div class="league">${escapeHtml(t.country || '—')}</div>
          </div>
          <button class="btn" onclick='addTeam(${JSON.stringify(t).replace(/'/g, "&#39;")})'>Добавить</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    box.innerHTML = `
      <div class="card">
        <div class="team-name">Поиск пока не подключён</div>
        <div class="league">Нужен backend action search_teams.</div>
      </div>
    `;
  }
}

async function addTeam(team) {
  await api('add_team', team);
  await loadTeams();
  showScreen('teams');
}

async function openTeam(teamId) {
  const box = document.getElementById('matchesList');

  showScreen('matches');
  box.innerHTML = '<div class="loader">Загружаю карточку команды…</div>';

  try {
    const data = await api('team_card', { team_id: teamId });

    box.innerHTML = `
      <div class="card">
        <div class="team-name">${escapeHtml(data.team_name || 'Команда')}</div>
        <div class="league">${escapeHtml(data.summary || 'Карточка команды')}</div>
      </div>

      ${(data.fixtures || []).map(f => `
        <div class="card">
          <div class="team-name">${escapeHtml(f.home)} — ${escapeHtml(f.away)}</div>
          <div class="league">${escapeHtml(f.date || '')}</div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    box.innerHTML = `
      <div class="card">
        <div class="team-name">Карточка пока не подключена</div>
        <div class="league">Нужен backend action team_card.</div>
      </div>
    `;
  }
}

async function toggleQuietHours() {
  try {
    const data = await api('toggle_quiet_hours');
    state.quietHours = !!data.quietHours;
    document.getElementById('quietSwitch').classList.toggle('on', state.quietHours);
  } catch (e) {
    alert('Настройка quiet hours пока не подключена');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

initMax();
loadProfile();
