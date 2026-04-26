(() => {
  const API_BASE = (window.OFB_CONFIG && window.OFB_CONFIG.API_BASE) || '/webhook';

  const state = {
    initData: '',
    profile: null,
    currentTeam: null,
    flags: {},
    loaded: {
      profile: false,
      teamProfile: false,
      fixtures: false,
      squad: false,
      transfers: false,
      stats: false
    },
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
    searchSheet: $('searchSheet'),
    closeSearchBtn: $('closeSearchBtn'),
    closeSearchBackdrop: $('closeSearchBackdrop'),
    teamSearchInput: $('teamSearchInput'),
    teamSearchBtn: $('teamSearchBtn'),
    searchResults: $('searchResults'),
    searchHint: $('searchHint'),
    teamName: $('teamName'),
    teamMeta: $('teamMeta'),
    teamLogo: $('teamLogo'),
    toast: $('toast'),
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
      loaded: state.loaded,
      loading: state.loading,
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
      webAppKeys: window.WebApp ? Object.keys(window.WebApp) : [],
      maxKeys: window.MAX ? Object.keys(window.MAX) : [],
      maxWebAppKeys: window.MAX?.WebApp ? Object.keys(window.MAX.WebApp) : [],
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
    showToast._t = window.setTimeout(() => setVisible(els.toast, false), 2400);
  }

  function endpoint(path) {
    const cleanBase = API_BASE.replace(/\/$/, '');
    const cleanPath = String(path).replace(/^\//, '');
    return `${cleanBase}/${cleanPath}`;
  }

  async function ofbApi(path, payload = {}, options = {}) {
    if (!state.initData) {
      throw new Error('MAX initData not found');
    }

    const cacheKey = `${path}:${JSON.stringify(payload)}`;
    const ttlMs = options.ttlMs ?? 20000;

    if (!options.noCache && state.cache[cacheKey] && Date.now() - state.cache[cacheKey].time < ttlMs) {
      return state.cache[cacheKey].data;
    }

    if (state.loading[cacheKey]) {
      return state.loading[cacheKey];
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const promise = fetch(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: state.initData, payload }),
      signal: controller.signal
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);

        renderDebug({
          lastApiPath: path,
          lastApiStatus: res.status,
          lastApiOk: res.ok,
          lastApiResponseOk: data?.ok,
          lastApiError: data?.error || data?.message || null
        });

        if (!res.ok || !data) {
          throw new Error(data?.error || data?.message || `API error ${res.status}`);
        }

        if (data.ok === false) {
          throw new Error(data.error || data.message || 'API returned ok=false');
        }

        state.cache[cacheKey] = { time: Date.now(), data };
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

  function normalizeCurrentTeam(profile) {
    const subscriptions =
      safeArr(profile?.subscriptions).length ? safeArr(profile.subscriptions)
      : safeArr(profile?.teams).length ? safeArr(profile.teams)
      : profile?.subscription ? [profile.subscription]
      : profile?.team ? [profile.team]
      : [];

    const sub = subscriptions[0] || null;
    if (!sub) return null;

    return {
      team_id: Number(sub.team_id || sub.id),
      team_name: sub.team_name || sub.name || `Команда ${sub.team_id || sub.id}`,
      league_id: sub.league_id || null,
      league_name: sub.league_name || '',
      notify_flags: sub.notify_flags || profile?.notify_flags || {}
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
    els.teamMeta.textContent = state.currentTeam.league_name || 'Команда выбрана';
    applyFlags(state.currentTeam.notify_flags || {});
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

  function renderBlockError(el, title, meta = 'Попробуйте обновить экран.') {
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

  async function loadProfile() {
    setVisible(els.loadingState, true);
    try {
      state.cache = {};
      state.loaded = {
        profile: false,
        teamProfile: false,
        fixtures: false,
        squad: false,
        transfers: false,
        stats: false
      };

      const profile = await ofbApi('/ofb-api-profile', {}, { noCache: true, timeoutMs: 15000 });
      state.profile = profile;
      state.currentTeam = normalizeCurrentTeam(profile);
      state.loaded.profile = true;

      renderShell();

      if (state.currentTeam) {
        // Не грузим всё сразу. Так меньше лагов и меньше шанс упереться в rate limit.
        await loadFixtures();
        loadTeamProfile().catch(console.warn);
        loadStats().catch(console.warn);
      }
    } catch (e) {
      console.error(e);
      setVisible(els.loadingState, false);
      setVisible(els.authNotice, true);
      renderBlockError(els.nextMatches, 'Профиль не загрузился', e.message);
      showToast('Не удалось загрузить профиль');
    }
  }

  async function loadTeamProfile() {
    if (!state.currentTeam?.team_id || state.loaded.teamProfile) return;

    try {
      const data = await ofbApi('/ofb-api-team-profile', { team_id: state.currentTeam.team_id });
      const profile = data.profile || data.team_profile || data.team || null;

      if (profile?.logo_url || profile?.logo) {
        els.teamLogo.src = profile.logo_url || profile.logo;
        els.teamLogo.alt = state.currentTeam.team_name;
        setVisible(els.teamLogo, true);
      }

      const city = profile?.venue_city || profile?.city || '';
      const venue = profile?.venue_name || '';
      const country = profile?.country || '';
      const meta = [country, city, venue].filter(Boolean).join(' · ');
      if (meta) els.teamMeta.textContent = meta;

      state.loaded.teamProfile = true;
    } catch (e) {
      console.warn('team profile not loaded', e);
    }
  }

  async function loadFixtures() {
    if (!state.currentTeam?.team_id) return;

    if (!state.loaded.fixtures) {
      renderBlockLoading(els.nextMatches, 'Загружаем матчи');
      renderBlockLoading(els.matchesList, 'Загружаем матчи');
    }

    try {
      const data = await ofbApi('/ofb-api-team-fixtures', { team_id: state.currentTeam.team_id }, { timeoutMs: 15000 });
      const fixtures = safeArr(data.fixtures || data.next_fixtures || data.matches);
      renderFixtures(fixtures);
      state.loaded.fixtures = true;
    } catch (e) {
      console.error(e);
      renderBlockError(els.nextMatches, 'Матчи не загрузились', e.message);
      renderBlockError(els.matchesList, 'Матчи не загрузились', e.message);
      els.matchesCount.textContent = '0';
      showToast('Матчи не загрузились');
    }
  }

  function renderFixtures(fixtures) {
    const sorted = fixtures.slice().sort((a, b) => {
      const ga = String(a.fixture_group || '');
      const gb = String(b.fixture_group || '');
      if (ga === 'upcoming' && gb !== 'upcoming') return -1;
      if (ga !== 'upcoming' && gb === 'upcoming') return 1;
      return new Date(a.kickoff_utc || a.date || 0) - new Date(b.kickoff_utc || b.date || 0);
    });

    const next = sorted.filter((f) => String(f.fixture_group || '') === 'upcoming' || !['FT', 'AET', 'PEN'].includes(String(f.status_short || ''))).slice(0, 4);

    els.nextMatches.innerHTML = next.length
      ? next.map(matchItemHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Ближайших матчей пока нет</div><div class="item-meta">Кэш обновится автоматически.</div></div></div>`;

    els.matchesCount.textContent = String(sorted.length);
    els.matchesList.innerHTML = sorted.length
      ? sorted.map(matchItemHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Матчи пока не найдены</div><div class="item-meta">Проверьте позже или обновите кэш fixtures.</div></div></div>`;
  }

  function matchItemHtml(f) {
    const home = escapeHtml(f.home_team || f.home || 'Хозяева');
    const away = escapeHtml(f.away_team || f.away || 'Гости');
    const status = escapeHtml(f.status_short || f.status || 'NS');
    const league = escapeHtml(f.league_name || f.league || '');
    const date = formatDate(f.kickoff_utc || f.date);
    const hs = f.score_home ?? f.home_score ?? f.goals_home ?? null;
    const as = f.score_away ?? f.away_score ?? f.goals_away ?? null;
    const hasScore = hs !== null && hs !== undefined && as !== null && as !== undefined;
    const score = hasScore ? `${hs}:${as}` : status;
    const group = f.fixture_group === 'past' ? 'Прошедший' : 'Ближайший';

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

  async function loadStats() {
    if (!state.currentTeam?.team_id || state.loaded.stats) return;

    try {
      const payload = { team_id: state.currentTeam.team_id };
      if (state.currentTeam.league_id) payload.league_id = state.currentTeam.league_id;

      const data = await ofbApi('/ofb-api-team-season-stats', payload, { timeoutMs: 15000 });
      const stat = safeArr(data.stats)[0] || data.stat || data.season_stats || null;
      renderStats(stat);
      state.loaded.stats = true;
    } catch (e) {
      console.warn('stats not loaded', e);
      renderStats(null);
    }
  }

  function renderStats(stat) {
    els.statsEmpty.classList.toggle('hidden', !!stat);
    els.statsSeason.textContent = stat?.season || '—';
    els.statPlayed.textContent = stat?.played ?? stat?.matches_played ?? '—';
    els.statWins.textContent = stat?.wins ?? '—';
    els.statDraws.textContent = stat?.draws ?? '—';
    els.statLosses.textContent = stat?.losses ?? '—';
    els.statGF.textContent = stat?.goals_for ?? stat?.for ?? '—';
    els.statGA.textContent = stat?.goals_against ?? stat?.against ?? '—';
  }

  async function loadSquad() {
    if (!state.currentTeam?.team_id) return;
    if (state.loaded.squad) return;

    renderBlockLoading(els.squadGrid, 'Загружаем состав');

    try {
      const data = await ofbApi('/ofb-api-team-squad', { team_id: state.currentTeam.team_id }, { timeoutMs: 15000 });
      const squad = safeArr(data.squad || data.players);
      els.squadCount.textContent = String(data.count ?? squad.length);
      els.squadGrid.innerHTML = squad.length
        ? squad.map(playerCardHtml).join('')
        : `<div class="item"><div class="item-main"><div class="item-title">Состав пока не найден</div><div class="item-meta">Кэш состава обновляется по расписанию.</div></div></div>`;
      state.loaded.squad = true;
    } catch (e) {
      console.error(e);
      renderBlockError(els.squadGrid, 'Состав не загрузился', e.message);
      els.squadCount.textContent = '0';
      showToast('Состав не загрузился');
    }
  }

  function playerCardHtml(p) {
    const name = p.player_name || p.name || p.player?.name || 'Игрок';
    const role = p.position || p.role || p.player?.position || '';
    const photo = p.photo_url || p.photo || p.player?.photo || './assets/ofb-logo.jpg';
    const number = p.number ? `№${p.number}` : '';

    return `
      <div class="player-card">
        <img class="player-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" onerror="this.src='./assets/ofb-logo.jpg'" />
        <div>
          <div class="player-name">${escapeHtml(name)}</div>
          <div class="player-role">${escapeHtml([number, role || 'Футболист'].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
    `;
  }

  async function loadTransfers() {
    if (!state.currentTeam?.team_id) return;
    if (state.loaded.transfers) return;

    renderBlockLoading(els.transfersList, 'Загружаем трансферы');

    try {
      const data = await ofbApi('/ofb-api-team-transfers', { team_id: state.currentTeam.team_id }, { timeoutMs: 15000 });
      const transfers = safeArr(data.transfers || data.items);
      els.transfersCount.textContent = String(data.count ?? transfers.length);
      els.transfersList.innerHTML = transfers.length
        ? transfers.map(transferItemHtml).join('')
        : `<div class="item"><div class="item-main"><div class="item-title">Трансферы пока не найдены</div><div class="item-meta">Данные появятся после обновления кэша.</div></div></div>`;
      state.loaded.transfers = true;
    } catch (e) {
      console.error(e);
      renderBlockError(els.transfersList, 'Трансферы не загрузились', e.message);
      els.transfersCount.textContent = '0';
      showToast('Трансферы не загрузились');
    }
  }

  function transferItemHtml(t) {
    const player = t.player_name || t.player?.name || t.name || 'Игрок';
    const type = t.transfer_type || t.type || t.direction || 'Трансфер';
    const from = t.from_team || t.teams?.out?.name || t.from || '';
    const to = t.to_team || t.teams?.in?.name || t.to || '';
    const date = t.transfer_date || t.date ? formatDate(t.transfer_date || t.date) : '';
    const photo = t.photo || t.player_photo || t.player?.photo || './assets/ofb-logo.jpg';

    return `
      <div class="item">
        <img class="player-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" onerror="this.src='./assets/ofb-logo.jpg'" />
        <div class="item-main">
          <div class="item-title">${escapeHtml(player)}</div>
          <div class="item-meta">${escapeHtml(type)}${from || to ? ` · ${escapeHtml(from)} → ${escapeHtml(to)}` : ''}${date ? ` · ${date}` : ''}</div>
        </div>
      </div>
    `;
  }

  async function searchTeams() {
    const q = els.teamSearchInput.value.trim();
    if (q.length < 3) {
      els.searchHint.textContent = 'Введите минимум 3 символа.';
      els.searchResults.innerHTML = '';
      return;
    }

    els.searchHint.textContent = 'Ищем команду…';
    els.searchResults.innerHTML = '';

    try {
      const data = await ofbApi('/ofb-api-team-search', { q }, { noCache: true, timeoutMs: 15000 });
      const teams = safeArr(data.teams);
      els.searchHint.textContent = teams.length ? 'Выберите нужную команду.' : 'Команды не найдены.';
      els.searchResults.innerHTML = teams.map(teamResultHtml).join('');
    } catch (e) {
      console.error(e);
      els.searchHint.textContent = 'Ошибка поиска. Попробуйте позже.';
    }
  }

  function teamResultHtml(t) {
    const teamId = t.team_id || t.id;
    const teamName = t.team_name || t.name || 'Команда';

    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(teamName)}</div>
          <div class="item-meta">ID ${escapeHtml(teamId)}</div>
        </div>
        <button class="primary-button compact" data-subscribe="${escapeAttr(teamId)}" data-team-name="${escapeAttr(teamName)}" type="button">
          ${state.currentTeam ? 'Заменить' : 'Выбрать'}
        </button>
      </div>
    `;
  }

  async function subscribeTeam(teamId, teamName) {
    try {
      showToast('Сохраняем команду…');
      await ofbApi('/ofb-api-subscribe', {
        team_id: Number(teamId),
        team_name: teamName || ''
      }, { noCache: true, timeoutMs: 15000 });

      closeSearch();
      await loadProfile();
      showToast('Команда выбрана');
    } catch (e) {
      console.error(e);
      showToast('Не удалось выбрать команду');
    }
  }

  async function updateFlags(changedFlag, checked) {
    if (!state.currentTeam?.team_id) return;

    const oldFlags = { ...state.flags };
    state.flags[changedFlag] = checked;

    try {
      await ofbApi('/ofb-api-update-flags', {
        team_id: state.currentTeam.team_id,
        notify_flags: state.flags
      }, { noCache: true, timeoutMs: 15000 });
      showToast('Настройки сохранены');
    } catch (e) {
      console.error(e);
      state.flags = oldFlags;
      applyFlags(oldFlags);
      showToast('Не удалось сохранить настройки');
    }
  }

  function openSearch() {
    setVisible(els.searchSheet, true);
    setTimeout(() => els.teamSearchInput.focus(), 50);
  }

  function closeSearch() {
    setVisible(els.searchSheet, false);
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-page').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));

    if (tab === 'matches') {
      loadFixtures().catch(console.error);
    }

    if (tab === 'squad') {
      loadSquad().catch(console.error);
    }

    if (tab === 'transfers') {
      loadTransfers().catch(console.error);
    }
  }

  function bindEvents() {
    els.refreshBtn.addEventListener('click', () => loadProfile());
    els.openSearchBtn.addEventListener('click', openSearch);
    els.replaceTeamBtn.addEventListener('click', openSearch);
    els.closeSearchBtn.addEventListener('click', closeSearch);
    els.closeSearchBackdrop.addEventListener('click', closeSearch);
    els.teamSearchBtn.addEventListener('click', searchTeams);
    els.teamSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchTeams();
    });

    document.addEventListener('click', (e) => {
      const subBtn = e.target.closest('[data-subscribe]');
      if (subBtn) {
        subscribeTeam(subBtn.dataset.subscribe, subBtn.dataset.teamName);
      }

      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) {
        switchTab(tabBtn.dataset.tab);
      }

      const jump = e.target.closest('[data-tab-jump]');
      if (jump) {
        switchTab(jump.dataset.tabJump);
      }
    });

    document.querySelectorAll('[data-flag]').forEach((input) => {
      input.addEventListener('change', () => updateFlags(input.dataset.flag, input.checked));
    });
  }

  async function init() {
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

    await loadProfile();
  }

  init();
})();
