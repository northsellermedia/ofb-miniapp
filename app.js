(() => {
  const API_BASE = (window.OFB_CONFIG && window.OFB_CONFIG.API_BASE) || '/webhook';
  const STORAGE_PREFIX = 'ofb_mini_app_tabs_v7:';
  const TEAM_CHANGE_LOCK_DAYS = 10;

  const state = {
    initData: '',
    dashboard: null,
    currentTeam: null,
    flags: {},
    selectedTeamCard: null,
    selectedLeague: null,
    activeSearchRequestId: 0,
    activeTeamCardRequestId: 0,
    savingSubscription: false,
    loading: {},
    cache: {}
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    authNotice: $('authNotice'),
    loadingState: $('loadingState'),
    emptyState: $('emptyState'),
    teamState: $('teamState'),
    refreshBtn: $('refreshBtn'),
    openSearchBtn: $('openSearchBtn'),
    replaceTeamBtn: $('replaceTeamBtn'),
    overviewReplaceTeamBtn: $('overviewReplaceTeamBtn'),
    searchSheet: $('searchSheet'),
    closeSearchBtn: $('closeSearchBtn'),
    closeSearchBackdrop: $('closeSearchBackdrop'),
    teamSearchInput: $('teamSearchInput'),
    teamSearchBtn: $('teamSearchBtn'),
    searchResults: $('searchResults'),
    searchHint: $('searchHint'),
    teamCardBox: $('teamCardBox'),
    teamName: $('teamName'),
    teamMeta: $('teamMeta'),
    teamLeague: $('teamLeague'),
    teamLogo: $('teamLogo'),
    toast: $('toast'),

    summaryTeamName: $('summaryTeamName'),
    summaryLeagueName: $('summaryLeagueName'),
    overviewCacheState: $('overviewCacheState'),
    overviewFixturesCount: $('overviewFixturesCount'),
    overviewSquadCount: $('overviewSquadCount'),
    overviewTransfersCount: $('overviewTransfersCount'),

    nextMatches: $('nextMatches'),
    matchesList: $('matchesList'),
    matchesCount: $('matchesCount'),

    squadGrid: $('squadGrid'),
    squadCount: $('squadCount'),

    transfersList: $('transfersList'),
    transfersCount: $('transfersCount'),

    statsSeason: $('statsSeason'),
    statPlayed: $('statPlayed'),
    statWins: $('statWins'),
    statDraws: $('statDraws'),
    statLosses: $('statLosses'),
    statGF: $('statGF'),
    statGA: $('statGA'),
    statsEmpty: $('statsEmpty'),

    seasonLeague: $('seasonLeague'),
    seasonTitle: $('seasonTitle'),
    seasonForm: $('seasonForm'),
    seasonPlayed: $('seasonPlayed'),
    seasonWins: $('seasonWins'),
    seasonDraws: $('seasonDraws'),
    seasonLosses: $('seasonLosses'),
    seasonGF: $('seasonGF'),
    seasonGA: $('seasonGA'),
    seasonCleanSheets: $('seasonCleanSheets'),
    seasonFailedToScore: $('seasonFailedToScore'),
    seasonEmpty: $('seasonEmpty'),

    clearAppCacheBtn: $('clearAppCacheBtn'),
    debugPanel: $('debugPanel'),
    debugOutput: $('debugOutput')
  };

  function setVisible(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }

  function renderDebug(extra = {}) {
    const isDebug = window.location.search.includes('debug=1') || window.location.hash.includes('debug=1');
    const debug = {
      ...(window.__OFB_DEBUG__ || {}),
      currentInitDataLength: state.initData ? state.initData.length : 0,
      currentTeamId: state.currentTeam?.team_id || null,
      loadingKeys: Object.keys(state.loading || {}),
      ...extra
    };

    if (isDebug && els.debugPanel && els.debugOutput) {
      els.debugOutput.textContent = JSON.stringify(debug, null, 2);
      setVisible(els.debugPanel, true);
    }

    console.log('[OFB DEBUG]', debug);
  }

  function getMaxInitData() {
    const candidates = [
      window.WebApp?.initData,
      window.MAX?.WebApp?.initData,
      window.max?.WebApp?.initData,
      window.MiniApp?.initData,
      window.location.hash?.includes('initData=')
        ? new URLSearchParams(window.location.hash.slice(1)).get('initData')
        : '',
      window.location.search?.includes('initData=')
        ? new URLSearchParams(window.location.search).get('initData')
        : ''
    ];

    const initData = candidates.find(v => typeof v === 'string' && v.length > 20) || '';

    window.__OFB_DEBUG__ = {
      href: window.location.href,
      userAgent: navigator.userAgent,
      apiBase: API_BASE,
      hasWebApp: !!window.WebApp,
      hasMAX: !!window.MAX,
      hasMAXWebApp: !!window.MAX?.WebApp,
      hasMax: !!window.max,
      hasMaxWebApp: !!window.max?.WebApp,
      hasMiniApp: !!window.MiniApp,
      initDataLength: initData.length,
      time: new Date().toISOString()
    };

    renderDebug();
    return initData;
  }

  function setupMaxShell() {
    try {
      const webApp = window.WebApp || window.MAX?.WebApp || window.max?.WebApp || window.MiniApp || null;
      webApp?.ready?.();
      webApp?.expand?.();
      webApp?.setHeaderColor?.('#071f35');
      webApp?.setBackgroundColor?.('#061a2d');
    } catch (e) {
      console.warn('MAX shell setup skipped', e);
    }
  }

  function showToast(text) {
    if (!els.toast) return;
    els.toast.textContent = text;
    setVisible(els.toast, true);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setVisible(els.toast, false), 2000);
  }

  function endpoint(path) {
    return `${API_BASE.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
  }

  function storageKey(path, payload) {
    const teamPart = state.currentTeam?.team_id ? `team:${state.currentTeam.team_id}:` : '';
    return STORAGE_PREFIX + teamPart + path + ':' + JSON.stringify(payload || {});
  }

  function saveLocal(path, payload, data) {
    try {
      localStorage.setItem(storageKey(path, payload), JSON.stringify({ time: Date.now(), data }));
    } catch (e) {}
  }

  function loadLocal(path, payload, maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
      const raw = localStorage.getItem(storageKey(path, payload));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || Date.now() - parsed.time > maxAgeMs) return null;
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  async function fetchWithRetry(url, options, retries = 1) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetch(url, options);
      } catch (e) {
        lastError = e;
        if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    throw lastError;
  }

  async function ofbApi(path, payload = {}, options = {}) {
    if (!state.initData) throw new Error('MAX initData not found');

    const cacheKey = `${path}:${JSON.stringify(payload)}`;
    const ttlMs = options.ttlMs ?? 30000;

    if (!options.noCache && state.cache[cacheKey] && Date.now() - state.cache[cacheKey].time < ttlMs) {
      return state.cache[cacheKey].data;
    }

    if (!options.noCache && options.useLocalCache) {
      const localData = loadLocal(path, payload, options.localTtlMs ?? ttlMs);
      if (localData) {
        state.cache[cacheKey] = { time: Date.now(), data: localData };
        return localData;
      }
    }

    if (state.loading[cacheKey]) return state.loading[cacheKey];

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const promise = fetchWithRetry(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.flat ? { initData: state.initData, ...payload } : { initData: state.initData, payload }),
      signal: controller.signal
    }, options.retries ?? 1)
      .then(async (res) => {
        const data = await res.json().catch(() => null);

        renderDebug({
          lastApiPath: path,
          lastApiStatus: res.status,
          lastApiOk: res.ok,
          lastApiResponseOk: data?.ok,
          lastApiError: data?.error || data?.message || null,
          servedFrom: data?.served_from || null
        });

        if (!res.ok || !data) {
          const err = new Error(data?.error || data?.message || `API error ${res.status}`);
          err.status = res.status;
          err.data = data;
          throw err;
        }

        if (data.ok === false) {
          const err = new Error(data.error || data.message || 'API returned ok=false');
          err.status = res.status;
          err.data = data;
          throw err;
        }

        state.cache[cacheKey] = { time: Date.now(), data };
        if (options.saveLocal !== false) saveLocal(path, payload, data);
        return data;
      })
      .finally(() => {
        clearTimeout(timeout);
        delete state.loading[cacheKey];
      });

    state.loading[cacheKey] = promise;
    return promise;
  }

  function safeArr(value) {
    return Array.isArray(value) ? value : [];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[c]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function formatDate(value) {
    if (!value) return 'Дата уточняется';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d);
  }


  function formatLongDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(d);
  }

  function teamChangeWarningText() {
    return `⚠️ Основную команду можно менять только раз в ${TEAM_CHANGE_LOCK_DAYS} дней.`;
  }

  function setButtonBusy(button, busy, busyText = 'Загрузка…') {
    if (!button) return;

    if (busy) {
      if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
      button.textContent = busyText;
      button.disabled = true;
      button.classList.add('button-loading');
      return;
    }

    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
    button.disabled = false;
    button.classList.remove('button-loading');
  }

  function setSearchBusy(busy) {
    setButtonBusy(els.teamSearchBtn, busy, 'Ищем…');
    if (els.teamSearchInput) els.teamSearchInput.disabled = busy;
  }

  function getSheetPanel() {
    return els.searchSheet?.querySelector('.sheet-panel') || null;
  }


  function formatCapacity(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return new Intl.NumberFormat('ru-RU').format(n);
  }

  function getVenueCapacity(profile = {}) {
    return profile.venue_capacity ||
      profile.capacity ||
      profile.venue?.capacity ||
      profile.stadium_capacity ||
      profile.venue_seats ||
      null;
  }

  function getFixtureDateValue(f) {
    const raw = f.kickoff_utc || f.fixture_date || f.date || f.kickoff || f.fixture?.date || '';
    const t = raw ? new Date(raw).getTime() : NaN;
    return Number.isFinite(t) ? t : 9999999999999;
  }

  function isFinishedFixture(f) {
    const status = String(f.status_short || f.status || '').toUpperCase();
    return ['FT', 'AET', 'PEN'].includes(status) || String(f.fixture_group || '').toLowerCase() === 'past';
  }

  function normalizeCurrentTeamFromDashboard(dashboard) {
    const team = dashboard?.team || null;
    if (!team?.team_id) return null;

    return {
      team_id: Number(team.team_id),
      team_name: team.team_name || `Команда ${team.team_id}`,
      league_id: team.league_id || null,
      league_name: team.league_name || '',
      notify_flags: team.notify_flags || {},
      logo_url: team.logo_url || dashboard?.profile?.logo_url || ''
    };
  }

  function renderShell() {
    setVisible(els.loadingState, false);

    if (!state.currentTeam) {
      setVisible(els.emptyState, true);
      setVisible(els.teamState, false);
      return;
    }

    setVisible(els.emptyState, false);
    setVisible(els.teamState, true);

    els.teamName.textContent = state.currentTeam.team_name;
    if (els.teamLeague) els.teamLeague.textContent = state.currentTeam.league_name ? `Подписка: ${state.currentTeam.league_name}` : 'Лига не выбрана';
    els.teamMeta.textContent = state.currentTeam.league_name || 'Команда выбрана';

    if (els.summaryTeamName) els.summaryTeamName.textContent = state.currentTeam.team_name;
    if (els.summaryLeagueName) els.summaryLeagueName.textContent = state.currentTeam.league_name || '—';

    setTeamLogo();
    applyFlags(state.currentTeam.notify_flags || {});
  }

  function setTeamLogo() {
    if (!state.currentTeam?.team_id || !els.teamLogo) return;

    const logo =
      state.currentTeam.logo_url ||
      state.dashboard?.profile?.logo_url ||
      `https://media.api-sports.io/football/teams/${state.currentTeam.team_id}.png`;

    els.teamLogo.src = logo;
    els.teamLogo.alt = state.currentTeam.team_name || 'Команда';
    els.teamLogo.onerror = () => {
      els.teamLogo.onerror = null;
      els.teamLogo.src = './assets/ofb-logo.jpg';
    };
    setVisible(els.teamLogo, true);
  }

  function applyFlags(flags) {
    state.flags = {
      goals: flags.goals !== false,
      final: flags.final !== false,
      reminder: flags.reminder !== false,
      news: flags.news !== false
    };

    document.querySelectorAll('[data-flag]').forEach((input) => {
      input.checked = !!state.flags[input.dataset.flag];
    });
  }

  function renderBlockLoading(el, text) {
    if (!el) return;
    el.innerHTML = `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(text)}</div>
          <div class="item-meta">Подождите несколько секунд…</div>
        </div>
      </div>
    `;
  }

  function renderBlockError(el, title, meta = 'Показываем старые данные, если они были сохранены.') {
    if (!el) return;
    el.innerHTML = `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(title)}</div>
          <div class="item-meta">${escapeHtml(meta)}</div>
        </div>
      </div>
    `;
  }

  function renderNoTeamState() {
    state.dashboard = null;
    state.currentTeam = null;
    setVisible(els.loadingState, false);
    setVisible(els.teamState, false);
    setVisible(els.emptyState, true);

    if (els.teamName) els.teamName.textContent = 'Команда';
    if (els.teamLeague) els.teamLeague.textContent = 'Лига не выбрана';
    if (els.teamMeta) els.teamMeta.textContent = 'Команда не выбрана';
    if (els.summaryTeamName) els.summaryTeamName.textContent = '—';
    if (els.summaryLeagueName) els.summaryLeagueName.textContent = '—';

    if (els.nextMatches) els.nextMatches.innerHTML = '';
    if (els.matchesList) els.matchesList.innerHTML = '';
    if (els.matchesCount) els.matchesCount.textContent = '0';
    if (els.squadGrid) els.squadGrid.innerHTML = '';
    if (els.squadCount) els.squadCount.textContent = '0';
    if (els.transfersList) els.transfersList.innerHTML = '';
    if (els.transfersCount) els.transfersCount.textContent = '0';

    if (els.overviewFixturesCount) els.overviewFixturesCount.textContent = '0';
    if (els.overviewSquadCount) els.overviewSquadCount.textContent = '0';
    if (els.overviewTransfersCount) els.overviewTransfersCount.textContent = '0';
  }

  function renderDashboard(dashboard, fromCache = false) {
    const hasNoTeam = dashboard?.has_team === false || !dashboard?.team;

    if (hasNoTeam) {
      if (!fromCache) clearOfbStorage();
      renderNoTeamState();
      return;
    }

    state.dashboard = dashboard;
    state.currentTeam = normalizeCurrentTeamFromDashboard(dashboard);

    renderShell();

    if (!state.currentTeam) {
      if (!fromCache) clearOfbStorage();
      renderNoTeamState();
      return;
    }

    const fixtures = safeArr(dashboard.fixtures);
    const squad = safeArr(dashboard.squad);
    const transfers = safeArr(dashboard.transfers);
    const stat = dashboard.stats || null;

    if (els.overviewCacheState) els.overviewCacheState.textContent = fromCache ? 'saved' : (dashboard.served_from || 'cache');
    if (els.overviewFixturesCount) els.overviewFixturesCount.textContent = String(fixtures.length);
    if (els.overviewSquadCount) els.overviewSquadCount.textContent = String(squad.length);
    if (els.overviewTransfersCount) els.overviewTransfersCount.textContent = String(transfers.length);

    renderFixtures(fixtures, fromCache);
    renderStats(stat);
    renderSeason(stat);
    renderSquad({ squad, count: squad.length }, fromCache);
    renderTransfers({ transfers, count: transfers.length }, fromCache);

    const profile = dashboard.profile || {};
    const city = profile.venue_city || profile.city || '';
    const venue = profile.venue_name || profile.stadium || '';
    const country = profile.country || '';
    const capacity = formatCapacity(getVenueCapacity(profile));
    const venueText = venue && capacity ? `${venue} · ${capacity} мест` : venue;
    const meta = [country, city, venueText].filter(Boolean).join(' · ');

    if (els.teamLeague) {
      els.teamLeague.textContent = state.currentTeam.league_name
        ? `Подписка: ${state.currentTeam.league_name}`
        : 'Лига не выбрана';
    }

    if (meta) els.teamMeta.textContent = meta;
  }

  async function loadDashboardCache() {
    setVisible(els.authNotice, false);

    const localDashboard = loadLocal('/ofb-api-dashboard-cache', {}, 24 * 60 * 60 * 1000);
    let hadLocal = false;

    if (localDashboard) {
      hadLocal = true;
      renderDashboard(localDashboard, true);
    } else {
      setVisible(els.loadingState, true);
    }

    try {
      const dashboard = await ofbApi('/ofb-api-dashboard-cache', {}, {
        noCache: true,
        timeoutMs: hadLocal ? 8000 : 15000,
        retries: 1
      });

      renderDashboard(dashboard, false);
    } catch (e) {
      console.error(e);
      setVisible(els.loadingState, false);

      if (!hadLocal) {
        setVisible(els.authNotice, true);
        renderBlockError(els.nextMatches, 'Кэш главной не загрузился', e.message);
        showToast('Кэш главной не загрузился');
      } else {
        console.warn('Кэш главной не обновился, показываем сохранённый', e);
      }
    }
  }

  function renderFixtures(fixtures, fromCache = false) {
    const sorted = fixtures.slice().sort((a, b) => {
      const da = getFixtureDateValue(a);
      const db = getFixtureDateValue(b);
      if (da !== db) return da - db;
      return Number(a.fixture_id || a.id || 0) - Number(b.fixture_id || b.id || 0);
    });

    const upcoming = sorted.filter((f) => !isFinishedFixture(f));
    const past = sorted.filter((f) => isFinishedFixture(f)).reverse();

    els.nextMatches.innerHTML = upcoming.length
      ? upcoming.slice(0, 4).map(matchItemHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Ближайших матчей пока нет</div><div class="item-meta">Кэш обновится автоматически.</div></div></div>`;

    els.matchesCount.textContent = fromCache ? `${sorted.length} saved` : String(sorted.length);

    if (!sorted.length) {
      els.matchesList.innerHTML = `<div class="item"><div class="item-main"><div class="item-title">Матчи пока не найдены</div><div class="item-meta">Проверьте позже или обновите кэш fixtures.</div></div></div>`;
      return;
    }

    const upcomingHtml = upcoming.length
      ? `<div class="match-section"><div class="match-section-title">Ближайшие</div>${upcoming.map(matchItemHtml).join('')}</div>`
      : '';

    const pastHtml = past.length
      ? `<div class="match-section"><div class="match-section-title">Прошедшие</div>${past.map(matchItemHtml).join('')}</div>`
      : '';

    els.matchesList.innerHTML = `${upcomingHtml}${pastHtml}`;
  }

  function matchItemHtml(f) {
    const home = escapeHtml(f.home_team || f.home || f.teams?.home?.name || 'Хозяева');
    const away = escapeHtml(f.away_team || f.away || f.teams?.away?.name || 'Гости');
    const status = escapeHtml(f.status_short || f.status || 'NS');
    const league = escapeHtml(f.league_name || f.league || f.league?.name || '');
    const date = formatDate(f.kickoff_utc || f.fixture_date || f.date || f.kickoff || f.fixture?.date);
    const hs = f.score_home ?? f.home_score ?? f.goals_home ?? f.goals?.home ?? null;
    const as = f.score_away ?? f.away_score ?? f.goals_away ?? f.goals?.away ?? null;
    const hasScore = hs !== null && hs !== undefined && as !== null && as !== undefined;
    const score = hasScore ? `${hs}:${as}` : status;
    const group = isFinishedFixture(f) ? 'Прошедший' : 'Ближайший';

    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${home} — ${away}</div>
          <div class="item-meta">${group} · ${date}${league ? ' · ' + league : ''}</div>
        </div>
        <div class="score">${escapeHtml(score)}</div>
      </div>
    `;
  }

  function renderStats(stat) {
    if (els.statsEmpty) els.statsEmpty.classList.toggle('hidden', !!stat);
    if (els.statsSeason) els.statsSeason.textContent = stat?.season || '—';
    if (els.statPlayed) els.statPlayed.textContent = stat?.played ?? '—';
    if (els.statWins) els.statWins.textContent = stat?.wins ?? '—';
    if (els.statDraws) els.statDraws.textContent = stat?.draws ?? '—';
    if (els.statLosses) els.statLosses.textContent = stat?.losses ?? '—';
    if (els.statGF) els.statGF.textContent = stat?.goals_for ?? '—';
    if (els.statGA) els.statGA.textContent = stat?.goals_against ?? '—';
  }

  function renderSeason(stat) {
    if (!stat) {
      if (els.seasonEmpty) els.seasonEmpty.classList.remove('hidden');
      if (els.seasonLeague) els.seasonLeague.textContent = '—';
      if (els.seasonTitle) els.seasonTitle.textContent = '—';
      if (els.seasonForm) els.seasonForm.innerHTML = '—';
      return;
    }

    if (els.seasonEmpty) els.seasonEmpty.classList.add('hidden');
    if (els.seasonLeague) els.seasonLeague.textContent = stat.league_name || 'Сезон';
    if (els.seasonTitle) els.seasonTitle.textContent = stat.season || '—';
    if (els.seasonForm) {
      const form = String(stat.form || '').trim();
      const last = form ? form.slice(-10).split('').map(ch => `<span class="form-dot">${escapeHtml(ch)}</span>`).join('') : '—';
      els.seasonForm.innerHTML = form ? `<div class="summary-label">Последние ${Math.min(10, form.length)}</div><div class="form-dots">${last}</div>` : '—';
    }
    if (els.seasonPlayed) els.seasonPlayed.textContent = stat.played ?? '—';
    if (els.seasonWins) els.seasonWins.textContent = stat.wins ?? '—';
    if (els.seasonDraws) els.seasonDraws.textContent = stat.draws ?? '—';
    if (els.seasonLosses) els.seasonLosses.textContent = stat.losses ?? '—';
    if (els.seasonGF) els.seasonGF.textContent = stat.goals_for ?? '—';
    if (els.seasonGA) els.seasonGA.textContent = stat.goals_against ?? '—';
    if (els.seasonCleanSheets) els.seasonCleanSheets.textContent = stat.clean_sheets ?? '—';
    if (els.seasonFailedToScore) els.seasonFailedToScore.textContent = stat.failed_to_score ?? '—';
  }

  function renderSquad(data, fromCache = false) {
    const squad = safeArr(data.squad || data.players);
    els.squadCount.textContent = fromCache ? `${squad.length} saved` : String(data.count ?? squad.length);
    els.squadGrid.innerHTML = squad.length
      ? squad.map(playerCardHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Состав пока не найден</div><div class="item-meta">Кэш состава обновляется по расписанию.</div></div></div>`;
  }

  function playerCardHtml(p) {
    const name = p.player_name || p.name || p.player?.name || 'Игрок';
    const role = p.position || p.role || p.player?.position || '';
    const playerId = p.player_id || p.id || p.player?.id || '';
    const photo =
      p.photo_url ||
      p.photo ||
      p.player?.photo ||
      (playerId ? `https://media.api-sports.io/football/players/${playerId}.png` : './assets/ofb-logo.jpg');
    const number = p.number ? `№${p.number}` : '';

    return `
      <div class="player-card">
        <img class="player-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='./assets/ofb-logo.jpg'" />
        <div>
          <div class="player-name">${escapeHtml(name)}</div>
          <div class="player-role">${escapeHtml([number, role || 'Футболист'].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
    `;
  }

  function renderTransfers(data, fromCache = false) {
    const transfers = safeArr(data.transfers || data.items).slice().sort((a, b) => {
      const da = new Date(a.transfer_date || a.date || 0).getTime();
      const db = new Date(b.transfer_date || b.date || 0).getTime();
      return (Number.isFinite(db) ? db : 0) - (Number.isFinite(da) ? da : 0);
    });

    els.transfersCount.textContent = fromCache ? `${transfers.length} saved` : String(data.count ?? transfers.length);
    els.transfersList.innerHTML = transfers.length
      ? transfers.slice(0, 10).map(transferItemHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Трансферы пока не найдены</div><div class="item-meta">Данные появятся после обновления кэша.</div></div></div>`;
  }

  function transferItemHtml(t) {
    const player = t.player_name || t.player?.name || t.name || 'Игрок';
    const type = t.transfer_type || t.type || t.direction || 'Трансфер';
    const from = t.from_team || t.teams?.out?.name || t.from || '';
    const to = t.to_team || t.teams?.in?.name || t.to || '';
    const date = t.transfer_date || t.date ? formatDate(t.transfer_date || t.date) : '';
    const photo = t.photo_url || t.photo || t.player_photo || t.player?.photo || './assets/ofb-logo.jpg';

    return `
      <div class="item">
        <img class="player-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='./assets/ofb-logo.jpg'" />
        <div class="item-main">
          <div class="item-title">${escapeHtml(player)}</div>
          <div class="item-meta">${escapeHtml(type)}${from || to ? ` · ${escapeHtml(from)} → ${escapeHtml(to)}` : ''}${date ? ` · ${date}` : ''}</div>
        </div>
      </div>
    `;
  }

  async function searchTeams() {
    const q = els.teamSearchInput.value.trim();
    const requestId = Date.now();
    state.activeSearchRequestId = requestId;

    state.selectedTeamCard = null;
    state.selectedLeague = null;
    renderTeamCard(null);

    if (q.length < 3) {
      els.searchHint.textContent = `Введите минимум 3 символа. ${teamChangeWarningText()}`;
      els.searchResults.innerHTML = '';
      return;
    }

    setSearchBusy(true);
    els.searchHint.textContent = 'Ищем команду…';
    els.searchResults.innerHTML = `
      <div class="item">
        <div class="item-main">
          <div class="item-title">Идёт поиск</div>
          <div class="item-meta">Обычно занимает несколько секунд…</div>
        </div>
      </div>
    `;

    try {
      const data = await ofbApi('/ofb-api-team-search', { q }, {
        timeoutMs: 12000,
        retries: 1,
        useLocalCache: true,
        localTtlMs: 5 * 60 * 1000
      });

      if (state.activeSearchRequestId !== requestId) return;

      const teams = safeArr(data.teams);
      els.searchHint.textContent = teams.length ? `Выберите команду, потом лигу. ${teamChangeWarningText()}` : 'Команды не найдены.';
      els.searchResults.innerHTML = teams.length
        ? teams.map(teamResultHtml).join('')
        : `<div class="item"><div class="item-main"><div class="item-title">Команды не найдены</div><div class="item-meta">Попробуйте другое название на английском.</div></div></div>`;
    } catch (e) {
      if (state.activeSearchRequestId !== requestId) return;
      console.error(e);
      els.searchHint.textContent = 'Ошибка поиска. Попробуйте позже.';
      els.searchResults.innerHTML = '';
    } finally {
      if (state.activeSearchRequestId === requestId) setSearchBusy(false);
    }
  }

  function teamResultHtml(t) {
    const teamId = t.team_id || t.id;
    const teamName = t.team_name || t.name || 'Команда';
    const meta = [t.country, t.league_name || t.league?.name].filter(Boolean).join(' · ');

    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(teamName)}</div>
          ${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ''}
        </div>
        <button class="primary-button compact" data-open-team-card="${escapeAttr(teamId)}" data-team-name="${escapeAttr(teamName)}" type="button">
          Выбрать
        </button>
      </div>
    `;
  }

  async function openTeamCard(teamId, fallbackTeamName = '', sourceButton = null) {
    const requestId = Date.now();
    state.activeTeamCardRequestId = requestId;
    state.selectedTeamCard = null;
    state.selectedLeague = null;

    setButtonBusy(sourceButton, true, 'Открываем…');
    els.searchHint.textContent = `Загружаем лиги и турниры… ${teamChangeWarningText()}`;
    renderTeamCard({
      loading: true,
      team: {
        team_id: Number(teamId),
        team_name: fallbackTeamName || `Команда ${teamId}`
      },
      available_leagues: []
    });
    scrollTeamCardIntoView(20);

    try {
      const data = await ofbApi('/ofb-api-team-card', { team_id: Number(teamId) }, {
        timeoutMs: 12000,
        retries: 1,
        useLocalCache: true,
        localTtlMs: 10 * 60 * 1000
      });

      if (state.activeTeamCardRequestId !== requestId) return;

      const team = normalizeTeamCardTeam(data, teamId, fallbackTeamName);
      let availableLeagues = safeArr(data.available_leagues);
      const selectedLeague =
        data.selected_league ||
        (availableLeagues.length === 1 ? availableLeagues[0] : null);

      if (selectedLeague?.league_id && selectedLeague?.league_name && !availableLeagues.some(l => Number(l.league_id || l.id) === Number(selectedLeague.league_id))) {
        availableLeagues = [selectedLeague, ...availableLeagues];
      }

      state.selectedTeamCard = {
        ...data,
        team,
        available_leagues: availableLeagues
      };
      state.selectedLeague = selectedLeague;

      els.searchHint.textContent = availableLeagues.length > 1
        ? `Выберите лигу/турнир для подписки. ${teamChangeWarningText()}`
        : `Лига выбрана автоматически. ${teamChangeWarningText()}`;

      renderTeamCard(state.selectedTeamCard);
      scrollTeamCardIntoView(120);
    } catch (e) {
      if (state.activeTeamCardRequestId !== requestId) return;
      console.error(e);
      els.searchHint.textContent = 'Карточка команды не загрузилась.';
      renderTeamCard({
        error: e.message,
        team: {
          team_id: Number(teamId),
          team_name: fallbackTeamName || `Команда ${teamId}`
        },
        available_leagues: []
      });
      scrollTeamCardIntoView(80);
    } finally {
      if (state.activeTeamCardRequestId === requestId) setButtonBusy(sourceButton, false);
    }
  }

  function normalizeTeamCardTeam(data, fallbackTeamId, fallbackTeamName = '') {
    const raw = data.team || data.profile || data.card || {};
    const id = raw.team_id || raw.id || data.team_id || fallbackTeamId;
    const name = raw.team_name || raw.name || data.team_name || fallbackTeamName || `Команда ${id}`;
    const logo = raw.logo_url || raw.logo || data.logo_url || `https://media.api-sports.io/football/teams/${id}.png`;

    return {
      ...raw,
      team_id: Number(id),
      team_name: name,
      logo_url: logo
    };
  }

  function normalizeLeague(raw) {
    if (!raw) return null;

    return {
      ...raw,
      league_id: Number(raw.league_id || raw.id),
      league_name: String(raw.league_name || raw.name || '').trim(),
      country: raw.country || '',
      season: raw.season || ''
    };
  }

  function scrollTeamCardIntoView(delay = 80) {
    if (!els.teamCardBox) return;

    window.setTimeout(() => {
      const panel = getSheetPanel();

      if (panel && panel.contains(els.teamCardBox)) {
        const targetTop = Math.max(0, els.teamCardBox.offsetTop - 12);

        try {
          panel.scrollTo({ top: targetTop, behavior: 'smooth' });
        } catch (e) {
          panel.scrollTop = targetTop;
        }

        return;
      }

      try {
        els.teamCardBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        els.teamCardBox.scrollIntoView();
      }
    }, delay);
  }

  function renderTeamCard(card) {
    if (!els.teamCardBox) return;

    if (!card) {
      setVisible(els.teamCardBox, false);
      els.teamCardBox.innerHTML = '';
      return;
    }

    const team = card.team || {};
    const leagues = safeArr(card.available_leagues).map(normalizeLeague).filter(l => l?.league_id && l?.league_name);
    const selected = normalizeLeague(state.selectedLeague);

    setVisible(els.teamCardBox, true);

    if (card.loading) {
      els.teamCardBox.innerHTML = `
        <article class="card">
          <div class="item">
            <img class="team-card-logo" src="${escapeAttr(team.logo_url || './assets/ofb-logo.jpg')}" alt="" onerror="this.src='./assets/ofb-logo.jpg'" />
            <div class="item-main">
              <div class="item-title">${escapeHtml(team.team_name || 'Команда')}</div>
              <div class="item-meta">Загружаем лиги и турниры…</div>
            </div>
          </div>
        </article>
      `;
      return;
    }

    if (card.error) {
      els.teamCardBox.innerHTML = `
        <article class="card">
          <div class="item">
            <div class="item-main">
              <div class="item-title">${escapeHtml(team.team_name || 'Команда')}</div>
              <div class="item-meta">${escapeHtml(card.error)}</div>
            </div>
          </div>
        </article>
      `;
      return;
    }

    const isSubscribed = !!card.is_subscribed;
    const leagueButtons = leagues.length
      ? leagues.map(l => `
          <button class="league-option ${selected?.league_id === l.league_id ? 'active' : ''}"
                  data-select-league="${escapeAttr(l.league_id)}"
                  type="button">
            ${escapeHtml(l.league_name)}
            ${l.country ? `<span class="item-meta"> · ${escapeHtml(l.country)}</span>` : ''}
            ${l.season ? `<span class="item-meta"> · ${escapeHtml(l.season)}</span>` : ''}
          </button>
        `).join('')
      : `<div class="item-meta">Лиги не найдены. Подписка недоступна.</div>`;

    const disabled = !selected?.league_id || !selected?.league_name;
    const buttonText = disabled
      ? 'Сначала выберите лигу'
      : `${isSubscribed ? 'Обновить подписку' : 'Подписаться'} на ${team.team_name} / ${selected.league_name}`;

    els.teamCardBox.innerHTML = `
      <article class="card">
        <div class="item">
          <img class="team-card-logo" src="${escapeAttr(team.logo_url || './assets/ofb-logo.jpg')}" alt="" onerror="this.src='./assets/ofb-logo.jpg'" />
          <div class="item-main">
            <div class="item-title">${escapeHtml(team.team_name || 'Команда')}</div>
            <div class="item-meta">${isSubscribed ? `Команда уже выбрана. ${teamChangeWarningText()}` : `Выберите турнир для подписки. ${teamChangeWarningText()}`}</div>
          </div>
        </div>

        <div class="league-choice-title">Выбор лиги / турнира</div>
        <div class="league-options">
          ${leagueButtons}
        </div>

        <div class="warning-box">
          ${escapeHtml(teamChangeWarningText())}<br />
          После сохранения команда и лига станут основной подпиской.
        </div>

        <button class="primary-button full-width subscribe-line"
                id="subscribeSelectedLeagueBtn"
                type="button"
                data-subscribe-ready="${disabled ? '0' : '1'}"
                aria-disabled="${disabled ? 'true' : 'false'}">
          ${escapeHtml(buttonText)}
        </button>
      </article>
    `;

    bindTeamCardInteractiveTaps();
  }

  function runSubscribeButton(source, e, btnOverride = null) {
    const btn = btnOverride || document.getElementById('subscribeSelectedLeagueBtn');
    if (!btn) return;

    renderDebug({
      subscribeTapSource: source,
      subscribeReady: btn.dataset.subscribeReady || null,
      selectedLeagueId: state.selectedLeague?.league_id || null,
      eventType: e?.type || null
    });

    if (btn.dataset.subscribeReady === '0') {
      showToast('Сначала выберите лигу');
      scrollTeamCardIntoView(40);
      return;
    }

    subscribeSelectedTeam(source);
  }

  function bindTeamCardInteractiveTaps() {
    const dedupe = (key, ms = 650) => {
      const now = Date.now();
      window.__OFB_TAP_DEDUPE__ = window.__OFB_TAP_DEDUPE__ || {};
      if (window.__OFB_TAP_DEDUPE__[key] && now - window.__OFB_TAP_DEDUPE__[key] < ms) return false;
      window.__OFB_TAP_DEDUPE__[key] = now;
      return true;
    };

    document.querySelectorAll('[data-select-league]').forEach((btn) => {
      if (btn.dataset.tapBound === '1') return;
      btn.dataset.tapBound = '1';

      const handleLeague = (source, e) => {
        if (!dedupe(`league:${btn.dataset.selectLeague}`, 450)) return;
        renderDebug({ leagueTapSource: source, leagueId: btn.dataset.selectLeague, eventType: e?.type || null });
        selectLeague(btn.dataset.selectLeague);
      };

      btn.addEventListener('click', (e) => handleLeague('league_click', e));
      btn.addEventListener('touchend', (e) => handleLeague('league_touchend', e), { passive: true });
      btn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') handleLeague('league_pointerup', e);
      }, { passive: true });
    });

    const subscribeBtn = document.getElementById('subscribeSelectedLeagueBtn');
    if (subscribeBtn && subscribeBtn.dataset.tapBound !== '1') {
      subscribeBtn.dataset.tapBound = '1';

      const handleSubscribe = (source, e) => {
        if (!dedupe('subscribe', 800)) return;
        renderDebug({ subscribeTapSource: source, eventType: e?.type || null, subscribeReady: subscribeBtn.dataset.subscribeReady || null });
        runSubscribeButton(source, e, subscribeBtn);
      };

      subscribeBtn.addEventListener('click', (e) => handleSubscribe('subscribe_click', e));
      subscribeBtn.addEventListener('touchend', (e) => handleSubscribe('subscribe_touchend', e), { passive: true });
      subscribeBtn.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') handleSubscribe('subscribe_pointerup', e);
      }, { passive: true });
    }
  }

  function selectLeague(leagueId) {
    const card = state.selectedTeamCard;
    if (!card) return;

    const league = safeArr(card.available_leagues)
      .map(normalizeLeague)
      .find(l => Number(l.league_id) === Number(leagueId));

    state.selectedLeague = league || null;
    if (league?.league_name && els.searchHint) {
      els.searchHint.textContent = `Выбрана лига: ${league.league_name}. ${teamChangeWarningText()}`;
    }
    renderTeamCard(card);
    scrollTeamCardIntoView(60);
  }

  async function subscribeSelectedTeam(source = 'manual') {
    if (state.savingSubscription) return;

    renderDebug({ subscribeRunSource: source, subscribeRunAt: new Date().toISOString() });

    const card = state.selectedTeamCard;
    const team = card?.team;
    const league = normalizeLeague(state.selectedLeague);

    if (!team?.team_id || !team?.team_name) {
      showToast('Сначала выберите команду');
      return;
    }

    if (!league?.league_id || !league?.league_name) {
      showToast('Сначала выберите лигу');
      return;
    }

    const subscribeBtn = document.getElementById('subscribeSelectedLeagueBtn');
    state.savingSubscription = true;
    setButtonBusy(subscribeBtn, true, 'Проверяем…');

    try {
      showToast('Проверяем возможность смены…');

      const result = await ofbApi('/ofb-api-subscribe', {
        team_id: Number(team.team_id),
        team_name: String(team.team_name),
        league_id: Number(league.league_id),
        league_name: String(league.league_name)
      }, {
        noCache: true,
        timeoutMs: 20000,
        retries: 1,
        saveLocal: false,
        flat: true
      });

      if (result?.allowed === false || result?.result_status === 'change_locked') {
        const date = formatLongDate(result.next_allowed_at);
        const current = result.current_subscription?.team_name || result.subscription?.team_name || state.currentTeam?.team_name || 'текущая команда';
        showToast(date ? `Смена доступна: ${date}` : `Команду можно менять раз в ${TEAM_CHANGE_LOCK_DAYS} дней`);
        if (els.searchHint) els.searchHint.textContent = date
          ? `Смена команды пока недоступна. Следующая смена: ${date}.`
          : `Смена команды пока недоступна. ${teamChangeWarningText()}`;
        if (els.teamCardBox) {
          els.teamCardBox.insertAdjacentHTML('afterbegin', `
            <div class="warning-box lock-notice">
              ⏳ <b>Смена команды пока недоступна</b><br />
              Текущая команда: ${escapeHtml(current)}<br />
              ${date ? `Следующая смена: ${escapeHtml(date)}` : escapeHtml(teamChangeWarningText())}
            </div>
          `);
        }
        scrollTeamCardIntoView(60);
        return;
      }

      closeSearch();
      showToast('Команда сохранена. Загружаем данные…');
      clearOfbStorage();
      await loadDashboardCache();
      showToast(`${team.team_name} / ${league.league_name} выбраны`);
    } catch (e) {
      console.error(e);
      const errorCode = e.data?.error || e.data?.result_status || e.message;
      const nextAllowedAt = e.data?.next_allowed_at || e.data?.nextAllowedAt || e.data?.subscription?.next_allowed_at;

      if (errorCode === 'league_required') {
        showToast('Сначала выберите лигу');
        return;
      }

      if (errorCode === 'change_locked' || errorCode === 'team_change_locked') {
        const date = formatLongDate(nextAllowedAt);
        const current = e.data?.current_subscription?.team_name || e.data?.subscription?.team_name || state.currentTeam?.team_name || 'текущая команда';
        showToast(date ? `Смена доступна: ${date}` : `Команду можно менять раз в ${TEAM_CHANGE_LOCK_DAYS} дней`);
        if (els.searchHint) els.searchHint.textContent = date
          ? `Смена команды пока недоступна. Следующая смена: ${date}.`
          : `Смена команды пока недоступна. ${teamChangeWarningText()}`;
        if (els.teamCardBox) {
          els.teamCardBox.insertAdjacentHTML('afterbegin', `
            <div class="warning-box lock-notice">
              ⏳ <b>Смена команды пока недоступна</b><br />
              Текущая команда: ${escapeHtml(current)}<br />
              ${date ? `Следующая смена: ${escapeHtml(date)}` : escapeHtml(teamChangeWarningText())}
            </div>
          `);
        }
        scrollTeamCardIntoView(60);
        return;
      }

      showToast('Не удалось сохранить подписку');
    } finally {
      state.savingSubscription = false;
      setButtonBusy(document.getElementById('subscribeSelectedLeagueBtn'), false);
    }
  }

  function clearOfbStorage() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('ofb_mini_app_')) localStorage.removeItem(key);
      }
    } catch (e) {}
  }

  async function updateFlags(changedFlag, checked) {
    if (!state.currentTeam?.team_id) return;

    const oldFlags = { ...state.flags };
    state.flags[changedFlag] = checked;

    try {
      await ofbApi('/ofb-api-update-flags', {
        team_id: state.currentTeam.team_id,
        notify_flags: state.flags
      }, { noCache: true, timeoutMs: 20000, retries: 1 });

      const cached = loadLocal('/ofb-api-dashboard-cache', {}, 24 * 60 * 60 * 1000);
      if (cached?.team) {
        cached.team.notify_flags = { ...state.flags };
        saveLocal('/ofb-api-dashboard-cache', {}, cached);
      }

      showToast('Настройки сохранены');
    } catch (e) {
      console.error(e);
      state.flags = oldFlags;
      applyFlags(oldFlags);
      showToast('Не удалось сохранить настройки');
    }
  }

  function openSearch() {
    state.selectedTeamCard = null;
    state.selectedLeague = null;
    renderTeamCard(null);
    if (els.searchHint) els.searchHint.textContent = `Введите минимум 3 символа. ${teamChangeWarningText()}`;
    setVisible(els.searchSheet, true);
    setTimeout(() => els.teamSearchInput.focus(), 50);
  }

  function closeSearch() {
    setVisible(els.searchSheet, false);
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-page').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  }

  function bindEvents() {
    els.refreshBtn.addEventListener('click', () => loadDashboardCache());
    if (els.clearAppCacheBtn) {
      els.clearAppCacheBtn.addEventListener('click', () => {
        clearOfbStorage();
        showToast('Кэш приложения сброшен');
        setTimeout(() => window.location.reload(), 350);
      });
    }
    els.openSearchBtn.addEventListener('click', openSearch);
    els.replaceTeamBtn.addEventListener('click', openSearch);
    if (els.overviewReplaceTeamBtn) els.overviewReplaceTeamBtn.addEventListener('click', openSearch);
    els.closeSearchBtn.addEventListener('click', closeSearch);
    els.closeSearchBackdrop.addEventListener('click', closeSearch);
    els.teamSearchBtn.addEventListener('click', searchTeams);
    els.teamSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchTeams();
      }
    });

    document.addEventListener('click', (e) => {
      const teamCardBtn = e.target.closest('[data-open-team-card]');
      if (teamCardBtn) {
        openTeamCard(teamCardBtn.dataset.openTeamCard, teamCardBtn.dataset.teamName, teamCardBtn);
        return;
      }

      const leagueBtn = e.target.closest('[data-select-league]');
      if (leagueBtn) {
        selectLeague(leagueBtn.dataset.selectLeague);
        return;
      }

      const subscribeBtn = e.target.closest('#subscribeSelectedLeagueBtn');
      if (subscribeBtn) {
        runSubscribeButton('delegated_click', e, subscribeBtn);
        return;
      }

      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) switchTab(tabBtn.dataset.tab);

      const jump = e.target.closest('[data-tab-jump]');
      if (jump) switchTab(jump.dataset.tabJump);
    });

    document.querySelectorAll('[data-flag]').forEach((input) => {
      input.addEventListener('change', () => updateFlags(input.dataset.flag, input.checked));
    });
  }



  // V10.14: глобальный capture touch убран. Touch/tap обработчики вешаются только на реальные кнопки после рендера карточки.

  async function init() {
    if (window.location.search.includes('clear=1') || window.location.hash.includes('clear=1')) {
      clearOfbStorage();
    }

    setupMaxShell();
    bindEvents();
    for (let i = 0; i < 20; i++) {
      state.initData = getMaxInitData();
      if (state.initData) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    renderDebug({ initFinished: true });

    if (!state.initData) {
      setVisible(els.loadingState, false);
      setVisible(els.authNotice, true);
      setVisible(els.emptyState, true);
      return;
    }

    await loadDashboardCache();
  }

  init();
})();
