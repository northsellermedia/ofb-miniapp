(() => {
  const API_BASE = (window.OFB_CONFIG && window.OFB_CONFIG.API_BASE) || 'https://n8n.northsellermedia.com/webhook';
  const API_ACTION_PATH = (window.OFB_CONFIG && window.OFB_CONFIG.ACTION_PATH) || '/ofb-mini-app-action';
  const API_URL = `${API_BASE.replace(/\/$/, '')}/${String(API_ACTION_PATH).replace(/^\//, '')}`;
  const REQUEST_TIMEOUT_MS = 15000;
  const CACHE_KEY = 'ofb_mini_app_v14_cache';

  const state = {
    initData: '',
    activeRequest: null,
    activeRequestName: '',
    searchRequest: null,
    lastSearchQuery: '',
    searchTimer: null,
    dashboard: null,
    currentTeam: null,
    selectedTeam: null,
    selectedLeague: null,
    flags: {},
    lastTap: { key: '', time: 0 }
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    authNotice: $('authNotice'), loadingState: $('loadingState'), emptyState: $('emptyState'), teamState: $('teamState'),
    refreshBtn: $('refreshBtn'), openSearchBtn: $('openSearchBtn'), replaceTeamBtn: $('replaceTeamBtn'), overviewReplaceTeamBtn: $('overviewReplaceTeamBtn'),
    searchSheet: $('searchSheet'), closeSearchBtn: $('closeSearchBtn'), closeSearchBackdrop: $('closeSearchBackdrop'),
    teamSearchInput: $('teamSearchInput'), teamSearchBtn: $('teamSearchBtn'), searchResults: $('searchResults'), searchHint: $('searchHint'), teamCardBox: $('teamCardBox'),
    teamName: $('teamName'), teamMeta: $('teamMeta'), teamLeague: $('teamLeague'), teamLogo: $('teamLogo'), toast: $('toast'),
    summaryTeamName: $('summaryTeamName'), summaryLeagueName: $('summaryLeagueName'), overviewCacheState: $('overviewCacheState'), overviewFixturesCount: $('overviewFixturesCount'), overviewSquadCount: $('overviewSquadCount'), overviewTransfersCount: $('overviewTransfersCount'),
    nextMatches: $('nextMatches'), matchesList: $('matchesList'), matchesCount: $('matchesCount'),
    squadGrid: $('squadGrid'), squadCount: $('squadCount'), transfersList: $('transfersList'), transfersCount: $('transfersCount'),
    seasonLeague: $('seasonLeague'), seasonTitle: $('seasonTitle'), seasonForm: $('seasonForm'), seasonPlayed: $('seasonPlayed'), seasonWins: $('seasonWins'), seasonDraws: $('seasonDraws'), seasonLosses: $('seasonLosses'), seasonGF: $('seasonGF'), seasonGA: $('seasonGA'), seasonCleanSheets: $('seasonCleanSheets'), seasonFailedToScore: $('seasonFailedToScore'), seasonEmpty: $('seasonEmpty'),
    clearAppCacheBtn: $('clearAppCacheBtn'), debugPanel: $('debugPanel'), debugOutput: $('debugOutput')
  };

  function setVisible(el, visible) { if (el) el.classList.toggle('hidden', !visible); }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
  function escapeAttr(v) { return escapeHtml(v).replace(/`/g, '&#096;'); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  function showToast(text, ms = 2200) {
    if (!els.toast) return;
    els.toast.textContent = text;
    setVisible(els.toast, true);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setVisible(els.toast, false), ms);
  }

  function setupMaxShell() {
    try {
      const webApp = window.WebApp || window.MAX?.WebApp || window.max?.WebApp || window.MiniApp || null;
      webApp?.ready?.(); webApp?.expand?.();
      webApp?.setHeaderColor?.('#071f35'); webApp?.setBackgroundColor?.('#061a2d');
    } catch (e) {}
  }

  function getParamFromHashOrSearch(...names) {
    for (const source of [window.location.hash || '', window.location.search || '']) {
      const clean = source.replace(/^[#?]/, '');
      const params = new URLSearchParams(clean);
      for (const name of names) {
        const value = params.get(name);
        if (value && value.length > 20) return value;
      }
    }
    return '';
  }

  function getInitData() {
    const webApp = window.WebApp || window.MAX?.WebApp || window.max?.WebApp || window.MiniApp || null;
    return [
      webApp?.initData,
      window.WebApp?.initData,
      window.MAX?.WebApp?.initData,
      window.max?.WebApp?.initData,
      getParamFromHashOrSearch('WebAppData', 'webAppData', 'initData', 'web_app_data')
    ].find(v => typeof v === 'string' && v.length > 20) || '';
  }

  function debug(extra = {}) {
    const data = {
      apiUrl: API_URL,
      initDataLength: state.initData.length,
      activeRequestName: state.activeRequestName,
      currentTeam: state.currentTeam,
      screen: extra.screen || null,
      time: new Date().toISOString(),
      ...extra
    };
    if ((location.search + location.hash).includes('debug=1') && els.debugPanel && els.debugOutput) {
      els.debugOutput.textContent = JSON.stringify(data, null, 2);
      setVisible(els.debugPanel, true);
    }
    console.log('[OFB]', data);
  }

  function setAllButtonsDisabled(disabled) {
    document.querySelectorAll('button, input[type="checkbox"]').forEach(el => {
      if (el.dataset.keepEnabled === '1') return;
      el.disabled = !!disabled;
      if (disabled) el.classList.add('button-loading'); else el.classList.remove('button-loading');
    });
  }

  function setMainLoading(text = 'Загружаем OFB') {
    setVisible(els.loadingState, true);
    setVisible(els.emptyState, false);
    setVisible(els.teamState, false);
    const h = els.loadingState?.querySelector('h1');
    const p = els.loadingState?.querySelector('p');
    if (h) h.textContent = text;
    if (p) p.textContent = 'Подождите несколько секунд.';
  }

  async function apiAction(action, payload = {}, options = {}) {
    if (!state.initData) throw new Error('NO_INIT_DATA');

    const isParallel = options.allowParallel === true;

    if (state.activeRequest && !isParallel) {
      showToast('Подождите, данные уже загружаются');
      return null;
    }

    if (options.abortPreviousSearch && state.searchRequest?.controller) {
      try { state.searchRequest.controller.abort(); } catch (e) {}
      state.searchRequest = null;
    }

    const controller = new AbortController();
    const request = { controller, timedOut: false, action };
    const timer = setTimeout(() => {
      request.timedOut = true;
      controller.abort();
    }, options.timeoutMs || REQUEST_TIMEOUT_MS);

    if (options.abortPreviousSearch) {
      state.searchRequest = request;
    }

    if (!isParallel) {
      state.activeRequest = request;
      state.activeRequestName = action;
    }

    if (options.disableUi !== false) setAllButtonsDisabled(true);
    debug({ action, payload });

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ initData: state.initData, action, payload })
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { data = { ok: false, error: 'BAD_JSON', raw: text }; }
      if (data && data.response && typeof data.response === 'object') data = data.response;
      debug({ action, httpStatus: res.status, response: data, screen: data?.screen });
      if (!res.ok || !data || data.ok === false) {
        const err = new Error(data?.message || data?.error || `HTTP ${res.status}`);
        err.data = data; err.status = res.status;
        throw err;
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') {
        if (!request.timedOut && options.silentAbort) throw new Error('__ABORTED__');
        throw new Error('Сервер долго отвечает. Нажмите ещё раз через пару секунд.');
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (state.searchRequest === request) state.searchRequest = null;
      if (state.activeRequest === request) {
        state.activeRequest = null;
        state.activeRequestName = '';
      }
      if (options.disableUi !== false) setAllButtonsDisabled(false);
    }
  }

  function saveCache(data) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data })); } catch (e) {} }
  function loadCache() { try { const x = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return x?.data || null; } catch (e) { return null; } }
  function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }

  function normalizeTeamFromOpen(data) {
    const sub = obj(data.subscription);
    const dashboardTeam = obj(data.dashboard?.team);
    const profile = obj(data.dashboard?.profile);
    const teamId = sub.team_id || dashboardTeam.team_id;
    if (!teamId) return null;
    return {
      team_id: Number(teamId),
      team_name: sub.team_name || dashboardTeam.team_name || `Команда ${teamId}`,
      league_id: sub.league_id || dashboardTeam.league_id || null,
      league_name: sub.league_name || dashboardTeam.league_name || '',
      notify_flags: obj(sub.notify_flags || dashboardTeam.notify_flags),
      logo_url: dashboardTeam.logo_url || profile.logo_url || `https://media.api-sports.io/football/teams/${teamId}.png`
    };
  }

  function setLogo() {
    if (!els.teamLogo || !state.currentTeam) return;
    els.teamLogo.src = state.currentTeam.logo_url || './assets/ofb-logo.jpg';
    els.teamLogo.alt = state.currentTeam.team_name || 'Команда';
    els.teamLogo.onerror = () => { els.teamLogo.onerror = null; els.teamLogo.src = './assets/ofb-logo.jpg'; };
    setVisible(els.teamLogo, true);
  }

  function applyFlags(flags) {
    state.flags = {
      goals: flags.goals !== false,
      final: flags.final !== false,
      reminder: flags.reminder !== false,
      news: flags.news !== false
    };
    document.querySelectorAll('[data-flag]').forEach(input => { input.checked = !!state.flags[input.dataset.flag]; });
  }

  function renderNoTeam(message = 'После выбора команды здесь появятся ближайшие матчи, состав, статистика и трансферы.') {
    setVisible(els.loadingState, false);
    setVisible(els.authNotice, false);
    setVisible(els.teamState, false);
    setVisible(els.emptyState, true);
    const p = els.emptyState?.querySelector('p');
    if (p) p.textContent = message;
  }

  function renderHome(data, fromLocal = false) {
    state.dashboard = obj(data.dashboard);
    state.currentTeam = normalizeTeamFromOpen(data);
    if (!state.currentTeam) return renderNoTeam(data.message);

    setVisible(els.loadingState, false);
    setVisible(els.authNotice, false);
    setVisible(els.emptyState, false);
    setVisible(els.teamState, true);

    if (els.teamName) els.teamName.textContent = state.currentTeam.team_name;
    if (els.teamLeague) els.teamLeague.textContent = state.currentTeam.league_name ? `Подписка: ${state.currentTeam.league_name}` : 'Лига не выбрана';
    if (els.teamMeta) els.teamMeta.textContent = fromLocal ? 'Сохранённые данные' : 'Данные OFB';
    if (els.summaryTeamName) els.summaryTeamName.textContent = state.currentTeam.team_name;
    if (els.summaryLeagueName) els.summaryLeagueName.textContent = state.currentTeam.league_name || '—';
    setLogo();
    applyFlags(state.currentTeam.notify_flags || {});

    const d = state.dashboard || {};
    const fixtures = arr(d.fixtures);
    const squad = arr(d.squad);
    const transfers = arr(d.transfers);
    const stats = d.stats || null;

    if (els.overviewFixturesCount) els.overviewFixturesCount.textContent = String(fixtures.length);
    if (els.overviewSquadCount) els.overviewSquadCount.textContent = String(squad.length);
    if (els.overviewTransfersCount) els.overviewTransfersCount.textContent = String(transfers.length);

    renderFixtures(fixtures);
    renderSquad(squad);
    renderTransfers(transfers);
    renderSeason(stats);
  }

  function formatDate(value) {
    if (!value) return 'Дата уточняется';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
  }
  function fixtureTime(f) { const t = new Date(f.kickoff_utc || f.date || f.fixture_date || 0).getTime(); return Number.isFinite(t) ? t : 9999999999999; }
  function isFinished(f) { return ['FT','AET','PEN'].includes(String(f.status_short || f.status || '').toUpperCase()) || String(f.fixture_group || '').toLowerCase() === 'past'; }

  function fixtureHtml(f) {
    const score = f.score_home !== null && f.score_home !== undefined && f.score_away !== null && f.score_away !== undefined
      ? `<span class="score">${escapeHtml(f.score_home)} : ${escapeHtml(f.score_away)}</span>` : '';
    return `<div class="item"><div class="item-main"><div class="item-title">${escapeHtml(f.home_team || 'Хозяева')} ${score} ${escapeHtml(f.away_team || 'Гости')}</div><div class="item-meta">${formatDate(f.kickoff_utc || f.date)} · ${escapeHtml(f.league_name || '')}${f.round ? ' · ' + escapeHtml(f.round) : ''}</div></div></div>`;
  }

  function renderFixtures(fixtures) {
    const sorted = arr(fixtures).slice().sort((a,b) => fixtureTime(a) - fixtureTime(b));
    const upcoming = sorted.filter(f => !isFinished(f));
    const main = upcoming.length ? upcoming.slice(0, 3) : sorted.slice(-3).reverse();
    const html = main.length ? main.map(fixtureHtml).join('') : '<div class="item"><div class="item-main"><div class="item-title">Матчи пока не найдены</div><div class="item-meta">Данные обновляются по расписанию.</div></div></div>';
    if (els.nextMatches) els.nextMatches.innerHTML = html;
    if (els.matchesList) els.matchesList.innerHTML = sorted.length ? sorted.map(fixtureHtml).join('') : html;
    if (els.matchesCount) els.matchesCount.textContent = String(sorted.length);
  }

  function renderSquad(squad) {
    const list = arr(squad);
    if (els.squadCount) els.squadCount.textContent = String(list.length);
    if (!els.squadGrid) return;
    if (!list.length) { els.squadGrid.innerHTML = '<div class="item"><div class="item-main"><div class="item-title">Состав пока не найден</div><div class="item-meta">Данные обновляются по расписанию.</div></div></div>'; return; }
    els.squadGrid.innerHTML = list.slice(0, 60).map(p => `<div class="player-card"><img src="${escapeAttr(p.photo_url || './assets/ofb-logo.jpg')}" alt="" onerror="this.src='./assets/ofb-logo.jpg'"><b>${escapeHtml(p.player_name || p.name || 'Игрок')}</b><span>${escapeHtml(p.position || '')}${p.number ? ' · №' + escapeHtml(p.number) : ''}</span></div>`).join('');
  }

  function renderTransfers(transfers) {
    const list = arr(transfers);
    if (els.transfersCount) els.transfersCount.textContent = String(list.length);
    if (!els.transfersList) return;
    if (!list.length) { els.transfersList.innerHTML = '<div class="item"><div class="item-main"><div class="item-title">Трансферы пока не найдены</div><div class="item-meta">Данные обновляются по расписанию.</div></div></div>'; return; }
    els.transfersList.innerHTML = list.map(t => `<div class="item"><div class="item-main"><div class="item-title">${escapeHtml(t.player_name || 'Игрок')}</div><div class="item-meta">${escapeHtml(t.from_team || '—')} → ${escapeHtml(t.to_team || '—')}${t.transfer_date ? ' · ' + escapeHtml(t.transfer_date) : ''}</div></div></div>`).join('');
  }

  function renderSeason(stats) {
    const s = obj(stats);
    const has = !!(s.played || s.wins || s.draws || s.losses || s.goals_for || s.form);
    setVisible(els.seasonEmpty, !has);
    const set = (el, v) => { if (el) el.textContent = v ?? '—'; };
    set(els.seasonLeague, s.league_name || state.currentTeam?.league_name || '—');
    set(els.seasonTitle, s.season || 'Текущий сезон');
    set(els.seasonForm, s.form || '—');
    set(els.seasonPlayed, s.played); set(els.seasonWins, s.wins); set(els.seasonDraws, s.draws); set(els.seasonLosses, s.losses);
    set(els.seasonGF, s.goals_for); set(els.seasonGA, s.goals_against); set(els.seasonCleanSheets, s.clean_sheets); set(els.seasonFailedToScore, s.failed_to_score);
  }

  function openSearch() {
    setVisible(els.searchSheet, true);
    state.selectedTeam = null; state.selectedLeague = null;
    if (els.searchResults) els.searchResults.innerHTML = '';
    renderTeamSelection(null);
    setTimeout(() => els.teamSearchInput?.focus?.(), 100);
  }
  function closeSearch() { setVisible(els.searchSheet, false); }

  async function openApp(force = false) {
    if (!force) {
      const cached = loadCache();
      if (cached?.screen === 'home') renderHome(cached, true);
    } else {
      clearCache();
      setMainLoading('Загружаем данные OFB');
    }

    try {
      const data = await apiAction(force ? 'refresh_dashboard' : 'open_app', {}, { disableUi: true });
      if (!data) return;
      if (data.screen === 'no_team' || data.has_team === false) {
        clearCache(); renderNoTeam(data.message); return;
      }
      if (data.screen === 'home' || data.has_team === true) {
        saveCache(data); renderHome(data, false); return;
      }
      renderNoTeam(data.message || 'Выберите команду.');
    } catch (e) {
      const cached = loadCache();
      if (cached?.screen === 'home') { renderHome(cached, true); showToast('Показали последние данные'); return; }
      setVisible(els.loadingState, false);
      setVisible(els.authNotice, true);
      showToast(e.message || 'Ошибка загрузки');
    }
  }

  async function searchTeams() {
    const q = (els.teamSearchInput?.value || '').trim();
    if (q.length < 2) { showToast('Введите минимум 2 символа'); return; }

    state.lastSearchQuery = q;

    if (els.searchHint) els.searchHint.textContent = 'Ищем команду…';
    if (els.searchResults) {
      els.searchResults.innerHTML = '<div class="item"><div class="item-main"><div class="item-title">Поиск…</div><div class="item-meta">Обычно это занимает меньше секунды.</div></div></div>';
    }

    renderTeamSelection(null);

    try {
      const data = await apiAction(
        'search_team',
        { q },
        {
          disableUi: false,
          allowParallel: true,
          abortPreviousSearch: true,
          silentAbort: true,
          timeoutMs: 9000
        }
      );

      if (!data || state.lastSearchQuery !== q) return;

      const teams = arr(data?.teams);
      if (els.searchHint) els.searchHint.textContent = teams.length ? `Найдено: ${teams.length}` : 'Команды не найдены';
      if (!els.searchResults) return;

      els.searchResults.innerHTML = teams.length
        ? teams.map(team => `<div class="item search-result"><div class="item-main"><div class="item-title">${escapeHtml(team.team_name || 'Команда')}</div><div class="item-meta">Нажмите, чтобы выбрать команду</div></div><button class="primary-button compact" type="button" data-select-team="${escapeAttr(team.team_id)}" data-team-name="${escapeAttr(team.team_name || '')}">Выбрать</button></div>`).join('')
        : '<div class="item"><div class="item-main"><div class="item-title">Ничего не найдено</div><div class="item-meta">Попробуйте другое написание: Real Madrid, Milan, Inter, Barcelona.</div></div></div>';
    } catch (e) {
      if (e.message === '__ABORTED__') return;
      if (state.lastSearchQuery !== q) return;
      if (els.searchHint) els.searchHint.textContent = e.message || 'Ошибка поиска';
      if (els.searchResults) {
        els.searchResults.innerHTML = '<div class="item"><div class="item-main"><div class="item-title">Поиск не удался</div><div class="item-meta">Нажмите «Найти» ещё раз.</div></div></div>';
      }
    }
  }

  async function selectTeam(teamId, teamName) {
    if (!teamId) return;
    state.selectedTeam = { team_id: Number(teamId), team_name: teamName || `Команда ${teamId}` };
    state.selectedLeague = null;
    renderTeamSelection({ loading: true, team: state.selectedTeam });
    try {
      const data = await apiAction('select_team', state.selectedTeam, { disableUi: false });
      if (!data) return;
      if (data.screen === 'change_locked') { renderTeamSelection({ error: true, message: data.message || 'Команду сейчас нельзя сменить.', current_subscription: data.current_subscription }); return; }
      if (data.screen === 'league_not_found') { renderTeamSelection({ error: true, team: data.team || state.selectedTeam, message: data.message || 'Лиги пока не найдены.' }); return; }
      state.selectedTeam = data.team || state.selectedTeam;
      const leagues = arr(data.leagues);
      state.selectedLeague = data.selected_league || (leagues.length === 1 ? leagues[0] : null);
      renderTeamSelection({ team: state.selectedTeam, leagues, selectedLeague: state.selectedLeague, screen: data.screen });
    } catch (e) {
      renderTeamSelection({ error: true, team: state.selectedTeam, message: e.message || 'Не удалось загрузить лиги.' });
    }
  }

  function renderTeamSelection(data) {
    if (!els.teamCardBox) return;
    if (!data) { els.teamCardBox.innerHTML = ''; setVisible(els.teamCardBox, false); return; }
    setVisible(els.teamCardBox, true);
    if (data.loading) {
      els.teamCardBox.innerHTML = `<div class="team-card"><div class="loader"></div><h3>${escapeHtml(data.team?.team_name || 'Команда')}</h3><p class="small-muted">Загружаем доступные турниры…</p></div>`;
      return;
    }
    if (data.error) {
      els.teamCardBox.innerHTML = `<div class="team-card"><h3>${escapeHtml(data.team?.team_name || 'Команда')}</h3><p class="small-muted">${escapeHtml(data.message || 'Ошибка')}</p></div>`;
      return;
    }
    const team = data.team || state.selectedTeam;
    const leagues = arr(data.leagues);
    const selected = data.selectedLeague || state.selectedLeague;
    const canConfirm = !!selected?.league_id;
    els.teamCardBox.innerHTML = `<div class="team-card"><div class="team-card-head"><img class="team-card-logo" src="https://media.api-sports.io/football/teams/${escapeAttr(team.team_id)}.png" alt="" onerror="this.src='./assets/ofb-logo.jpg'"><div><h3>${escapeHtml(team.team_name)}</h3><p class="small-muted">Выберите турнир для подписки</p></div></div><div class="league-list">${leagues.map(l => `<button class="league-option ${selected?.league_id == l.league_id ? 'active' : ''}" type="button" data-select-league="${escapeAttr(l.league_id)}" data-league-name="${escapeAttr(l.league_name)}">${escapeHtml(l.league_name)}${l.matches_count ? `<small>${escapeHtml(l.matches_count)} матч.</small>` : ''}</button>`).join('')}</div><button class="primary-button full-width" type="button" id="confirmSubscriptionBtn" ${canConfirm ? '' : 'disabled'}>${canConfirm ? 'Подтвердить выбор' : 'Сначала выберите турнир'}</button></div>`;
  }

  function selectLeague(leagueId, leagueName) {
    state.selectedLeague = { league_id: Number(leagueId), league_name: leagueName };
    const currentLeagues = Array.from(document.querySelectorAll('[data-select-league]')).map(btn => ({ league_id: Number(btn.dataset.selectLeague), league_name: btn.dataset.leagueName }));
    renderTeamSelection({ team: state.selectedTeam, leagues: currentLeagues, selectedLeague: state.selectedLeague });
  }

  async function confirmSubscription() {
    if (!state.selectedTeam?.team_id || !state.selectedLeague?.league_id) { showToast('Выберите команду и турнир'); return; }
    try {
      const data = await apiAction('confirm_subscription', {
        team_id: state.selectedTeam.team_id,
        team_name: state.selectedTeam.team_name,
        league_id: state.selectedLeague.league_id,
        league_name: state.selectedLeague.league_name
      }, { disableUi: true });
      if (!data) return;
      showToast(data.message || 'Команда сохранена');
      closeSearch();
      clearCache();
      await openApp(true);
    } catch (e) {
      showToast(e.message || 'Не удалось сохранить команду', 3500);
    }
  }

  async function updateFlag(flag, checked) {
    if (!state.currentTeam?.team_id) { showToast('Сначала выберите команду'); return; }
    const prev = { ...state.flags };
    state.flags[flag] = !!checked;
    try {
      const data = await apiAction('update_notify_flags', { team_id: state.currentTeam.team_id, notify_flags: state.flags }, { disableUi: false });
      if (data?.notify_flags) applyFlags(data.notify_flags);
      showToast('Настройки сохранены');
      clearCache();
    } catch (e) {
      state.flags = prev; applyFlags(prev); showToast(e.message || 'Не удалось сохранить');
    }
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-page').forEach(page => page.classList.toggle('active', page.id === `tab-${tab}`));
  }

  function dedupe(key, ms = 700) {
    const now = Date.now();
    if (state.lastTap.key === key && now - state.lastTap.time < ms) return false;
    state.lastTap = { key, time: now };
    return true;
  }

  function bindEvents() {
    els.refreshBtn?.addEventListener('click', () => openApp(true));
    els.openSearchBtn?.addEventListener('click', openSearch);
    els.replaceTeamBtn?.addEventListener('click', openSearch);
    els.overviewReplaceTeamBtn?.addEventListener('click', openSearch);
    els.closeSearchBtn?.addEventListener('click', closeSearch);
    els.closeSearchBackdrop?.addEventListener('click', closeSearch);
    els.teamSearchBtn?.addEventListener('click', searchTeams);
    els.teamSearchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') searchTeams(); });
    els.teamSearchInput?.addEventListener('input', () => {
      clearTimeout(state.searchTimer);
      const q = (els.teamSearchInput?.value || '').trim();
      if (q.length < 3) return;
      state.searchTimer = setTimeout(searchTeams, 500);
    });
    els.clearAppCacheBtn?.addEventListener('click', () => { clearCache(); showToast('Данные приложения обновлены'); openApp(true); });

    document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    document.querySelectorAll('[data-tab-jump]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tabJump)));
    document.querySelectorAll('[data-flag]').forEach(input => input.addEventListener('change', () => updateFlag(input.dataset.flag, input.checked)));

    document.addEventListener('click', e => {
      const teamBtn = e.target.closest('[data-select-team]');
      if (teamBtn) { if (!dedupe('team-' + teamBtn.dataset.selectTeam)) return; selectTeam(teamBtn.dataset.selectTeam, teamBtn.dataset.teamName); return; }
      const leagueBtn = e.target.closest('[data-select-league]');
      if (leagueBtn) { selectLeague(leagueBtn.dataset.selectLeague, leagueBtn.dataset.leagueName); return; }
      const confirmBtn = e.target.closest('#confirmSubscriptionBtn');
      if (confirmBtn) { if (!dedupe('confirm', 900)) return; confirmSubscription(); return; }
    });

    document.addEventListener('touchend', e => {
      const confirmBtn = e.target.closest('#confirmSubscriptionBtn');
      if (confirmBtn) { e.preventDefault(); if (!dedupe('confirm', 900)) return; confirmSubscription(); }
    }, { passive: false });
  }

  async function init() {
    setupMaxShell();
    bindEvents();
    state.initData = getInitData();
    debug({ init: true });
    if (!state.initData) {
      setVisible(els.loadingState, false);
      setVisible(els.authNotice, true);
      renderNoTeam('Откройте приложение из MAX. Не удалось получить данные входа.');
      return;
    }
    await openApp(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
