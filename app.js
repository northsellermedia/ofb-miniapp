(() => {
  const API_BASE = (window.OFB_CONFIG && window.OFB_CONFIG.API_BASE) || '/webhook';

  const state = {
    initData: '',
    profile: null,
    currentTeam: null,
    flags: {},
    lazyLoaded: {
      matches: false,
      squad: false,
      transfers: false,
      stats: false,
      profile: false
    }
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
    statsEmpty: $('statsEmpty')
  };

  function getMaxInitData() {
    const webApp = window.WebApp || window.MAX?.WebApp || null;
    return String(webApp?.initData || '');
  }

  function setupMaxShell() {
    try {
      const webApp = window.WebApp || window.MAX?.WebApp || null;
      webApp?.ready?.();
      webApp?.expand?.();
      webApp?.setHeaderColor?.('#071f35');
      webApp?.setBackgroundColor?.('#061a2d');
    } catch (e) {
      console.warn('MAX shell setup skipped', e);
    }
  }

  function setVisible(el, visible) {
    el.classList.toggle('hidden', !visible);
  }

  function showToast(text) {
    els.toast.textContent = text;
    setVisible(els.toast, true);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setVisible(els.toast, false), 2600);
  }

  function endpoint(path) {
    const cleanBase = API_BASE.replace(/\/$/, '');
    const cleanPath = String(path).replace(/^\//, '');
    return `${cleanBase}/${cleanPath}`;
  }

  async function ofbApi(path, payload = {}) {
    if (!state.initData) {
      throw new Error('MAX initData not found');
    }

    const res = await fetch(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: state.initData, payload })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || data.ok === false) {
      const err = data?.error || data?.message || `API error ${res.status}`;
      throw new Error(err);
    }

    return data;
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

  function safeArr(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalizeCurrentTeam(profile) {
    const sub = safeArr(profile?.subscriptions)[0] || null;
    if (!sub) return null;
    return {
      team_id: Number(sub.team_id),
      team_name: sub.team_name || `Команда ${sub.team_id}`,
      league_id: sub.league_id || null,
      league_name: sub.league_name || '',
      notify_flags: sub.notify_flags || {}
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

  async function loadProfile() {
    setVisible(els.loadingState, true);
    try {
      const profile = await ofbApi('/ofb-api-profile');
      state.profile = profile;
      state.currentTeam = normalizeCurrentTeam(profile);
      state.lazyLoaded = { matches: false, squad: false, transfers: false, stats: false, profile: false };
      renderShell();

      if (state.currentTeam) {
        await Promise.allSettled([
          loadTeamProfile(),
          loadFixtures(true),
          loadStats()
        ]);
      }
    } catch (e) {
      console.error(e);
      setVisible(els.loadingState, false);
      setVisible(els.authNotice, true);
      showToast('Не удалось загрузить профиль');
    }
  }

  async function loadTeamProfile() {
    if (!state.currentTeam?.team_id) return;
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
    } catch (e) {
      console.warn('team profile not loaded', e);
    }
  }

  async function loadFixtures(shortOnly = false) {
    if (!state.currentTeam?.team_id) return;
    const data = await ofbApi('/ofb-api-team-fixtures', { team_id: state.currentTeam.team_id });
    const fixtures = safeArr(data.fixtures || data.next_fixtures || data.matches);
    renderFixtures(fixtures, shortOnly);
    state.lazyLoaded.matches = true;
  }

  function renderFixtures(fixtures, shortOnly = false) {
    const sorted = fixtures.slice().sort((a, b) => new Date(a.kickoff_utc || a.date || 0) - new Date(b.kickoff_utc || b.date || 0));
    const next = sorted.filter((f) => !['FT', 'AET', 'PEN'].includes(String(f.status_short || ''))).slice(0, 4);

    els.nextMatches.innerHTML = next.length
      ? next.map(matchItemHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Матчи пока не найдены</div><div class="item-meta">Кэш обновится автоматически.</div></div></div>`;

    if (!shortOnly) {
      els.matchesCount.textContent = String(sorted.length);
      els.matchesList.innerHTML = sorted.length
        ? sorted.map(matchItemHtml).join('')
        : `<div class="item"><div class="item-main"><div class="item-title">Нет матчей</div><div class="item-meta">Проверьте позже.</div></div></div>`;
    }
  }

  function matchItemHtml(f) {
    const home = escapeHtml(f.home_team || f.home || 'Хозяева');
    const away = escapeHtml(f.away_team || f.away || 'Гости');
    const status = escapeHtml(f.status_short || f.status || 'NS');
    const league = escapeHtml(f.league_name || f.league || '');
    const date = formatDate(f.kickoff_utc || f.date);
    const hs = f.score_home ?? f.home_score ?? f.goals_home ?? null;
    const as = f.score_away ?? f.away_score ?? f.goals_away ?? null;
    const score = (hs !== null && as !== null) ? `${hs}:${as}` : status;

    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${home} — ${away}</div>
          <div class="item-meta">${date}${league ? ' · ' + league : ''}</div>
        </div>
        <div class="score">${escapeHtml(score)}</div>
      </div>
    `;
  }

  async function loadStats() {
    if (!state.currentTeam?.team_id) return;
    try {
      const payload = { team_id: state.currentTeam.team_id };
      if (state.currentTeam.league_id) payload.league_id = state.currentTeam.league_id;
      const data = await ofbApi('/ofb-api-team-season-stats', payload);
      const stat = safeArr(data.stats)[0] || null;
      renderStats(stat);
      state.lazyLoaded.stats = true;
    } catch (e) {
      console.warn('stats not loaded', e);
      renderStats(null);
    }
  }

  function renderStats(stat) {
    els.statsEmpty.classList.toggle('hidden', !!stat);
    els.statsSeason.textContent = stat?.season || '—';
    els.statPlayed.textContent = stat?.played ?? '—';
    els.statWins.textContent = stat?.wins ?? '—';
    els.statDraws.textContent = stat?.draws ?? '—';
    els.statLosses.textContent = stat?.losses ?? '—';
    els.statGF.textContent = stat?.goals_for ?? '—';
    els.statGA.textContent = stat?.goals_against ?? '—';
  }

  async function loadSquad() {
    if (!state.currentTeam?.team_id) return;
    els.squadGrid.innerHTML = `<div class="item"><div class="loader"></div><div class="item-main"><div class="item-title">Загружаем состав</div></div></div>`;
    const data = await ofbApi('/ofb-api-team-squad', { team_id: state.currentTeam.team_id });
    const squad = safeArr(data.squad || data.players);
    els.squadCount.textContent = String(data.count ?? squad.length);
    els.squadGrid.innerHTML = squad.length
      ? squad.map(playerCardHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Состав пока не найден</div><div class="item-meta">Кэш обновляется по расписанию.</div></div></div>`;
    state.lazyLoaded.squad = true;
  }

  function playerCardHtml(p) {
    const name = p.name || p.player_name || p.player?.name || 'Игрок';
    const role = p.position || p.role || p.player?.position || '';
    const photo = p.photo || p.photo_url || p.player?.photo || './assets/ofb-logo.jpg';

    return `
      <div class="player-card">
        <img class="player-photo" src="${escapeAttr(photo)}" alt="" loading="lazy" onerror="this.src='./assets/ofb-logo.jpg'" />
        <div>
          <div class="player-name">${escapeHtml(name)}</div>
          <div class="player-role">${escapeHtml(role || 'Футболист')}</div>
        </div>
      </div>
    `;
  }

  async function loadTransfers() {
    if (!state.currentTeam?.team_id) return;
    els.transfersList.innerHTML = `<div class="item"><div class="loader"></div><div class="item-main"><div class="item-title">Загружаем трансферы</div></div></div>`;
    const data = await ofbApi('/ofb-api-team-transfers', { team_id: state.currentTeam.team_id });
    const transfers = safeArr(data.transfers || data.items);
    els.transfersCount.textContent = String(data.count ?? transfers.length);
    els.transfersList.innerHTML = transfers.length
      ? transfers.map(transferItemHtml).join('')
      : `<div class="item"><div class="item-main"><div class="item-title">Трансферы пока не найдены</div><div class="item-meta">Данные появятся после обновления кэша.</div></div></div>`;
    state.lazyLoaded.transfers = true;
  }

  function transferItemHtml(t) {
    const player = t.player_name || t.player?.name || t.name || 'Игрок';
    const type = t.type || t.transfer_type || t.direction || 'Трансфер';
    const from = t.from_team || t.teams?.out?.name || t.from || '';
    const to = t.to_team || t.teams?.in?.name || t.to || '';
    const date = t.date ? formatDate(t.date) : '';
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
      const data = await ofbApi('/ofb-api-team-search', { q });
      const teams = safeArr(data.teams);
      els.searchHint.textContent = teams.length ? 'Выберите нужную команду.' : 'Команды не найдены.';
      els.searchResults.innerHTML = teams.map(teamResultHtml).join('');
    } catch (e) {
      console.error(e);
      els.searchHint.textContent = 'Ошибка поиска. Попробуйте позже.';
    }
  }

  function teamResultHtml(t) {
    return `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(t.team_name || t.name || 'Команда')}</div>
          <div class="item-meta">ID ${escapeHtml(t.team_id)}</div>
        </div>
        <button class="primary-button compact" data-subscribe="${escapeAttr(t.team_id)}" data-team-name="${escapeAttr(t.team_name || t.name || '')}" type="button">
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
      });
      closeSearch();
      await loadProfile();
      showToast('Команда выбрана');
    } catch (e) {
      console.error(e);
      showToast('Не удалось выбрать команду');
    }
  }

  async function updateFlags(changedFlag, checked) {
    const oldFlags = { ...state.flags };
    state.flags[changedFlag] = checked;

    try {
      await ofbApi('/ofb-api-update-flags', {
        team_id: state.currentTeam.team_id,
        notify_flags: state.flags
      });
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

    if (tab === 'matches' && !state.lazyLoaded.matches) {
      loadFixtures(false).catch((e) => { console.error(e); showToast('Не удалось загрузить матчи'); });
    }
    if (tab === 'squad' && !state.lazyLoaded.squad) {
      loadSquad().catch((e) => { console.error(e); showToast('Не удалось загрузить состав'); });
    }
    if (tab === 'transfers' && !state.lazyLoaded.transfers) {
      loadTransfers().catch((e) => { console.error(e); showToast('Не удалось загрузить трансферы'); });
    }
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

    state.initData = getMaxInitData();

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
