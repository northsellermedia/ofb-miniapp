/* OFB | Около футбола — MAX mini app frontend */

const CONFIG = window.OFB_CONFIG;

const state = {
  user: null,
  subscriptions: [],
  selectedTeam: null,
  selectedTab: 'matches',
  teamData: {},
  loading: false,
  searchTimer: null,
  maxUser: null
};

const $ = (id) => document.getElementById(id);

const labels = {
  news: 'Новости',
  goals: 'Голы',
  final: 'Финальный счёт',
  reminder: 'Напоминание',
  match_start: 'Начало матча'
};

const tabMap = {
  matches: 'Матчи',
  profile: 'Профиль',
  squad: 'Состав',
  stats: 'Статистика',
  transfers: 'Трансферы',
  notify: 'Уведомления'
};

function endpoint(key) {
  return `${CONFIG.API_BASE}${CONFIG.ENDPOINTS[key]}`;
}

function getMaxUser() {
  const webApp = window.WebApp;
  const unsafe = webApp?.initDataUnsafe || {};
  const user = unsafe.user || {};

  const id = Number(user.id || CONFIG.TEST_MAX_USER_ID);
  return {
    max_user_id: id,
    first_name: user.first_name || 'OFB',
    last_name: user.last_name || '',
    username: user.username || ''
  };
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.ok === false) {
    throw new Error(data?.message || data?.error || `API error ${res.status}`);
  }
  return data;
}

function payload(extra = {}) {
  return {
    max_user_id: state.maxUser.max_user_id,
    first_name: state.maxUser.first_name,
    username: state.maxUser.username,
    ...extra
  };
}

function setStatus(text, isError = false) {
  const panel = $('statusPanel');
  if (!text) {
    panel.classList.add('hidden');
    panel.textContent = '';
    return;
  }
  panel.classList.remove('hidden');
  panel.textContent = text;
  panel.style.borderColor = isError ? 'rgba(255,92,92,.45)' : 'rgba(255,255,255,.18)';
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 2400);
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
  if (!value) return 'Дата неизвестна';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(d);
}

function teamName(team) {
  return team?.team_name || team?.name || team?.team?.team_name || 'Команда';
}

async function loadProfile({ silent = false } = {}) {
  if (!silent) setStatus('Загружаю профиль…');
  const data = await postJson(endpoint('profile'), payload());
  state.user = data.user || data.profile || null;
  state.subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : (data.teams || []);
  renderProfile();
  if (!silent) setStatus('');
}

function renderProfile() {
  const badge = $('userBadge');
  const displayName = state.user?.first_name || state.maxUser.first_name || 'Пользователь';
  badge.textContent = `${displayName} · ${state.subscriptions.length}`;

  const list = $('subscriptionsList');
  if (!state.subscriptions.length) {
    list.innerHTML = `
      <article class="empty-card glass-card">
        <h3>Команд пока нет</h3>
        <p class="muted">Найдите команду и подпишитесь, чтобы получать матчи и уведомления.</p>
        <button class="primary-btn" type="button" data-go-search>Найти команду</button>
      </article>`;
    return;
  }

  list.innerHTML = state.subscriptions.map((sub) => `
    <article class="team-card glass-card">
      <div class="team-head">
        <div>
          <div class="team-name">${escapeHtml(teamName(sub))}</div>
          <div class="team-meta">${escapeHtml(sub.league_name || sub.country || 'Подписка активна')}</div>
        </div>
        <span class="pill">${sub.notify_flags?.goals ? 'Голы ON' : 'Голы OFF'}</span>
      </div>
      <div class="team-actions">
        <button class="primary-btn" type="button" data-open-team="${escapeHtml(sub.team_id)}">Открыть</button>
        <button class="ghost-btn" type="button" data-open-notify="${escapeHtml(sub.team_id)}">Уведомления</button>
      </div>
    </article>`).join('');
}

