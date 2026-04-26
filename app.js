(() => {
  'use strict';

  const CONFIG = window.OFB_CONFIG || {};
  const API_BASE = String(CONFIG.API_BASE || '').replace(/\/$/, '');
  const DEFAULT_LOGO = 'assets/logo-ofb.jpg';

  const state = {
    selectedTeam: null,
    profile: null,
    activeTab: 'overview',
    isBusy: false
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    loader: $('loader'),
    messageBox: $('messageBox'),
    maxStatusDot: $('maxStatusDot'),
    maxStatusText: $('maxStatusText'),
    profileCard: $('profileCard'),
    subscriptionsList: $('subscriptionsList'),
    refreshProfileButton: $('refreshProfileButton'),
    teamSearchInput: $('teamSearchInput'),
    teamSearchButton: $('teamSearchButton'),
    searchResultsCard: $('searchResultsCard'),
    searchResults: $('searchResults'),
    teamPanel: $('teamPanel'),
    teamLogo: $('teamLogo'),
    teamName: $('teamName'),
    teamCountry: $('teamCountry'),
    teamMeta: $('teamMeta'),
    subscribeButton: $('subscribeButton'),
    unsubscribeButton: $('unsubscribeButton'),
    saveFlagsButton: $('saveFlagsButton'),
    shareButton: $('shareButton'),
    flagMatchStart: $('flagMatchStart'),
    flagGoalsFor: $('flagGoalsFor'),
    flagGoalsAgainst: $('flagGoalsAgainst'),
    teamStats: $('teamStats'),
    fixturesList: $('fixturesList'),
    squadList: $('squadList'),
    transfersList: $('transfersList'),
    loadFixturesButton: $('loadFixturesButton'),
    loadSquadButton: $('loadSquadButton'),
    loadTransfersButton: $('loadTransfersButton')
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    bindEvents();
    updateMaxStatus();
    loadProfile();
  }

  function bindEvents() {
    els.teamSearchButton.addEventListener('click', () => searchTeams());
    els.refreshProfileButton.addEventListener('click', () => loadProfile());
    els.subscribeButton.addEventListener('click', () => subscribeSelectedTeam());
    els.unsubscribeButton.addEventListener('click', () => unsubscribeSelectedTeam());
    els.saveFlagsButton.addEventListener('click', () => saveFlags());
    els.loadFixturesButton.addEventListener('click', () => loadFixtures());
    els.loadSquadButton.addEventListener('click', () => loadSquad());
    els.loadTransfersButton.addEventListener('click', () => loadTransfers());
    els.shareButton.addEventListener('click', shareChannel);

    els.teamSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchTeams();
    });

    document.querySelectorAll('.quick-chip').forEach((button) => {
      button.addEventListener('click', () => {
        els.teamSearchInput.value = button.dataset.query || '';
        searchTeams();
      });
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
  }

  function getWebApp() {
    return window.WebApp || null;
  }

  function getMaxInitData() {
    const webApp = getWebApp();
    return typeof webApp?.initData === 'string' ? webApp.initData : '';
  }

  function updateMaxStatus() {
    const initData = getMaxInitData();
    if (initData) {
      els.maxStatusDot.className = 'status-dot ok';
      els.maxStatusText.textContent = 'Запущено в MAX. Данные будут проверены на сервере.';
      return;
    }

    els.maxStatusDot.className = 'status-dot warn';
    els.maxStatusText.textContent = 'Откройте приложение внутри MAX для работы с подписками.';
  }

  async function ofbApi(path, payload = {}) {
    const initData = getMaxInitData();
    if (!initData && CONFIG.REQUIRE_MAX_INIT_DATA !== false) {
      throw new Error('MAX initData не найден. Откройте мини-приложение внутри MAX.');
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, payload })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || data?.message || `Ошибка API ${response.status}`);
    }
    return data || {};
  }

  async function withBusy(task, silent = false) {
    if (state.isBusy) return null;
    state.isBusy = true;
    els.loader.classList.remove('hidden');
    clearMessage();
    try {
      return await task();
    } catch (error) {
      if (!silent) showMessage(error.message || 'Произошла ошибка. Попробуйте позже.', true);
      return null;
    } finally {
      state.isBusy = false;
      els.loader.classList.add('hidden');
    }
  }

  async function loadProfile() {
    const data = await withBusy(() => ofbApi('/ofb-api-profile'), true);
    if (!data) {
      els.subscriptionsList.innerHTML = emptyText('Профиль появится после запуска внутри MAX.');
      return;
    }

    state.profile = data;
    const subscriptions = normalizeArray(data.subscriptions || data.teams || data.items || data.result);
    renderSubscriptions(subscriptions);
  }

  async function searchTeams() {
    const query = els.teamSearchInput.value.trim();
    if (query.length < 2) {
      showMessage('Введите минимум 2 символа для поиска.', true);
      return;
    }

    const data = await withBusy(() => ofbApi('/ofb-api-team-search', { query }));
    if (!data) return;

    const teams = normalizeArray(data.teams || data.items || data.result || data.data);
    renderSearchResults(teams);
  }

  function renderSubscriptions(subscriptions) {
    if (!subscriptions.length) {
      els.subscriptionsList.innerHTML = emptyText('Пока нет подписок. Найдите команду и нажмите «Подписаться».');
      return;
    }

    els.subscriptionsList.innerHTML = subscriptions.map((team) => teamItemHtml(normalizeTeam(team), 'Открыть')).join('');
    els.subscriptionsList.querySelectorAll('[data-team]').forEach((button, index) => {
      button.addEventListener('click', () => openTeam(normalizeTeam(subscriptions[index])));
    });
  }

  function renderSearchResults(teams) {
    els.searchResultsCard.classList.remove('hidden');
    if (!teams.length) {
      els.searchResults.innerHTML = emptyText('Команды не найдены. Попробуйте другое название.');
      return;
    }

    els.searchResults.innerHTML = teams.map((team) => teamItemHtml(normalizeTeam(team), 'Выбрать')).join('');
    els.searchResults.querySelectorAll('[data-team]').forEach((button, index) => {
      button.addEventListener('click', () => openTeam(normalizeTeam(teams[index])));
    });
  }

  async function openTeam(team) {
    if (!team.id) {
      showMessage('У команды нет team_id в ответе API.', true);
      return;
    }

    state.selectedTeam = team;
    renderTeamHeader(team);
    els.teamPanel.classList.remove('hidden');
    switchTab('overview');

    const data = await withBusy(() => ofbApi('/ofb-api-team-card', { team_id: team.id }), true);
    if (data) {
      const detailedTeam = normalizeTeam(data.team || data.item || data.result || data.data || { ...team, ...data });
      state.selectedTeam = { ...team, ...detailedTeam };
      renderTeamHeader(state.selectedTeam);
      renderStats(data.stats || data.season_stats || data.statistics || data.result?.stats || {});
      applyFlags(data.flags || data.subscription || data.result?.flags || {});
    }
  }

  function renderTeamHeader(team) {
    els.teamLogo.src = safeUrl(team.logo) || DEFAULT_LOGO;
    els.teamName.textContent = team.name || 'Команда';
    els.teamCountry.textContent = team.country || team.league || 'Команда';
    els.teamMeta.textContent = [team.league, team.venue, team.season].filter(Boolean).join(' · ') || 'Карточка команды';
  }

  async function subscribeSelectedTeam() {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);
    const data = await withBusy(() => ofbApi('/ofb-api-subscribe', { team_id: team.id }));
    if (data) {
      showMessage('Подписка оформлена.');
      loadProfile();
    }
  }

  async function unsubscribeSelectedTeam() {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);
    const data = await withBusy(() => ofbApi('/ofb-api-unsubscribe', { team_id: team.id }));
    if (data) {
      showMessage('Подписка отключена.');
      loadProfile();
    }
  }

  async function saveFlags() {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);

    const payload = {
      team_id: team.id,
      notify_match_start: els.flagMatchStart.checked,
      notify_goals_for: els.flagGoalsFor.checked,
      notify_goals_against: els.flagGoalsAgainst.checked
    };

    const data = await withBusy(() => ofbApi('/ofb-api-update-flags', payload));
    if (data) showMessage('Настройки уведомлений сохранены.');
  }

  async function loadFixtures() {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);

    const data = await withBusy(() => ofbApi('/ofb-api-team-fixtures', { team_id: team.id }));
    if (!data) return;

    const fixtures = normalizeArray(data.fixtures || data.items || data.result || data.data);
    renderFixtures(fixtures);
  }

  async function loadSquad() {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);

    const data = await withBusy(() => ofbApi('/ofb-api-team-squad', { team_id: team.id }));
    if (!data) return;

    const players = normalizeArray(data.players || data.squad || data.items || data.result || data.data);
    renderSquad(players);
  }

  async function loadTransfers() {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);

    const data = await withBusy(() => ofbApi('/ofb-api-team-transfers', { team_id: team.id }));
    if (!data) return;

    const transfers = normalizeArray(data.transfers || data.items || data.result || data.data);
    renderTransfers(transfers);
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.add('hidden'));
    $(`tab-${tabName}`)?.classList.remove('hidden');

    if (tabName === 'fixtures' && state.selectedTeam && els.fixturesList.textContent.includes('Выберите')) loadFixtures();
  }

  function renderFixtures(fixtures) {
    if (!fixtures.length) {
      els.fixturesList.innerHTML = emptyText('Матчей в кэше пока нет.');
      return;
    }

    els.fixturesList.innerHTML = fixtures.slice(0, 12).map((item) => {
      const f = normalizeFixture(item);
      return `
        <article class="list-item">
          <div>
            <div class="item-title">${escapeHtml(f.home)} — ${escapeHtml(f.away)}</div>
            <div class="item-subtitle">${escapeHtml(f.date)} · ${escapeHtml(f.status)}</div>
          </div>
          <strong>${escapeHtml(f.score)}</strong>
        </article>`;
    }).join('');
  }

  function renderSquad(players) {
    if (!players.length) {
      els.squadList.innerHTML = emptyText('Состав в кэше пока не найден.');
      return;
    }

    els.squadList.innerHTML = players.slice(0, 40).map((item) => {
      const player = normalizePlayer(item);
      return `
        <article class="player-card">
          <div class="player-name">${escapeHtml(player.name)}</div>
          <div class="player-role">${escapeHtml(player.position || 'Игрок')}</div>
        </article>`;
    }).join('');
  }

  function renderTransfers(transfers) {
    if (!transfers.length) {
      els.transfersList.innerHTML = emptyText('Трансферы в кэше пока не найдены.');
      return;
    }

    els.transfersList.innerHTML = transfers.slice(0, 20).map((item) => {
      const t = normalizeTransfer(item);
      return `
        <article class="list-item">
          <div>
            <div class="item-title">${escapeHtml(t.player)}</div>
            <div class="item-subtitle">${escapeHtml(t.direction)} · ${escapeHtml(t.date)}</div>
          </div>
        </article>`;
    }).join('');
  }

  function renderStats(stats) {
    const source = stats || {};
    const rows = [
      ['Матчи', source.matches || source.played || source.games || '—'],
      ['Победы', source.wins || source.win || '—'],
      ['Голы', source.goals_for || source.goals || source.scored || '—'],
      ['Место', source.rank || source.position || '—']
    ];

    els.teamStats.innerHTML = rows.map(([label, value]) => `
      <div class="stat">
        <div class="stat-value">${escapeHtml(value)}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
      </div>`).join('');
  }

  function applyFlags(flags) {
    if (!flags || typeof flags !== 'object') return;
    els.flagMatchStart.checked = boolValue(flags.notify_match_start ?? flags.match_start, true);
    els.flagGoalsFor.checked = boolValue(flags.notify_goals_for ?? flags.goals_for, true);
    els.flagGoalsAgainst.checked = boolValue(flags.notify_goals_against ?? flags.goals_against, true);
  }

  function shareChannel() {
    const text = encodeURIComponent(CONFIG.SHARE_TEXT || 'OFB | Около футбола');
    const url = `https://max.ru/:share?text=${text}`;
    const webApp = getWebApp();
    if (webApp?.openLink) {
      webApp.openLink(url);
      return;
    }
    window.open(CONFIG.CHANNEL_URL || url, '_blank', 'noopener,noreferrer');
  }

  function teamItemHtml(team, actionLabel) {
    return `
      <button class="list-item" type="button" data-team="${escapeHtml(team.id)}">
        <span class="item-main">
          <img class="item-logo" src="${escapeAttr(safeUrl(team.logo) || DEFAULT_LOGO)}" alt="" loading="lazy" />
          <span>
            <span class="item-title">${escapeHtml(team.name || 'Команда')}</span>
            <span class="item-subtitle">${escapeHtml([team.country, team.league].filter(Boolean).join(' · ') || 'Открыть карточку')}</span>
          </span>
        </span>
        <span aria-hidden="true">${escapeHtml(actionLabel)} →</span>
      </button>`;
  }

  function normalizeTeam(raw) {
    const item = raw?.team || raw || {};
    return {
      id: item.team_id ?? item.id ?? item.api_team_id ?? item.fixture_team_id,
      name: item.team_name ?? item.name ?? item.title ?? item.team?.name,
      logo: item.team_logo ?? item.logo ?? item.image ?? item.team?.logo,
      country: item.country ?? item.team_country ?? item.nation,
      league: item.league_name ?? item.league ?? item.competition,
      venue: item.venue_name ?? item.venue,
      season: item.season
    };
  }

  function normalizeFixture(raw) {
    const item = raw || {};
    const home = item.home_team || item.home_name || item.teams?.home?.name || item.home || 'Дома';
    const away = item.away_team || item.away_name || item.teams?.away?.name || item.away || 'Гости';
    const goalsHome = item.home_goals ?? item.goals?.home ?? item.score?.home;
    const goalsAway = item.away_goals ?? item.goals?.away ?? item.score?.away;
    return {
      home,
      away,
      date: formatDate(item.kickoff_at || item.fixture_date || item.date || item.timestamp),
      status: item.status_short || item.status || item.fixture_status || '—',
      score: goalsHome == null || goalsAway == null ? '—' : `${goalsHome}:${goalsAway}`
    };
  }

  function normalizePlayer(raw) {
    const item = raw?.player || raw || {};
    return {
      name: item.name || item.player_name || item.firstname || 'Игрок',
      position: item.position || item.player_position || item.role || raw?.statistics?.[0]?.games?.position
    };
  }

  function normalizeTransfer(raw) {
    const item = raw || {};
    const player = item.player_name || item.player?.name || item.name || 'Игрок';
    const type = item.type || item.transfer_type || item.direction || 'трансфер';
    const from = item.from_team || item.teams?.out?.name;
    const to = item.to_team || item.teams?.in?.name;
    return {
      player,
      direction: [from, to].filter(Boolean).join(' → ') || type,
      date: formatDate(item.date || item.transfer_date)
    };
  }

  function normalizeArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.data)) return value.data;
      if (Array.isArray(value.items)) return value.items;
      if (Array.isArray(value.result)) return value.result;
      return [value];
    }
    return [];
  }

  function formatDate(value) {
    if (!value) return 'Дата не указана';
    const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function boolValue(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  }

  function safeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (/^https:\/\//i.test(url) || url.startsWith('assets/')) return url;
    return '';
  }

  function showMessage(text, isError = false) {
    els.messageBox.textContent = text;
    els.messageBox.classList.toggle('error', isError);
    els.messageBox.classList.remove('hidden');
  }

  function clearMessage() {
    els.messageBox.textContent = '';
    els.messageBox.className = 'message-box hidden';
  }

  function emptyText(text) {
    return `<div class="muted">${escapeHtml(text)}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }
})();
