(() => {
  const C = window.OFB_CONFIG;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const state = {
    user: null,
    subscriptions: [],
    searchResults: [],
    selectedTeam: null,
    teamCard: null,
    activeTab: 'matches',
    tabCache: {},
    loading: false
  };

  function endpoint(name) {
    return `${C.API_BASE}/${C.ENDPOINTS[name]}`;
  }

  async function postJson(name, payload) {
    const res = await fetch(endpoint(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.ok === false) {
      throw new Error(data?.message || data?.error || `OFB API error ${res.status}`);
    }
    return data;
  }

  function getWebApp() {
    return window.WebApp || null;
  }

  function getMaxUser() {
    const url = new URL(location.href);
    const idFromUrl = Number(url.searchParams.get('max_user_id'));
    const unsafeUser = getWebApp()?.initDataUnsafe?.user;
    const id = unsafeUser?.id || idFromUrl || C.TEST_MAX_USER_ID;
    return {
      max_user_id: Number(id),
      first_name: unsafeUser?.first_name || 'OFB user',
      username: unsafeUser?.username || ''
    };
  }

  function showNotice(message, type = 'error') {
    const el = $('#notice');
    el.textContent = message;
    el.className = `notice ${type}`;
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => el.classList.add('hidden'), 4200);
  }

  function empty(title, text) {
    const node = $('#emptyTpl').content.cloneNode(true);
    node.querySelector('h3').textContent = title;
    node.querySelector('p').textContent = text;
    return node;
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function normalizeTeam(raw = {}) {
    const team = raw.team || raw;
    return {
      team_id: Number(team.team_id),
      team_name: team.team_name || team.name || team.team || `Команда #${team.team_id}`,
      country: team.country || team.country_name || '',
      league_id: team.league_id || null,
      league_name: team.league_name || '',
      logo_url: team.logo_url || team.logo || team.team_logo || ''
    };
  }

  async function loadProfile() {
    const maxUser = getMaxUser();
    $('#debugUser').textContent = `MAX user id: ${maxUser.max_user_id}. В продакшне backend должен проверять initData.`;
    const data = await postJson('profile', maxUser);
    state.user = data.user || data.profile || null;
    state.subscriptions = data.subscriptions || data.teams || [];
    renderProfile();
  }

  function renderProfile() {
    const user = state.user || getMaxUser();
    $('#helloTitle').textContent = `Привет, ${user.first_name || 'болельщик'}`;
    $('#helloText').textContent = state.subscriptions.length ? 'Открой команду, чтобы посмотреть матчи, профиль, состав, статистику и уведомления.' : 'Добавь первую команду и настрой уведомления о важных событиях.';
    $('#subCount').textContent = state.subscriptions.length;
    $('#profileStatus').textContent = state.user ? 'профиль загружен' : 'тестовый режим';
    renderSubscriptions();
  }

  function renderSubscriptions() {
    const box = $('#subscriptions');
    box.innerHTML = '';
    if (!state.subscriptions.length) {
      box.appendChild(empty('Пока нет команд', 'Открой поиск и подпишись на клуб.'));
      return;
    }
    state.subscriptions.map(normalizeTeam).forEach(team => box.appendChild(teamRow(team, true)));
  }

  function teamRow(team, subscribed = false) {
    const card = document.createElement('button');
    card.className = 'team-card glass-panel';
    card.type = 'button';
    card.innerHTML = `
      <div class="team-main">
        <div class="team-badge">${escapeHtml((team.team_name || '?').slice(0, 2).toUpperCase())}</div>
        <div>
          <div class="team-name">${escapeHtml(team.team_name)}</div>
          <div class="team-meta">${escapeHtml([team.country, team.league_name, subscribed ? 'подписка активна' : 'можно добавить'].filter(Boolean).join(' • '))}</div>
        </div>
      </div>
      <div class="chev">›</div>`;
    card.addEventListener('click', () => openTeam(team));
    return card;
  }

  async function searchTeams(query) {
    const box = $('#searchResults');
    if (query.trim().length < C.SEARCH_MIN_LENGTH) {
      box.innerHTML = '';
      box.appendChild(empty('Введите название', `Минимум ${C.SEARCH_MIN_LENGTH} символа.`));
      return;
    }
    box.innerHTML = '<div class="loading">Ищем команду…</div>';
    try {
      const data = await postJson('teamSearch', { q: query.trim() });
      state.searchResults = (data.teams || []).map(normalizeTeam);
      renderSearchResults();
    } catch (e) {
      box.innerHTML = '';
      box.appendChild(empty('Поиск не сработал', e.message));
    }
  }

  function renderSearchResults() {
    const box = $('#searchResults');
    box.innerHTML = '';
    if (!state.searchResults.length) {
      box.appendChild(empty('Ничего не найдено', 'Попробуй другое название команды.'));
      return;
    }
    state.searchResults.forEach(team => box.appendChild(teamRow(team, false)));
  }

  async function openTeam(team) {
    state.selectedTeam = normalizeTeam(team);
    state.teamCard = null;
    state.tabCache = {};
    state.activeTab = 'matches';
    $('#teamTitle').textContent = state.selectedTeam.team_name;
    $('#teamCountry').textContent = state.selectedTeam.country || 'Команда';
    $('#teamLeague').textContent = state.selectedTeam.league_name || 'OFB';
    $('#teamLogo').classList.toggle('hidden', !state.selectedTeam.logo_url);
    if (state.selectedTeam.logo_url) $('#teamLogo').src = state.selectedTeam.logo_url;
    openSheet();
    setActiveTab('matches');
    await loadTeamCard();
  }

  function openSheet() {
    $('#teamSheet').classList.remove('hidden');
    $('#teamSheet').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    $('#teamSheet').classList.add('hidden');
    $('#teamSheet').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  async function loadTeamCard() {
    const payload = { max_user_id: getMaxUser().max_user_id, team_id: state.selectedTeam.team_id };
    try {
      const data = await postJson('teamCard', payload);
      state.teamCard = data;
      if (data.team) state.selectedTeam = { ...state.selectedTeam, ...normalizeTeam(data.team) };
      $('#teamTitle').textContent = state.selectedTeam.team_name;
      $('#teamCountry').textContent = state.selectedTeam.country || 'Команда';
      $('#teamLeague').textContent = state.selectedTeam.league_name || '';
      renderSubscribeButton();
      renderTab();
    } catch (e) {
      $('#tabContent').innerHTML = '';
      $('#tabContent').appendChild(empty('Карточка не загрузилась', e.message));
    }
  }

  function isSubscribed() {
    return Boolean(state.teamCard?.is_subscribed || state.subscriptions.some(s => Number(s.team_id) === Number(state.selectedTeam?.team_id)));
  }

  function renderSubscribeButton() {
    const btn = $('#subscribeBtn');
    btn.textContent = isSubscribed() ? 'Отписаться' : 'Подписаться';
    btn.className = isSubscribed() ? 'secondary-button' : 'primary-button';
  }

  async function toggleSubscribe() {
    const team = state.selectedTeam;
    const payload = { ...getMaxUser(), team_id: team.team_id, team_name: team.team_name };
    try {
      $('#subscribeBtn').disabled = true;
      if (isSubscribed()) {
        await postJson('unsubscribe', { max_user_id: payload.max_user_id, team_id: team.team_id });
        showNotice('Подписка удалена', 'ok');
      } else {
        await postJson('subscribe', payload);
        showNotice('Команда добавлена', 'ok');
      }
      await loadProfile();
      await loadTeamCard();
    } catch (e) {
      showNotice(e.message);
    } finally {
      $('#subscribeBtn').disabled = false;
    }
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    renderTab();
  }

  async function ensureLazyData(tab) {
    if (state.tabCache[tab]) return;
    const payload = { max_user_id: getMaxUser().max_user_id, team_id: state.selectedTeam.team_id };
    const endpointByTab = { profile: 'teamProfile', squad: 'squad', stats: 'seasonStats', transfers: 'transfers', matches: 'fixtures' };
    if (!endpointByTab[tab]) return;
    try {
      state.tabCache[tab] = await postJson(endpointByTab[tab], payload);
    } catch (e) {
      state.tabCache[tab] = { ok: false, error: e.message };
    }
  }

  async function renderTab() {
    const tab = state.activeTab;
    const box = $('#tabContent');
    box.innerHTML = '<div class="loading">Обновляем данные…</div>';
    if (['profile','squad','stats','transfers','matches'].includes(tab)) await ensureLazyData(tab);
    box.innerHTML = '';
    if (state.tabCache[tab]?.ok === false) {
      box.appendChild(empty('Данные обновляются', state.tabCache[tab].error || 'Попробуй позже.'));
      return;
    }
    if (tab === 'matches') renderMatches(box);
    if (tab === 'profile') renderTeamProfile(box);
    if (tab === 'squad') renderSquad(box);
    if (tab === 'stats') renderStats(box);
    if (tab === 'transfers') renderTransfers(box);
    if (tab === 'notify') renderNotify(box);
  }

  function getFixtures() {
    const from4A = state.tabCache.matches?.fixtures;
    if (Array.isArray(from4A)) return from4A;
    const f = state.teamCard?.fixtures;
    if (Array.isArray(f)) return f;
    return [...(f?.upcoming || []), ...(f?.past || []), ...(state.teamCard?.next_fixtures || [])];
  }

  function renderMatches(box) {
    const now = Date.now();
    const fixtures = getFixtures().map(x => ({ ...x, time: new Date(x.kickoff_utc || x.fixture_date || x.date).getTime() })).filter(x => x.time);
    const upcoming = fixtures.filter(x => x.time >= now).sort((a,b) => a.time - b.time).slice(0, 8);
    const past = fixtures.filter(x => x.time < now).sort((a,b) => b.time - a.time).slice(0, 8);
    if (!fixtures.length) return box.appendChild(empty('Матчи обновляются', 'Кэш матчей скоро появится.'));
    box.appendChild(sectionLabel('Ближайшие'));
    (upcoming.length ? upcoming : []).forEach(f => box.appendChild(matchCard(f)));
    if (!upcoming.length) box.appendChild(empty('Будущих матчей нет', 'Проверь позже.'));
    box.appendChild(sectionLabel('Прошедшие'));
    (past.length ? past : []).forEach(f => box.appendChild(matchCard(f)));
    if (!past.length) box.appendChild(empty('Прошедших матчей нет', 'Кэш хранит ограниченный диапазон.'));
  }

  function matchCard(f) {
    const home = f.home_team || f.home_team_name || 'Home';
    const away = f.away_team || f.away_team_name || 'Away';
    const sh = f.score_home ?? f.home_goals;
    const sa = f.score_away ?? f.away_goals;
    const score = sh !== null && sh !== undefined && sa !== null && sa !== undefined ? `${sh}:${sa}` : f.status_short || 'NS';
    const el = document.createElement('div');
    el.className = 'mini-card match-card';
    el.innerHTML = `<div><div class="match-teams">${escapeHtml(home)} — ${escapeHtml(away)}</div><div class="pill">${escapeHtml(f.league_name || f.round || 'Матч')}</div></div><div class="match-time"><div class="score">${escapeHtml(score)}</div><div>${fmtDate(f.kickoff_utc || f.fixture_date)}</div></div>`;
    return el;
  }

  function renderTeamProfile(box) {
    const p = state.tabCache.profile?.profile;
    if (!p) return box.appendChild(empty('Профиль команды обновляется', 'Фоновый кэш ещё не заполнил данные.'));
    box.appendChild(metricGrid([
      ['Основан', p.founded || '—'], ['Стадион', p.venue_name || '—'], ['Город', p.venue_city || p.city || '—'], ['Вместимость', p.venue_capacity || '—']
    ]));
  }

  function renderSquad(box) {
    const squad = state.tabCache.squad?.squad || [];
    if (!squad.length) return box.appendChild(empty('Состав скоро появится', 'Данные обновляются через cache workflow.'));
    const groups = ['Goalkeeper','Defender','Midfielder','Attacker'];
    groups.forEach(g => {
      const players = squad.filter(p => (p.position || '').toLowerCase() === g.toLowerCase());
      if (!players.length) return;
      box.appendChild(sectionLabel(positionRu(g)));
      players.forEach(p => {
        const el = document.createElement('div');
        el.className = 'mini-card';
        el.innerHTML = `<b>${escapeHtml(p.player_name)}</b><div class="muted">${escapeHtml([p.number ? '№' + p.number : '', p.age ? p.age + ' лет' : '', positionRu(p.position)].filter(Boolean).join(' • '))}</div>`;
        box.appendChild(el);
      });
    });
  }

  function renderStats(box) {
    const s = (state.tabCache.stats?.stats || [])[0];
    if (!s) return box.appendChild(empty('Статистика обновляется', 'Фоновый кэш ещё не заполнил сезон.'));
    const points = Number(s.wins || 0) * 3 + Number(s.draws || 0);
    const gd = Number(s.goals_for || 0) - Number(s.goals_against || 0);
    box.appendChild(metricGrid([
      ['Очки', points], ['Матчи', s.played ?? '—'], ['Победы', s.wins ?? '—'], ['Ничьи', s.draws ?? '—'], ['Поражения', s.losses ?? '—'], ['Разница', gd], ['Голы', `${s.goals_for ?? 0}:${s.goals_against ?? 0}`], ['Сухие', s.clean_sheets ?? '—']
    ]));
  }

  function renderTransfers(box) {
    const transfers = state.tabCache.transfers?.transfers || [];
    if (!transfers.length) return box.appendChild(empty('Трансферы пока не загружены', 'Будут показаны 10 последних трансферов.'));
    transfers.forEach(t => {
      const el = document.createElement('div');
      el.className = 'mini-card';
      el.innerHTML = `<b>${escapeHtml(t.player_name)}</b><div class="muted">${escapeHtml(t.from_team || '—')} → ${escapeHtml(t.to_team || '—')}</div><div class="pill">${escapeHtml([t.transfer_date, t.transfer_type].filter(Boolean).join(' • '))}</div>`;
      box.appendChild(el);
    });
  }

  function renderNotify(box) {
    const flags = { ...(state.teamCard?.notify_flags || {}) };
    Object.entries(C.NOTIFY_LABELS).forEach(([key, label]) => {
      const row = document.createElement('div');
      row.className = 'mini-card toggle-row';
      row.innerHTML = `<div><b>${escapeHtml(label)}</b><div class="muted">${notifyHint(key)}</div></div><button class="switch ${flags[key] !== false ? 'on' : ''}" aria-label="${escapeHtml(label)}"><i></i></button>`;
      row.querySelector('button').addEventListener('click', async () => {
        flags[key] = !(flags[key] !== false);
        await updateFlags(flags);
      });
      box.appendChild(row);
    });
    if (isSubscribed()) {
      const del = document.createElement('button');
      del.className = 'danger-button';
      del.textContent = 'Отписаться от команды';
      del.addEventListener('click', toggleSubscribe);
      box.appendChild(del);
    }
  }

  async function updateFlags(flags) {
    try {
      const data = await postJson('updateFlags', { max_user_id: getMaxUser().max_user_id, team_id: state.selectedTeam.team_id, notify_flags: flags });
      state.teamCard.notify_flags = data.notify_flags || flags;
      renderTab();
    } catch (e) { showNotice(e.message); }
  }

  function metricGrid(items) {
    const grid = document.createElement('div');
    grid.className = 'grid-2';
    grid.innerHTML = items.map(([label, value]) => `<div class="stat"><b>${escapeHtml(String(value))}</b><span>${escapeHtml(label)}</span></div>`).join('');
    return grid;
  }

  function sectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'section-head';
    el.innerHTML = `<h3>${escapeHtml(text)}</h3>`;
    return el;
  }

  function notifyHint(key) {
    return { news:'новости команды', goals:'голы в live', final:'итог матча', reminder:'перед стартом', match_start:'стартовый свисток' }[key] || 'уведомление';
  }

  function positionRu(pos) {
    return { Goalkeeper:'Вратари', Defender:'Защитники', Midfielder:'Полузащитники', Attacker:'Нападающие' }[pos] || pos || 'Игроки';
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function bindUI() {
    $$('.segment-btn').forEach(btn => btn.addEventListener('click', () => {
      $$('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.screen').forEach(s => s.classList.remove('active'));
      $(`#screen-${btn.dataset.screen}`).classList.add('active');
      if (btn.dataset.screen === 'search') $('#searchInput').focus();
    }));
    const debouncedSearch = debounce(() => searchTeams($('#searchInput').value), C.SEARCH_DEBOUNCE_MS);
    $('#searchInput').addEventListener('input', debouncedSearch);
    $('#clearSearch').addEventListener('click', () => { $('#searchInput').value = ''; $('#searchResults').innerHTML = ''; });
    $('#refreshBtn').addEventListener('click', () => loadProfile().catch(e => showNotice(e.message)));
    $('#closeSheet').addEventListener('click', closeSheet);
    $('#sheetBackdrop').addEventListener('click', closeSheet);
    $('#subscribeBtn').addEventListener('click', toggleSubscribe);
    $('#shareBtn').addEventListener('click', () => {
      const text = encodeURIComponent(`OFB | Около футбола: ${state.selectedTeam?.team_name || ''}\n${C.CHANNEL_URL}`);
      const url = `https://max.ru/:share?text=${text}`;
      if (getWebApp()?.openLink) getWebApp().openLink(url); else location.href = url;
    });
    $$('.tab').forEach(tab => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));
  }

  async function init() {
    bindUI();
    $('#subscriptions').appendChild(empty('Загрузка', 'Получаем профиль и подписки.'));
    try {
      if (getWebApp()?.ready) getWebApp().ready();
      await loadProfile();
    } catch (e) {
      renderProfile();
      showNotice(e.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