async function searchTeams(query) {
  const list = $('searchResults');
  const q = query.trim();
  if (q.length < 2) {
    list.innerHTML = `<article class="empty-card glass-card"><p class="muted">Введите минимум 2 символа.</p></article>`;
    return;
  }

  list.innerHTML = `<article class="empty-card glass-card"><p class="muted">Ищу команду…</p></article>`;
  try {
    const data = await postJson(endpoint('teamSearch'), { q });
    const teams = Array.isArray(data.teams) ? data.teams : [];
    if (!teams.length) {
      list.innerHTML = `<article class="empty-card glass-card"><h3>Не найдено</h3><p class="muted">Попробуйте другое название.</p></article>`;
      return;
    }
    list.innerHTML = teams.map((team) => `
      <article class="team-card glass-card">
        <div class="team-head">
          <div>
            <div class="team-name">${escapeHtml(teamName(team))}</div>
            <div class="team-meta">${escapeHtml([team.country, team.league_name].filter(Boolean).join(' · ') || 'Команда')}</div>
          </div>
          <span class="pill">ID ${escapeHtml(team.team_id)}</span>
        </div>
        <div class="team-actions">
          <button class="primary-btn" type="button" data-open-team="${escapeHtml(team.team_id)}">Открыть</button>
          <button class="ghost-btn" type="button" data-subscribe-team="${escapeHtml(team.team_id)}" data-team-name="${escapeHtml(teamName(team))}">Подписаться</button>
        </div>
      </article>`).join('');
  } catch (err) {
    list.innerHTML = `<article class="empty-card glass-card"><h3>Ошибка поиска</h3><p class="muted">${escapeHtml(err.message)}</p></article>`;
  }
}

async function openTeam(teamId, startTab = 'matches') {
  setStatus('Открываю карточку команды…');
  state.selectedTab = startTab;
  state.teamData = {};

  try {
    const card = await postJson(endpoint('teamCard'), payload({ team_id: Number(teamId) }));
    state.selectedTeam = {
      team_id: Number(teamId),
      team_name: teamName(card.team || card),
      is_subscribed: Boolean(card.is_subscribed),
      notify_flags: card.notify_flags || {},
      next_fixtures: card.next_fixtures || card.fixtures?.upcoming || [],
      fixtures: card.fixtures || null
    };
    state.teamData.card = card;
    showSheet();
    await loadTeamTab(startTab);
  } catch (err) {
    toast(`Ошибка: ${err.message}`);
  } finally {
    setStatus('');
  }
}

function showSheet() {
  $('teamSheet').classList.remove('hidden');
  $('teamSheet').setAttribute('aria-hidden', 'false');
  renderTeamSheet();
}

function closeSheet() {
  $('teamSheet').classList.add('hidden');
  $('teamSheet').setAttribute('aria-hidden', 'true');
}

function renderTeamSheet() {
  const team = state.selectedTeam;
  if (!team) return;
  $('teamSheetContent').innerHTML = `
    <div class="sheet-top">
      <div>
        <div class="eyebrow">Карточка команды</div>
        <div class="sheet-title">${escapeHtml(team.team_name)}</div>
        <div class="muted">${team.is_subscribed ? 'Вы подписаны' : 'Вы не подписаны'}</div>
      </div>
      <button class="icon-btn" type="button" data-close-sheet>×</button>
    </div>

    <div class="team-actions" style="margin-bottom: 12px">
      ${team.is_subscribed
        ? `<button class="danger-btn" type="button" data-unsubscribe-current>Отписаться</button>`
        : `<button class="primary-btn" type="button" data-subscribe-current>Подписаться</button>`}
    </div>

    <div class="sheet-tabs">
      ${Object.entries(tabMap).map(([key, name]) => `<button class="chip ${state.selectedTab === key ? 'active' : ''}" data-team-tab="${key}" type="button">${name}</button>`).join('')}
    </div>

    <div id="sheetBody" class="sheet-body">${renderTabLoading()}</div>`;
}

function renderTabLoading() {
  return `<article class="mini-card"><p class="muted">Загрузка…</p></article>`;
}

