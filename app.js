(() => {
  const API_BASE = window.OFB_CONFIG?.API_BASE || '/webhook';
  const APP_VERSION = window.OFB_CONFIG?.APP_VERSION || 'STABLE_WORKING_V12';
  const STORAGE_PREFIX = 'ofb_v12:';

  const state = {
    initData: '',
    dashboard: null,
    currentTeam: null,
    flags: {},
    selectedTeamCard: null,
    selectedLeague: null,
    loading: {},
    memory: {}
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    authNotice: $('authNotice'), loadingState: $('loadingState'), emptyState: $('emptyState'), teamState: $('teamState'),
    refreshBtn: $('refreshBtn'), openSearchBtn: $('openSearchBtn'), replaceTeamBtn: $('replaceTeamBtn'), clearCacheBtn: $('clearCacheBtn'),
    searchSheet: $('searchSheet'), sheetBg: $('sheetBg'), closeSearchBtn: $('closeSearchBtn'), teamSearchInput: $('teamSearchInput'), teamSearchBtn: $('teamSearchBtn'),
    searchResults: $('searchResults'), searchHint: $('searchHint'), teamCardBox: $('teamCardBox'),
    teamName: $('teamName'), teamMeta: $('teamMeta'), teamLogo: $('teamLogo'), toast: $('toast'),
    cacheState: $('cacheState'), summaryTeam: $('summaryTeam'), summaryLeague: $('summaryLeague'), summaryMatches: $('summaryMatches'), summarySquad: $('summarySquad'),
    homePlayed: $('homePlayed'), homeWins: $('homeWins'), homeGoals: $('homeGoals'),
    nextMatches: $('nextMatches'), matchesList: $('matchesList'), matchesCount: $('matchesCount'),
    seasonLeague: $('seasonLeague'), seasonTitle: $('seasonTitle'), seasonForm: $('seasonForm'), seasonPlayed: $('seasonPlayed'), seasonWins: $('seasonWins'), seasonDraws: $('seasonDraws'), seasonLosses: $('seasonLosses'), seasonGF: $('seasonGF'), seasonGA: $('seasonGA'), seasonClean: $('seasonClean'), seasonNoGoal: $('seasonNoGoal'), seasonEmpty: $('seasonEmpty'),
    squadGrid: $('squadGrid'), squadCount: $('squadCount'), transfersList: $('transfersList'), transfersCount: $('transfersCount'),
    debugPanel: $('debugPanel'), debugOutput: $('debugOutput')
  };

  const setVisible = (el, show) => el && el.classList.toggle('hidden', !show);
  const safeArr = (v) => Array.isArray(v) ? v : [];
  const clean = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const attr = (v) => clean(v).replace(/`/g, '&#096;');
  const endpoint = (path) => `${API_BASE.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;

  function showToast(text) {
    els.toast.textContent = text;
    setVisible(els.toast, true);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setVisible(els.toast, false), 2200);
  }

  function debug(extra = {}) {
    const data = {
      appVersion: APP_VERSION,
      apiBase: API_BASE,
      initDataLength: state.initData.length,
      currentTeamId: state.currentTeam?.team_id || null,
      selectedLeagueId: state.selectedLeague?.league_id || null,
      ...window.__OFB_DEBUG__,
      ...extra
    };
    console.log('[OFB DEBUG]', data);
    if ((location.search.includes('debug=1') || location.hash.includes('debug=1')) && els.debugPanel) {
      els.debugOutput.textContent = JSON.stringify(data, null, 2);
      setVisible(els.debugPanel, true);
    }
  }

  function clearOfbStorage() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('ofb_')) localStorage.removeItem(k);
      }
    } catch (_) {}
  }

  const storageKey = (path, payload) => STORAGE_PREFIX + path + ':' + JSON.stringify(payload || {});
  function saveLocal(path, payload, data) {
    try { localStorage.setItem(storageKey(path, payload), JSON.stringify({ t: Date.now(), data })); } catch (_) {}
  }
  function loadLocal(path, payload, maxAgeMs) {
    try {
      const raw = localStorage.getItem(storageKey(path, payload));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.data || Date.now() - parsed.t > maxAgeMs) return null;
      return parsed.data;
    } catch (_) { return null; }
  }

  function getInitData() {
    const hash = location.hash.includes('initData=') ? new URLSearchParams(location.hash.slice(1)).get('initData') : '';
    const search = location.search.includes('initData=') ? new URLSearchParams(location.search).get('initData') : '';
    const list = [
      window.WebApp?.initData,
      window.MAX?.WebApp?.initData,
      window.max?.WebApp?.initData,
      window.MiniApp?.initData,
      hash,
      search
    ];
    const val = list.find(x => typeof x === 'string' && x.length > 20) || '';
    window.__OFB_DEBUG__ = {
      href: location.href,
      userAgent: navigator.userAgent,
      hasWebApp: !!window.WebApp,
      hasMAX: !!window.MAX,
      hasMAXWebApp: !!window.MAX?.WebApp,
      hasMax: !!window.max,
      hasMaxWebApp: !!window.max?.WebApp,
      hasMiniApp: !!window.MiniApp
    };
    return val;
  }

  function setupShell() {
    try {
      const app = window.WebApp || window.MAX?.WebApp || window.max?.WebApp || window.MiniApp || null;
      app?.ready?.(); app?.expand?.(); app?.setHeaderColor?.('#071f35'); app?.setBackgroundColor?.('#061a2d');
    } catch (_) {}
  }

  async function fetchRetry(url, options, retries = 1) {
    let err;
    for (let i = 0; i <= retries; i++) {
      try { return await fetch(url, options); }
      catch (e) { err = e; if (i < retries) await new Promise(r => setTimeout(r, 450 + i * 350)); }
    }
    throw err;
  }

  async function ofbApi(path, payload = {}, options = {}) {
    if (!state.initData) throw new Error('MAX initData not found');

    const key = `${path}:${JSON.stringify(payload)}:${options.flat ? 'flat' : 'wrapped'}`;
    const ttl = options.ttlMs ?? 30000;
    if (!options.noMemoryCache && state.memory[key] && Date.now() - state.memory[key].t < ttl) return state.memory[key].data;
    if (state.loading[key]) return state.loading[key];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
    const body = options.flat ? { initData: state.initData, ...payload } : { initData: state.initData, payload };

    const promise = fetchRetry(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    }, options.retries ?? 1).then(async res => {
      const data = await res.json().catch(() => null);
      debug({ lastApiPath: path, lastApiStatus: res.status, lastApiOk: res.ok, lastApiResponseOk: data?.ok, lastApiError: data?.error || data?.message || null, servedFrom: data?.served_from || data?.source || null });
      if (!res.ok || !data) throw new Error(data?.error || data?.message || `API ${res.status}`);
      if (data.ok === false) throw new Error(data.error || data.message || 'API returned ok=false');
      state.memory[key] = { t: Date.now(), data };
      if (options.saveLocal !== false) saveLocal(path, payload, data);
      return data;
    }).finally(() => {
      clearTimeout(timeout);
      delete state.loading[key];
    });

    state.loading[key] = promise;
    return promise;
  }

  function showNoTeam() {
    state.dashboard = null;
    state.currentTeam = null;
    setVisible(els.loadingState, false);
    setVisible(els.teamState, false);
    setVisible(els.emptyState, true);
  }

  function normalizeTeam(d) {
    const t = d?.team;
    if (!t?.team_id) return null;
    return {
      team_id: Number(t.team_id),
      team_name: t.team_name || `Команда ${t.team_id}`,
      league_id: t.league_id || null,
      league_name: t.league_name || '',
      notify_flags: t.notify_flags || {},
      logo_url: t.logo_url || d.profile?.logo_url || ''
    };
  }

  function renderShell() {
    if (!state.currentTeam) return showNoTeam();
    setVisible(els.loadingState, false);
    setVisible(els.emptyState, false);
    setVisible(els.teamState, true);

    els.teamName.textContent = state.currentTeam.team_name;
    els.teamMeta.textContent = state.currentTeam.league_name || 'Команда выбрана';
    els.summaryTeam.textContent = state.currentTeam.team_name;
    els.summaryLeague.textContent = state.currentTeam.league_name || '—';

    els.teamLogo.src = state.currentTeam.logo_url || `https://media.api-sports.io/football/teams/${state.currentTeam.team_id}.png`;
    els.teamLogo.onerror = () => { els.teamLogo.onerror = null; els.teamLogo.src = './assets/ofb-logo.svg'; };

    applyFlags(state.currentTeam.notify_flags);
  }

  function applyFlags(flags = {}) {
    state.flags = {
      goals: flags.goals !== false,
      final: flags.final !== false,
      reminder: flags.reminder !== false,
      news: flags.news !== false
    };
    document.querySelectorAll('[data-flag]').forEach(i => { i.checked = !!state.flags[i.dataset.flag]; });
  }

  async function ensureMissingTeamSections(dashboard) {
    // Current 3H returns fixtures/stats/profile, but may not return squad/transfers yet.
    // This fallback keeps the app working with uploaded workflows 4D/4F.
    if (!dashboard?.team?.team_id) return dashboard;
    const teamId = Number(dashboard.team.team_id);

    const tasks = [];

    if (!Array.isArray(dashboard.squad)) {
      tasks.push(
        ofbApi('/ofb-api-team-squad', { team_id: teamId }, { timeoutMs: 12000, retries: 1, saveLocal: false })
          .then(r => { dashboard.squad = safeArr(r.squad || r.players); })
          .catch(() => { dashboard.squad = []; })
      );
    }

    if (!Array.isArray(dashboard.transfers)) {
      tasks.push(
        ofbApi('/ofb-api-team-transfers', { team_id: teamId }, { timeoutMs: 12000, retries: 1, saveLocal: false })
          .then(r => { dashboard.transfers = safeArr(r.transfers || r.items).slice(0, 10); })
          .catch(() => { dashboard.transfers = []; })
      );
    }

    if (tasks.length) await Promise.allSettled(tasks);
    return dashboard;
  }

  async function renderDashboard(raw, fromLocal = false) {
    let dashboard = raw;
    if (!dashboard || dashboard.has_team === false || !dashboard.team) {
      if (!fromLocal) clearOfbStorage();
      return showNoTeam();
    }

    dashboard = await ensureMissingTeamSections(dashboard);

    state.dashboard = dashboard;
    state.currentTeam = normalizeTeam(dashboard);
    if (!state.currentTeam) {
      if (!fromLocal) clearOfbStorage();
      return showNoTeam();
    }

    const fixtures = safeArr(dashboard.fixtures);
    const squad = safeArr(dashboard.squad);
    const transfers = safeArr(dashboard.transfers);
    const stats = dashboard.stats || null;

    els.cacheState.textContent = fromLocal ? 'saved' : (dashboard.served_from || dashboard.source || 'cache');
    els.summaryMatches.textContent = String(fixtures.length);
    els.summarySquad.textContent = String(squad.length);
    els.homePlayed.textContent = stats?.played ?? '—';
    els.homeWins.textContent = stats?.wins ?? '—';
    els.homeGoals.textContent = stats?.goals_for ?? '—';

    renderShell();
    renderFixtures(fixtures, fromLocal);
    renderSeason(stats);
    renderSquad(squad, fromLocal);
    renderTransfers(transfers, fromLocal);
  }

  async function loadDashboard() {
    setVisible(els.authNotice, false);

    const local = loadLocal('/ofb-api-dashboard-cache', {}, 24 * 60 * 60 * 1000);
    let hadLocal = false;
    if (local) {
      hadLocal = true;
      renderDashboard(local, true);
    } else {
      setVisible(els.loadingState, true);
    }

    try {
      const data = await ofbApi('/ofb-api-dashboard-cache', {}, { noMemoryCache: true, timeoutMs: hadLocal ? 9000 : 15000, retries: 1 });
      await renderDashboard(data, false);
      saveLocal('/ofb-api-dashboard-cache', {}, data);
    } catch (e) {
      console.error(e);
      setVisible(els.loadingState, false);
      if (!hadLocal) {
        setVisible(els.authNotice, true);
        showToast('Не удалось загрузить данные');
      } else {
        showToast('Показаны сохранённые данные');
      }
    }
  }

  function timeOf(f) {
    const raw = f.kickoff_utc || f.fixture_date || f.date || f.kickoff || '';
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 9999999999999;
  }

  function isFinished(f) {
    const s = String(f.status_short || f.status || '').toUpperCase();
    return ['FT', 'AET', 'PEN'].includes(s) || String(f.fixture_group || '').toLowerCase() === 'past';
  }

  function formatDate(v) {
    if (!v) return 'Дата уточняется';
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return String(v);
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  }

  function renderFixtures(fixtures, fromLocal = false) {
    const sorted = fixtures.slice().sort((a, b) => timeOf(a) - timeOf(b));
    const upcoming = sorted.filter(f => !isFinished(f));
    const past = sorted.filter(f => isFinished(f)).reverse();

    els.nextMatches.innerHTML = upcoming.length ? upcoming.slice(0, 4).map(matchHtml).join('') : emptyItem('Ближайших матчей пока нет', 'Кэш обновится автоматически.');
    els.matchesCount.textContent = fromLocal ? `${sorted.length} saved` : String(sorted.length);

    if (!sorted.length) {
      els.matchesList.innerHTML = emptyItem('Матчи пока не найдены', 'Проверьте позже.');
      return;
    }

    els.matchesList.innerHTML = [
      upcoming.length ? `<div class="section-title">Ближайшие</div>${upcoming.map(matchHtml).join('')}` : '',
      past.length ? `<div class="section-title">Прошедшие</div>${past.map(matchHtml).join('')}` : ''
    ].join('');
  }

  function matchHtml(f) {
    const home = clean(f.home_team || 'Хозяева');
    const away = clean(f.away_team || 'Гости');
    const league = clean(f.league_name || '');
    const date = formatDate(f.kickoff_utc || f.fixture_date || f.date || f.kickoff);
    const hs = f.score_home ?? f.home_score ?? null;
    const as = f.score_away ?? f.away_score ?? null;
    const score = hs !== null && hs !== undefined && as !== null && as !== undefined ? `${hs}:${as}` : clean(f.status_short || 'NS');
    const label = isFinished(f) ? 'Прошедший' : 'Ближайший';
    return `<div class="item"><div class="item-main"><div class="item-title">${home} — ${away}</div><div class="item-meta">${label} · ${date}${league ? ' · ' + league : ''}</div></div><div class="score">${score}</div></div>`;
  }

  function emptyItem(title, meta = '') {
    return `<div class="item"><div class="item-main"><div class="item-title">${clean(title)}</div><div class="item-meta">${clean(meta)}</div></div></div>`;
  }

  function renderSeason(s) {
    if (!s) {
      setVisible(els.seasonEmpty, true);
      ['seasonLeague','seasonTitle','seasonPlayed','seasonWins','seasonDraws','seasonLosses','seasonGF','seasonGA','seasonClean','seasonNoGoal'].forEach(id => { const el = $(id); if (el) el.textContent = '—'; });
      els.seasonForm.innerHTML = '—';
      return;
    }
    setVisible(els.seasonEmpty, false);
    els.seasonLeague.textContent = s.league_name || 'Сезон';
    els.seasonTitle.textContent = s.season || '—';
    els.seasonPlayed.textContent = s.played ?? '—';
    els.seasonWins.textContent = s.wins ?? '—';
    els.seasonDraws.textContent = s.draws ?? '—';
    els.seasonLosses.textContent = s.losses ?? '—';
    els.seasonGF.textContent = s.goals_for ?? '—';
    els.seasonGA.textContent = s.goals_against ?? '—';
    els.seasonClean.textContent = s.clean_sheets ?? '—';
    els.seasonNoGoal.textContent = s.failed_to_score ?? '—';

    const form = String(s.form || '').trim();
    els.seasonForm.innerHTML = form ? form.slice(-10).split('').map(ch => `<span class="form-dot">${clean(ch)}</span>`).join('') : '—';
  }

  function renderSquad(squad, fromLocal = false) {
    els.squadCount.textContent = fromLocal ? `${squad.length} saved` : String(squad.length);
    els.squadGrid.innerHTML = squad.length ? squad.map(playerHtml).join('') : emptyItem('Состав пока не найден', 'Кэш состава обновится автоматически.');
  }

  function playerHtml(p) {
    const name = p.player_name || p.name || 'Игрок';
    const pos = p.position || 'Футболист';
    const id = p.player_id || p.id || '';
    const photo = p.photo_url || p.photo || (id ? `https://media.api-sports.io/football/players/${id}.png` : './assets/ofb-logo.svg');
    const num = p.number ? `№${p.number}` : '';
    return `<div class="player-card"><img class="player-photo" src="${attr(photo)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='./assets/ofb-logo.svg'" /><div><div class="player-name">${clean(name)}</div><div class="player-role">${clean([num,pos].filter(Boolean).join(' · '))}</div></div></div>`;
  }

  function renderTransfers(transfers, fromLocal = false) {
    const sorted = transfers.slice().sort((a, b) => {
      const da = new Date(a.transfer_date || a.date || 0).getTime();
      const db = new Date(b.transfer_date || b.date || 0).getTime();
      return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
    }).slice(0, 10);
    els.transfersCount.textContent = fromLocal ? `${sorted.length} saved` : String(sorted.length);
    els.transfersList.innerHTML = sorted.length ? sorted.map(transferHtml).join('') : emptyItem('Трансферы пока не найдены', 'Кэш трансферов обновится автоматически.');
  }

  function transferHtml(t) {
    const player = t.player_name || t.name || 'Игрок';
    const type = t.transfer_type || t.type || 'Трансфер';
    const from = t.from_team || '';
    const to = t.to_team || '';
    const date = t.transfer_date || t.date ? formatDate(t.transfer_date || t.date) : '';
    const photo = t.photo_url || t.photo || './assets/ofb-logo.svg';
    return `<div class="item"><img class="player-photo" src="${attr(photo)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='./assets/ofb-logo.svg'" /><div class="item-main"><div class="item-title">${clean(player)}</div><div class="item-meta">${clean(type)}${from || to ? ` · ${clean(from)} → ${clean(to)}` : ''}${date ? ` · ${date}` : ''}</div></div></div>`;
  }

  async function searchTeams() {
    const q = els.teamSearchInput.value.trim();
    state.selectedTeamCard = null;
    state.selectedLeague = null;
    renderTeamCard(null);

    if (q.length < 3) {
      els.searchHint.textContent = 'Введите минимум 3 символа.';
      els.searchResults.innerHTML = '';
      return;
    }

    els.searchHint.textContent = 'Ищем команду…';
    els.searchResults.innerHTML = '';

    try {
      const data = await ofbApi('/ofb-api-team-search', { q }, { noMemoryCache: true, timeoutMs: 15000, retries: 1, saveLocal: false });
      const teams = safeArr(data.teams);
      els.searchHint.textContent = teams.length ? 'Выберите команду, потом турнир.' : 'Команды не найдены.';
      els.searchResults.innerHTML = teams.map(teamSearchHtml).join('');
    } catch (e) {
      console.error(e);
      els.searchHint.textContent = 'Ошибка поиска. Попробуйте позже.';
    }
  }

  function teamSearchHtml(t) {
    const id = t.team_id || t.id;
    const name = t.team_name || t.name || 'Команда';
    return `<div class="item"><div class="item-main"><div class="item-title">${clean(name)}</div><div class="item-meta">ID ${clean(id)}</div></div><button class="primary-btn compact" data-open-card="${attr(id)}" data-team-name="${attr(name)}" type="button">Выбрать</button></div>`;
  }

  async function openTeamCard(teamId, fallbackName = '') {
    state.selectedTeamCard = null;
    state.selectedLeague = null;
    els.searchHint.textContent = 'Загружаем турниры…';
    renderTeamCard({ loading: true, team: { team_id: Number(teamId), team_name: fallbackName || `Команда ${teamId}` }, available_leagues: [] });

    try {
      const data = await ofbApi('/ofb-api-team-card', { team_id: Number(teamId) }, { noMemoryCache: true, timeoutMs: 15000, retries: 1, saveLocal: false });
      const team = normalizeCardTeam(data, teamId, fallbackName);
      const leagues = safeArr(data.available_leagues).map(normalizeLeague).filter(Boolean);
      const selected = normalizeLeague(data.selected_league) || (leagues.length === 1 ? leagues[0] : null);
      state.selectedTeamCard = { ...data, team, available_leagues: leagues };
      state.selectedLeague = selected;
      els.searchHint.textContent = leagues.length > 1 ? 'Выберите лигу/турнир.' : 'Турнир выбран автоматически.';
      renderTeamCard(state.selectedTeamCard);
    } catch (e) {
      console.error(e);
      els.searchHint.textContent = 'Карточка команды не загрузилась.';
      renderTeamCard({ error: e.message, team: { team_id: Number(teamId), team_name: fallbackName || `Команда ${teamId}` }, available_leagues: [] });
    }
  }

  function normalizeCardTeam(d, fallbackId, fallbackName = '') {
    const raw = d.team || d.profile || {};
    const id = Number(raw.team_id || raw.id || d.team_id || fallbackId);
    const name = raw.team_name || raw.name || d.team_name || fallbackName || `Команда ${id}`;
    const logo = raw.logo_url || raw.logo || d.logo_url || `https://media.api-sports.io/football/teams/${id}.png`;
    return { ...raw, team_id: id, team_name: name, logo_url: logo };
  }

  function normalizeLeague(raw) {
    if (!raw) return null;
    const id = Number(raw.league_id || raw.id);
    const name = String(raw.league_name || raw.name || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !name) return null;
    return { ...raw, league_id: Math.trunc(id), league_name: name, country: raw.country || '', season: raw.season || '' };
  }

  function renderTeamCard(card) {
    if (!card) {
      setVisible(els.teamCardBox, false);
      els.teamCardBox.innerHTML = '';
      return;
    }

    setVisible(els.teamCardBox, true);
    const team = card.team || {};
    const leagues = safeArr(card.available_leagues).map(normalizeLeague).filter(Boolean);
    const selected = normalizeLeague(state.selectedLeague);

    if (card.loading) {
      els.teamCardBox.innerHTML = `<article class="card"><div class="item"><img class="team-card-logo" src="${attr(team.logo_url || './assets/ofb-logo.svg')}" alt="" onerror="this.src='./assets/ofb-logo.svg'" /><div class="item-main"><div class="item-title">${clean(team.team_name || 'Команда')}</div><div class="item-meta">Загружаем лиги…</div></div></div></article>`;
      return;
    }

    if (card.error) {
      els.teamCardBox.innerHTML = `<article class="card"><div class="item"><div class="item-main"><div class="item-title">${clean(team.team_name || 'Команда')}</div><div class="item-meta">${clean(card.error)}</div></div></div></article>`;
      return;
    }

    const buttons = leagues.length ? leagues.map(l => `
      <button class="league-option ${selected?.league_id === l.league_id ? 'active' : ''}" data-select-league="${attr(l.league_id)}" type="button">
        ${clean(l.league_name)}
        ${l.country ? `<span class="item-meta"> · ${clean(l.country)}</span>` : ''}
        ${l.season ? `<span class="item-meta"> · ${clean(l.season)}</span>` : ''}
        ${l.matches_count ? `<span class="item-meta"> · матчей: ${clean(l.matches_count)}</span>` : ''}
      </button>`).join('') : `<div class="item-meta">Лиги не найдены. Подписка недоступна.</div>`;

    const disabled = !selected;
    const text = disabled ? 'Сначала выберите лигу' : `${card.is_subscribed ? 'Обновить подписку' : 'Подписаться'} на ${team.team_name} / ${selected.league_name}`;

    els.teamCardBox.innerHTML = `<article class="card"><div class="item"><img class="team-card-logo" src="${attr(team.logo_url || './assets/ofb-logo.svg')}" alt="" onerror="this.src='./assets/ofb-logo.svg'" /><div class="item-main"><div class="item-title">${clean(team.team_name || 'Команда')}</div><div class="item-meta">${card.is_subscribed ? 'Команда уже выбрана. Можно сменить турнир.' : 'Выберите турнир для подписки.'}</div></div></div><div class="league-options">${buttons}</div><button id="subscribeBtn" class="primary-btn" type="button" ${disabled ? 'disabled' : ''}>${clean(text)}</button></article>`;
  }

  function selectLeague(id) {
    const league = safeArr(state.selectedTeamCard?.available_leagues).map(normalizeLeague).filter(Boolean).find(l => Number(l.league_id) === Number(id));
    state.selectedLeague = league || null;
    renderTeamCard(state.selectedTeamCard);
  }

  async function subscribeSelectedTeam() {
    const team = state.selectedTeamCard?.team;
    const league = normalizeLeague(state.selectedLeague);

    if (!team?.team_id || !team?.team_name) return showToast('Сначала выберите команду');
    if (!league) return showToast('Сначала выберите лигу');

    try {
      showToast('Сохраняем подписку…');
      await ofbApi('/ofb-api-subscribe', {
        team_id: Number(team.team_id),
        team_name: String(team.team_name),
        league_id: Number(league.league_id),
        league_name: String(league.league_name)
      }, { flat: true, noMemoryCache: true, timeoutMs: 20000, retries: 1, saveLocal: false });

      closeSearch();
      clearOfbStorage();
      await loadDashboard();
      showToast(`${team.team_name} / ${league.league_name} выбраны`);
    } catch (e) {
      console.error(e);
      showToast(e.message === 'league_required' ? 'Сначала выберите лигу' : 'Не удалось сохранить подписку');
    }
  }

  async function updateFlags(flag, checked) {
    if (!state.currentTeam?.team_id) return;
    const old = { ...state.flags };
    state.flags[flag] = checked;

    try {
      await ofbApi('/ofb-api-update-flags', { team_id: state.currentTeam.team_id, notify_flags: state.flags }, { noMemoryCache: true, timeoutMs: 15000, retries: 1, saveLocal: false });
      const local = loadLocal('/ofb-api-dashboard-cache', {}, 24 * 60 * 60 * 1000);
      if (local?.team) {
        local.team.notify_flags = { ...state.flags };
        saveLocal('/ofb-api-dashboard-cache', {}, local);
      }
      showToast('Настройки сохранены');
    } catch (e) {
      console.error(e);
      state.flags = old;
      applyFlags(old);
      showToast('Не удалось сохранить настройки');
    }
  }

  function openSearch() {
    state.selectedTeamCard = null;
    state.selectedLeague = null;
    renderTeamCard(null);
    els.searchResults.innerHTML = '';
    els.searchHint.textContent = 'Введите минимум 3 символа.';
    setVisible(els.searchSheet, true);
    setTimeout(() => els.teamSearchInput.focus(), 80);
  }

  function closeSearch() {
    setVisible(els.searchSheet, false);
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  }

  function bindEvents() {
    els.refreshBtn.addEventListener('click', () => loadDashboard());
    els.openSearchBtn.addEventListener('click', openSearch);
    els.replaceTeamBtn.addEventListener('click', openSearch);
    els.closeSearchBtn.addEventListener('click', closeSearch);
    els.sheetBg.addEventListener('click', closeSearch);
    els.teamSearchBtn.addEventListener('click', searchTeams);
    els.teamSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchTeams(); });
    els.clearCacheBtn.addEventListener('click', () => { clearOfbStorage(); showToast('Кэш приложения сброшен'); setTimeout(() => location.reload(), 350); });

    document.addEventListener('click', e => {
      const card = e.target.closest('[data-open-card]');
      if (card) return openTeamCard(card.dataset.openCard, card.dataset.teamName);
      const league = e.target.closest('[data-select-league]');
      if (league) return selectLeague(league.dataset.selectLeague);
      if (e.target.closest('#subscribeBtn')) return subscribeSelectedTeam();
      const tab = e.target.closest('[data-tab]');
      if (tab) return switchTab(tab.dataset.tab);
      const jump = e.target.closest('[data-jump]');
      if (jump) return switchTab(jump.dataset.jump);
    });

    document.querySelectorAll('[data-flag]').forEach(input => input.addEventListener('change', () => updateFlags(input.dataset.flag, input.checked)));
  }

  async function init() {
    if (location.search.includes('clear=1') || location.hash.includes('clear=1')) clearOfbStorage();

    setupShell();
    bindEvents();

    for (let i = 0; i < 20; i++) {
      state.initData = getInitData();
      if (state.initData) break;
      await new Promise(r => setTimeout(r, 150));
    }

    debug({ initFinished: true });

    if (!state.initData) {
      setVisible(els.loadingState, false);
      setVisible(els.authNotice, true);
      setVisible(els.emptyState, true);
      return;
    }

    await loadDashboard();
  }

  init();
})();
