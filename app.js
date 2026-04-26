(() => {
  'use strict';

  const CONFIG = window.OFB_CONFIG || {};
  const API_BASE = String(CONFIG.API_BASE || '').replace(/\/$/, '');
  const DEFAULT_LOGO = 'assets/logo-ofb.jpg';

  const state = {
    selectedTeam: null,
    profile: null,
    activeTab: 'overview',
    isBusy: false,
    loadedTabs: new Set()
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    loader: $('loader'),
    messageBox: $('messageBox'),
    maxStatusDot: $('maxStatusDot'),
    maxStatusText: $('maxStatusText'),
    homeView: $('homeView'),
    teamView: $('teamView'),
    backToHomeButton: $('backToHomeButton'),
    profileCard: $('profileCard'),
    subscriptionsList: $('subscriptionsList'),
    refreshProfileButton: $('refreshProfileButton'),
    teamSearchInput: $('teamSearchInput'),
    teamSearchButton: $('teamSearchButton'),
    searchResultsCard: $('searchResultsCard'),
    searchResults: $('searchResults'),
    teamBackdropLogo: $('teamBackdropLogo'),
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
    els.loadFixturesButton.addEventListener('click', () => loadFixtures(true));
    els.loadSquadButton.addEventListener('click', () => loadSquad(true));
    els.loadTransfersButton.addEventListener('click', () => loadTransfers(true));
    els.shareButton.addEventListener('click', shareChannel);
    els.backToHomeButton.addEventListener('click', showHome);

    els.teamSearchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') searchTeams();
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
      els.maxStatusText.textContent = 'Открыто в MAX. Данные проверяются на сервере.';
      return;
    }

    els.maxStatusDot.className = 'status-dot warn';
    els.maxStatusText.textContent = 'Для подписок откройте приложение внутри MAX.';
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
    const subscriptions = normalizeArray(data.subscriptions || data.teams || data.items || data.result || data.data);
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

    els.subscriptionsList.innerHTML = subscriptions.map((team) => teamTileHtml(normalizeTeam(team), 'Открыть')).join('');
    els.subscriptionsList.querySelectorAll('[data-team-index]').forEach((button, index) => {
      button.addEventListener('click', () => openTeam(normalizeTeam(subscriptions[index])));
    });
  }

  function renderSearchResults(teams) {
    els.searchResultsCard.classList.remove('hidden');
    if (!teams.length) {
      els.searchResults.innerHTML = emptyText('Команды не найдены. Попробуйте другое название.');
      return;
    }

    els.searchResults.innerHTML = teams.map((team) => teamTileHtml(normalizeTeam(team), 'Выбрать')).join('');
    els.searchResults.querySelectorAll('[data-team-index]').forEach((button, index) => {
      button.addEventListener('click', () => openTeam(normalizeTeam(teams[index])));
    });
  }

  async function openTeam(team) {
    if (!team.id) {
      showMessage('У команды нет team_id в ответе API.', true);
      return;
    }

    state.selectedTeam = team;
    state.loadedTabs = new Set();
    renderTeamHeader(team);
    showTeam();
    switchTab('overview');

    const data = await withBusy(() => ofbApi('/ofb-api-team-card', { team_id: team.id }), true);
    if (data) {
      const detailedTeam = normalizeTeam(data.team || data.item || data.result?.team || data.result || data.data || { ...team, ...data });
      state.selectedTeam = { ...team, ...detailedTeam };
      renderTeamHeader(state.selectedTeam);
      renderStats(data.stats || data.season_stats || data.statistics || data.result?.stats || data.data?.stats || {});
      applyFlags(data.flags || data.subscription || data.result?.flags || data.data?.flags || {});
    } else {
      renderStats({});
    }
  }

  function showHome() {
    els.teamView.classList.remove('active-view');
    els.homeView.classList.add('active-view');
    els.backToHomeButton.classList.add('hidden');
  }

  function showTeam() {
    els.homeView.classList.remove('active-view');
    els.teamView.classList.add('active-view');
    els.backToHomeButton.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderTeamHeader(team) {
    const logo = safeUrl(team.logo) || DEFAULT_LOGO;
    els.teamLogo.src = logo;
    els.teamBackdropLogo.src = logo;
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

  async function loadFixtures(force = false) {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);
    if (!force && state.loadedTabs.has('fixtures')) return;

    const data = await withBusy(() => ofbApi('/ofb-api-team-fixtures', { team_id: team.id }));
    if (!data) return;

    const fixtures = normalizeArray(data.fixtures || data.items || data.result || data.data);
    renderFixtures(fixtures);
    state.loadedTabs.add('fixtures');
  }

  async function loadSquad(force = false) {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);
    if (!force && state.loadedTabs.has('squad')) return;

    const data = await withBusy(() => ofbApi('/ofb-api-team-squad', { team_id: team.id }));
    if (!data) return;

    const players = normalizeArray(data.players || data.squad || data.items || data.result || data.data);
    renderSquad(players);
    state.loadedTabs.add('squad');
  }

  async function loadTransfers(force = false) {
    const team = state.selectedTeam;
    if (!team?.id) return showMessage('Сначала выберите команду.', true);
    if (!force && state.loadedTabs.has('transfers')) return;

    const data = await withBusy(() => ofbApi('/ofb-api-team-transfers', { team_id: team.id }));
    if (!data) return;

    const transfers = normalizeArray(data.transfers || data.items || data.result || data.data);
    renderTransfers(transfers);
    state.loadedTabs.add('transfers');
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active-panel'));
    $(`tab-${tabName}`)?.classList.add('active-panel');

    if (tabName === 'fixtures') loadFixtures(false);
    if (tabName === 'squad') loadSquad(false);
    if (tabName === 'transfers') loadTransfers(false);
  }

  function renderFixtures(fixtures) {
    if (!fixtures.length) {
      els.fixturesList.innerHTML = emptyText('Матчей в кэше пока нет.');
      return;
    }

    els.fixturesList.innerHTML = fixtures.slice(0, 14).map((item) => {
      const f = normalizeFixture(item);
      return `
        <article class="fixture-card">
          <div class="fixture-teams">
            <div class="fixture-team">
              <img class="fixture-logo" src="${escapeAttr(safeUrl(f.homeLogo) || DEFAULT_LOGO)}" alt="" loading="lazy" />
              <span class="fixture-name">${escapeHtml(f.home)}</span>
            </div>
            <div class="fixture-score">${escapeHtml(f.score)}</div>
            <div class="fixture-team">
              <img class="fixture-logo" src="${escapeAttr(safeUrl(f.awayLogo) || DEFAULT_LOGO)}" alt="" loading="lazy" />
              <span class="fixture-name">${escapeHtml(f.away)}</span>
            </div>
          </div>
          <div class="fixture-meta">${escapeHtml(f.date)} · ${escapeHtml(f.status)}</div>
        </article>`;
    }).join('');
  }

  function renderSquad(players) {
    if (!players.length) {
      els.squadList.innerHTML = emptyText('Состав в кэше пока не найден.');
      return;
    }

    els.squadList.innerHTML = players.slice(0, 44).map((item) => {
      const player = normalizePlayer(item);
      return `
        <article class="player-card">
          <div class="player-photo">
            ${player.photo ? `<img src="${escapeAttr(player.photo)}" alt="${escapeAttr(player.name)}" loading="lazy" />` : `<div class="player-placeholder">${escapeHtml(initials(player.name))}</div>`}
          </div>
          <div class="player-body">
            <span class="player-name">${escapeHtml(player.name)}</span>
            <span class="player-role">
              <span>${escapeHtml(player.position || 'Игрок')}</span>
              ${player.number ? `<span class="player-number">${escapeHtml(player.number)}</span>` : ''}
            </span>
          </div>
        </article>`;
    }).join('');
  }

  function renderTransfers(transfers) {
    if (!transfers.length) {
      els.transfersList.innerHTML = emptyText('Трансферы в кэше пока не найдены.');
      return;
    }

    els.transfersList.innerHTML = transfers.slice(0, 22).map((item) => {
      const t = normalizeTransfer(item);
      return `
        <article class="transfer-card">
          <div class="transfer-player">
            <div class="transfer-photo">
              ${t.photo ? `<img src="${escapeAttr(t.photo)}" alt="${escapeAttr(t.player)}" loading="lazy" />` : escapeHtml(initials(t.player))}
            </div>
            <div>
              <div class="transfer-title">${escapeHtml(t.player)}</div>
              <div class="transfer-path">${escapeHtml(t.direction)} · ${escapeHtml(t.date)}</div>
            </div>
          </div>
        </article>`;
    }).join('');
  }

  function renderStats(stats) {
    const source = stats || {};
    const rows = [
      ['Матчи', source.matches ?? source.played ?? source.games ?? '—'],
      ['Победы', source.wins ?? source.win ?? '—'],
      ['Голы', source.goals_for ?? source.goals ?? source.scored ?? '—'],
      ['Место', source.rank ?? source.position ?? '—']
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

  function teamTileHtml(team, actionLabel) {
    return `
      <button class="team-tile" type="button" data-team-index="${escapeAttr(team.id || '')}">
        <span class="team-logo-wrap"><img src="${escapeAttr(safeUrl(team.logo) || DEFAULT_LOGO)}" alt="" loading="lazy" /></span>
        <span>
          <span class="team-tile-title">${escapeHtml(team.name || 'Команда')}</span>
          <span class="team-tile-subtitle">${escapeHtml([team.country, team.league].filter(Boolean).join(' · ') || 'Открыть карточку')}</span>
        </span>
        <span class="team-tile-action">${escapeHtml(actionLabel)} →</span>
      </button>`;
  }

  function normalizeTeam(raw) {
    const item = raw?.team || raw || {};
    return {
      id: item.team_id ?? item.id ?? item.api_team_id ?? item.fixture_team_id,
      name: item.team_name ?? item.name ?? item.title ?? item.team?.name,
      logo: item.team_logo ?? item.logo ?? item.image ?? item.team?.logo ?? item.logo_url,
      country: item.country ?? item.team_country ?? item.nation,
      league: item.league_name ?? item.league ?? item.competition,
      venue: item.venue_name ?? item.venue,
      season: item.season
    };
  }

  function normalizeFixture(raw) {
    const item = raw || {};
    const teams = item.teams || {};
    const home = item.home_team || item.home_name || teams.home?.name || item.home || 'Дома';
    const away = item.away_team || item.away_name || teams.away?.name || item.away || 'Гости';
    const goalsHome = item.home_goals ?? item.goals?.home ?? item.score?.home ?? item.score_home;
    const goalsAway = item.away_goals ?? item.goals?.away ?? item.score?.away ?? item.score_away;
    return {
      home,
      away,
      homeLogo: item.home_logo || item.home_team_logo || teams.home?.logo || item.home?.logo,
      awayLogo: item.away_logo || item.away_team_logo || teams.away?.logo || item.away?.logo,
      date: formatDate(item.kickoff_at || item.fixture_date || item.date || item.timestamp),
      status: item.status_short || item.status || item.fixture_status || '—',
      score: goalsHome == null || goalsAway == null ? '—' : `${goalsHome}:${goalsAway}`
    };
  }

  function normalizePlayer(raw) {
    const item = raw?.player || raw || {};
    const stats = raw?.statistics?.[0] || item.statistics?.[0] || {};
    return {
      name: item.name || item.player_name || [item.firstname, item.lastname].filter(Boolean).join(' ') || 'Игрок',
      position: item.position || item.player_position || item.role || stats.games?.position,
      number: item.number || item.player_number || stats.games?.number,
      photo: safeUrl(item.photo || item.player_photo || item.image || item.avatar)
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
      photo: safeUrl(item.player_photo || item.player?.photo || item.photo),
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

  function initials(name) {
    const parts = String(name || 'OFB').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'O';
    return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function showMessage(text, isError = false) {
    els.messageBox.textContent = text;
    els.messageBox.classList.toggle('error', isError);
    els.messageBox.classList.remove('hidden');
  }

  function clearMessage() {
    els.messageBox.textContent = '';
    els.messageBox.classList.remove('error');
    els.messageBox.classList.add('hidden');
  }

  function emptyText(text) {
    return `<div class="empty-text">${escapeHtml(text)}</div>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
  }
})();