async function loadTeamTab(tab) {
  state.selectedTab = tab;
  renderTeamSheet();
  const teamId = state.selectedTeam.team_id;

  try {
    if (tab === 'matches') await loadFixtures(teamId);
    if (tab === 'profile') await loadTeamProfile(teamId);
    if (tab === 'squad') await loadSquad(teamId);
    if (tab === 'stats') await loadStats(teamId);
    if (tab === 'transfers') await loadTransfers(teamId);
    if (tab === 'notify') renderNotifyTab();
  } catch (err) {
    $('sheetBody').innerHTML = `<article class="mini-card"><h3>Ошибка</h3><p class="muted">${escapeHtml(err.message)}</p></article>`;
  }
}

async function loadFixtures(teamId) {
  const data = await postJson(endpoint('fixtures'), payload({ team_id: teamId }));
  const fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
  const now = Date.now();
  const upcoming = fixtures.filter((f) => new Date(f.kickoff_utc).getTime() >= now).sort((a,b) => new Date(a.kickoff_utc) - new Date(b.kickoff_utc));
  const past = fixtures.filter((f) => new Date(f.kickoff_utc).getTime() < now).sort((a,b) => new Date(b.kickoff_utc) - new Date(a.kickoff_utc));

  $('sheetBody').innerHTML = `
    <article class="mini-card"><h3>Ближайшие</h3>${renderFixturesList(upcoming.slice(0, 8), 'Будущих матчей пока нет')}</article>
    <article class="mini-card"><h3>Прошедшие</h3>${renderFixturesList(past.slice(0, 8), 'Прошедших матчей пока нет')}</article>`;
}

function renderFixturesList(fixtures, emptyText) {
  if (!fixtures.length) return `<p class="muted">${emptyText}</p>`;
  return fixtures.map((f) => `
    <div class="fixture-card">
      <div class="fixture-row">
        <div>
          <div class="row-title">${escapeHtml(f.home_team || f.home_team_name)} — ${escapeHtml(f.away_team || f.away_team_name)}</div>
          <div class="row-sub">${formatDate(f.kickoff_utc)} · ${escapeHtml(f.league_name || f.round || '')}</div>
        </div>
        <div class="fixture-score">${scoreText(f)}</div>
      </div>
    </div>`).join('');
}

function scoreText(f) {
  const h = f.score_home ?? f.home_goals;
  const a = f.score_away ?? f.away_goals;
  if (h === null || h === undefined || a === null || a === undefined) return escapeHtml(f.status_short || 'NS');
  return `${escapeHtml(h)}:${escapeHtml(a)}`;
}

async function loadTeamProfile(teamId) {
  const data = await postJson(endpoint('teamProfile'), payload({ team_id: teamId }));
  const p = data.profile || {};
  if (!data.profile_found) {
    $('sheetBody').innerHTML = `<article class="mini-card"><p class="muted">Профиль команды обновляется.</p></article>`;
    return;
  }
  $('sheetBody').innerHTML = `
    <article class="mini-card">
      <div class="row-left">
        ${p.logo_url ? `<img class="avatar" src="${escapeHtml(p.logo_url)}" alt="">` : ''}
        <div><h3>${escapeHtml(p.team_name || state.selectedTeam.team_name)}</h3><p class="muted">${escapeHtml([p.country, p.city].filter(Boolean).join(' · '))}</p></div>
      </div>
      <div class="info-list">
        <div><span>Основан</span><b>${escapeHtml(p.founded || '—')}</b></div>
        <div><span>Стадион</span><b>${escapeHtml(p.venue_name || '—')}</b></div>
        <div><span>Город</span><b>${escapeHtml(p.venue_city || p.city || '—')}</b></div>
        <div><span>Вместимость</span><b>${escapeHtml(p.venue_capacity || '—')}</b></div>
      </div>
    </article>`;
}

async function loadSquad(teamId) {
  const data = await postJson(endpoint('squad'), payload({ team_id: teamId }));
  const squad = Array.isArray(data.squad) ? data.squad : [];
  if (!data.squad_found || !squad.length) {
    $('sheetBody').innerHTML = `<article class="mini-card"><p class="muted">Состав скоро появится.</p></article>`;
    return;
  }
  const groups = groupBy(squad, (p) => p.position || 'Other');
  $('sheetBody').innerHTML = Object.entries(groups).map(([pos, players]) => `
    <article class="mini-card">
      <h3>${escapeHtml(positionRu(pos))}</h3>
      ${players.map(renderPlayer).join('')}
    </article>`).join('');
}

function renderPlayer(p) {
  return `<div class="player-row">
    <div class="row-left">
      ${p.photo_url ? `<img class="avatar" src="${escapeHtml(p.photo_url)}" alt="">` : `<div class="avatar"></div>`}
      <div><div class="row-title">${escapeHtml(p.player_name)}</div><div class="row-sub">${escapeHtml(p.position || '')} · ${p.age ? `${escapeHtml(p.age)} лет` : 'возраст —'}</div></div>
    </div>
    <b>${escapeHtml(p.number || '')}</b>
  </div>`;
}

async function loadStats(teamId) {
  const data = await postJson(endpoint('seasonStats'), payload({ team_id: teamId }));
  const s = Array.isArray(data.stats) ? data.stats[0] : null;
  if (!data.stats_found || !s) {
    $('sheetBody').innerHTML = `<article class="mini-card"><p class="muted">Статистика обновляется.</p></article>`;
    return;
  }
  const points = Number(s.wins || 0) * 3 + Number(s.draws || 0);
  const diff = Number(s.goals_for || 0) - Number(s.goals_against || 0);
  $('sheetBody').innerHTML = `
    <article class="mini-card">
      <h3>${escapeHtml(s.league_name || 'Сезон')} · ${escapeHtml(s.season || '')}</h3>
      <div class="kpi-grid">
        ${kpi('Матчи', s.played)}${kpi('Очки', points)}${kpi('Победы', s.wins)}${kpi('Ничьи', s.draws)}${kpi('Поражения', s.losses)}${kpi('Разница', diff)}${kpi('Голы', `${s.goals_for || 0}:${s.goals_against || 0}`)}${kpi('Сухие', s.clean_sheets)}${kpi('Без гола', s.failed_to_score)}
      </div>
      ${s.form ? `<p class="muted" style="margin-top:12px">Форма: ${escapeHtml(s.form)}</p>` : ''}
    </article>`;
}

function kpi(name, value) {
  return `<div class="kpi"><b>${escapeHtml(value ?? '—')}</b><span>${escapeHtml(name)}</span></div>`;
}

async function loadTransfers(teamId) {
  const data = await postJson(endpoint('transfers'), payload({ team_id: teamId }));
  const transfers = Array.isArray(data.transfers) ? data.transfers : [];
  if (!data.transfers_found || !transfers.length) {
    $('sheetBody').innerHTML = `<article class="mini-card"><p class="muted">Трансферы пока не загружены.</p></article>`;
    return;
  }
  $('sheetBody').innerHTML = `<article class="mini-card"><h3>Последние трансферы</h3>${transfers.map((t) => `
    <div class="transfer-row">
      <div><div class="row-title">${escapeHtml(t.player_name)}</div><div class="row-sub">${escapeHtml(t.from_team || '—')} → ${escapeHtml(t.to_team || '—')}</div></div>
      <div style="text-align:right"><b>${escapeHtml(t.transfer_type || '—')}</b><div class="row-sub">${escapeHtml(t.transfer_date || '')}</div></div>
    </div>`).join('')}</article>`;
}

function renderNotifyTab() {
  const flags = state.selectedTeam.notify_flags || {};
  $('sheetBody').innerHTML = `
    <article class="mini-card">
      <h3>Уведомления</h3>
      ${Object.entries(labels).map(([key, name]) => `
        <div class="toggle-row">
          <div><div class="row-title">${name}</div><div class="row-sub">${notifyHint(key)}</div></div>
          <label class="switch"><input type="checkbox" data-flag="${key}" ${flags[key] !== false ? 'checked' : ''}><span class="slider"></span></label>
        </div>`).join('')}
    </article>`;
}

function notifyHint(key) {
  return {
    news: 'Новости команды',
    goals: 'Голы и пропущенные',
    final: 'Итоговый счёт',
    reminder: 'Напоминание перед матчем',
    match_start: 'Старт матча'
  }[key] || '';
}

async function subscribeTeam(teamId, name) {
  setStatus('Оформляю подписку…');
  try {
    await postJson(endpoint('subscribe'), payload({ team_id: Number(teamId), team_name: name || state.selectedTeam?.team_name }));
    toast('Подписка добавлена');
    await loadProfile({ silent: true });
    if (state.selectedTeam?.team_id === Number(teamId)) await openTeam(teamId, state.selectedTab);
  } catch (err) {
    toast(`Ошибка: ${err.message}`);
  } finally {
    setStatus('');
  }
}

async function unsubscribeTeam(teamId) {
  if (!confirm('Отписаться от команды?')) return;
  setStatus('Удаляю подписку…');
  try {
    await postJson(endpoint('unsubscribe'), payload({ team_id: Number(teamId) }));
    toast('Подписка удалена');
    await loadProfile({ silent: true });
    closeSheet();
  } catch (err) {
    toast(`Ошибка: ${err.message}`);
  } finally {
    setStatus('');
  }
}

async function updateFlag(key, checked) {
  const team = state.selectedTeam;
  const nextFlags = { ...(team.notify_flags || {}), [key]: checked };
  try {
    const data = await postJson(endpoint('updateFlags'), payload({ team_id: team.team_id, notify_flags: nextFlags }));
    team.notify_flags = data.notify_flags || nextFlags;
    toast('Настройки сохранены');
    await loadProfile({ silent: true });
  } catch (err) {
    toast(`Ошибка: ${err.message}`);
    renderNotifyTab();
  }
}

function switchScreen(name) {
  document.querySelectorAll('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.screen === name));
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.toggle('active', screen.id === `screen-${name}`));
}

function groupBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item);
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

function positionRu(pos) {
  return {
    Goalkeeper: 'Вратари',
    Defender: 'Защитники',
    Midfielder: 'Полузащитники',
    Attacker: 'Нападающие',
    Forward: 'Нападающие'
  }[pos] || pos;
}

function bindEvents() {
  document.body.addEventListener('click', async (event) => {
    const el = event.target.closest('button, [data-close-sheet]');
    if (!el) return;

    if (el.matches('.tab')) switchScreen(el.dataset.screen);
    if (el.matches('[data-go-search]')) switchScreen('search');
    if (el.matches('[data-open-team]')) openTeam(el.dataset.openTeam);
    if (el.matches('[data-open-notify]')) openTeam(el.dataset.openNotify, 'notify');
    if (el.matches('[data-subscribe-team]')) subscribeTeam(el.dataset.subscribeTeam, el.dataset.teamName);
    if (el.matches('[data-subscribe-current]')) subscribeTeam(state.selectedTeam.team_id, state.selectedTeam.team_name);
    if (el.matches('[data-unsubscribe-current]')) unsubscribeTeam(state.selectedTeam.team_id);
    if (el.matches('[data-team-tab]')) loadTeamTab(el.dataset.teamTab);
    if (el.matches('[data-close-sheet]')) closeSheet();
    if (el.id === 'refreshBtn') init();
    if (el.id === 'clearSearchBtn') {
      $('searchInput').value = '';
      $('searchResults').innerHTML = '';
    }
  });

  document.body.addEventListener('change', (event) => {
    const input = event.target.closest('input[data-flag]');
    if (input) updateFlag(input.dataset.flag, input.checked);
  });

  $('searchInput').addEventListener('input', (event) => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => searchTeams(event.target.value), 420);
  });
}

async function init() {
  state.maxUser = getMaxUser();
  setStatus('Подключаюсь к OFB backend…');
  try {
    window.WebApp?.enableClosingConfirmation?.();
    await loadProfile();
  } catch (err) {
    setStatus(`Ошибка загрузки: ${err.message}`, true);
  }
}

bindEvents();
init();
