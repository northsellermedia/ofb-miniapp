const OFB_API_BASE = 'https://n8n.northsellermedia.com/webhook';

function getMaxInitData() {
  if (window.WebApp && window.WebApp.initData) {
    return window.WebApp.initData;
  }

  if (window.MAX && window.MAX.WebApp && window.MAX.WebApp.initData) {
    return window.MAX.WebApp.initData;
  }

  return '';
}

async function ofbApi(path, payload = {}) {
  const initData = getMaxInitData();

  if (!initData) {
    throw new Error('MAX initData not found. Open mini app inside MAX.');
  }

  const response = await fetch(`${OFB_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      payload
    })
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `API error ${response.status}`);
  }

  return data;
}

(() => {
  'use strict';
  const CFG = window.OFB_CONFIG;
  const $view = document.getElementById('view');
  const $toast = document.getElementById('toast');

  const state = {
    route: 'home',
    user: null,
    userSource: null,
    subscriptions: [],
    selectedTeam: null,
    teamCard: null,
    teamDetails: {
      profile: null,
      fixtures: null,
      squad: null,
      transfers: null,
      stats: null
    },
    loadedTabs: new Set(),
    activeTab: 'matches',
    searchQuery: '',
    searchResults: [],
    loading: false,
    error: null
  };

  const flagLabels = {
    news: 'Новости',
    goals: 'Голы',
    final: 'Финальный счёт',
    reminder: 'Напоминание',
    match_start: 'Начало матча'
  };

  const positionLabels = {
    Goalkeeper: 'Вратари',
    Defender: 'Защитники',
    Midfielder: 'Полузащитники',
    Attacker: 'Нападающие'
  };

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    wireNavigation();
    document.getElementById('refreshBtn').addEventListener('click', () => loadProfile(true));
    loadProfile();
  }

  function wireNavigation() {
    const brand = document.getElementById('homeBrand');
    if (brand) brand.addEventListener('click', () => setRoute('home'));
  }

  function setRoute(route) {
    state.route = route;
    state.error = null;
    render();
  }

  async function postOFB(endpointKey, payload = {}) {
    const endpoint = CFG.ENDPOINTS[endpointKey] || endpointKey;
    const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const data = await ofbApi(path, payload);

    if (!data || data.ok === false) {
      const msg = data?.message || data?.error || 'Ошибка API';
      throw new Error(msg);
    }

    return data;
  }

  function getMaxContext() {
    // initDataUnsafe is used only for UI cosmetics.
    // Backend authorization uses only signed window.WebApp.initData.
    const unsafe = window.WebApp?.initDataUnsafe || window.MAX?.WebApp?.initDataUnsafe || {};
    const user = unsafe.user || {};

    return {
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      username: user.username || "",
      avatar_url: user.photo_url || user.avatar_url || ""
    };
  }

  async function loadProfile(force = false) {
    try {
      state.loading = true;
      state.error = null;
      if (force) toast('Обновляем данные…');
      render();

      const ctx = getMaxContext();
      const data = await postOFB('profile');

      state.user = data.user || data.profile || null;
      state.userSource = ctx;
      state.subscriptions = Array.isArray(data.subscriptions) ? data.subscriptions : (data.teams || []);
      state.loading = false;

      render();
      if (force) toast('Готово');
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      render();
    }
  }

  async function searchTeams(query) {
    state.searchQuery = query.trim();
    if (state.searchQuery.length < 2) {
      state.searchResults = [];
      renderSearchOnly();
      return;
    }

    try {
      state.loading = true;
      renderSearchOnly();

      const data = await postOFB('teamSearch', { query: state.searchQuery });
      state.searchResults = Array.isArray(data.teams) ? data.teams.map(normalizeTeam) : [];
      state.loading = false;
      renderSearchOnly();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      renderSearchOnly();
    }
  }

  async function openTeam(team) {
    const normalized = normalizeTeam(team);
    state.selectedTeam = normalized;
    state.teamCard = null;
    state.teamDetails = { profile: null, fixtures: null, squad: null, transfers: null, stats: null };
    state.loadedTabs = new Set();
    state.activeTab = 'matches';
    setRoute('team');

    try {
      state.loading = true;
      render();

      const payload = { team_id: normalized.team_id };
      const [card, profile, fixtures] = await Promise.allSettled([
        postOFB('teamCard', payload),
        postOFB('teamProfile', payload),
        postOFB('teamFixtures', payload)
      ]);

      if (card.status === 'fulfilled') {
        state.teamCard = card.value;
      }
      if (profile.status === 'fulfilled') {
        state.teamDetails.profile = profile.value;
      }
      if (fixtures.status === 'fulfilled') {
        state.teamDetails.fixtures = fixtures.value;
      }

      state.loadedTabs.add('matches');
      state.loadedTabs.add('profile');
      state.loading = false;
      render();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      render();
    }
  }

  async function ensureTabLoaded(tab) {
    if (!state.selectedTeam || state.loadedTabs.has(tab)) return;

    const map = {
      squad: ['teamSquad', 'squad'],
      stats: ['teamSeasonStats', 'stats'],
      transfers: ['teamTransfers', 'transfers']
    };

    const cfg = map[tab];
    if (!cfg) return;

    try {
      state.loading = true;
      renderTeamOnly();

      const data = await postOFB(cfg[0], { team_id: state.selectedTeam.team_id });
      state.teamDetails[cfg[1]] = data;
      state.loadedTabs.add(tab);
      state.loading = false;
      renderTeamOnly();
    } catch (err) {
      state.loading = false;
      state.error = err.message;
      renderTeamOnly();
    }
  }

  async function subscribeTeam() {
    if (!state.selectedTeam) return;

    try {
      await postOFB('subscribe', {
        team_id: state.selectedTeam.team_id,
        team_name: state.selectedTeam.team_name,
        league_id: state.selectedTeam.league_id || null,
        league_name: state.selectedTeam.league_name || null
      });
      toast('Команда добавлена');
      await loadProfile();
      await openTeam(state.selectedTeam);
    } catch (err) {
      toast(err.message);
    }
  }

  async function unsubscribeTeam() {
    if (!state.selectedTeam) return;
    if (!confirm(`Отписаться от ${state.selectedTeam.team_name}?`)) return;

    try {
      await postOFB('unsubscribe', { team_id: state.selectedTeam.team_id });
      toast('Подписка удалена');
      await loadProfile();
      setRoute('home');
    } catch (err) {
      toast(err.message);
    }
  }

  async function updateNotifyFlag(flag, value) {
    if (!state.selectedTeam) return;

    const current = getCurrentFlags();
    const next = { ...current, [flag]: value };

    try {
      await postOFB('updateFlags', {
        team_id: state.selectedTeam.team_id,
        notify_flags: next
      });

      if (!state.teamCard) state.teamCard = {};
      state.teamCard.notify_flags = next;
      toast('Настройки сохранены');
      renderTeamOnly();
    } catch (err) {
      toast(err.message);
    }
  }

  function render() {
    if (state.route === 'home') return renderHome();
    if (state.route === 'search') return renderSearch();
    if (state.route === 'team') return renderTeam();
    if (state.route === 'settings') return renderSettings();
  }

  function renderHome() {
    if (state.loading && !state.user) {
      $view.innerHTML = loadingMarkup('Загружаем профиль…');
      return;
    }

    const userName = escapeHtml(state.user?.first_name || state.userSource?.first_name || 'болельщик');
    const count = state.subscriptions.length;

    $view.innerHTML = `
      <section class="hero-card">
        <div class="eyebrow">Твой футбольный центр</div>
        <h1>Привет, ${userName}</h1>
        <p>Матчи, новости и уведомления по любимым командам — без лишних кнопок и шума.</p>
        <button class="primary-btn" type="button" data-action="go-search">Найти команду</button>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>Мои команды</h2>
          <span class="badge">${count}</span>
        </div>
        ${count ? renderSubscriptionsList() : emptyMarkup('Пока нет подписок', 'Найди команду и включи уведомления.')}
      </section>

      ${state.error ? errorMarkup(state.error) : ''}
    `;

    bind('[data-action="go-search"]', 'click', () => setRoute('search'));
    bindTeamCards();
  }

  function renderSubscriptionsList() {
    return `
      <div class="team-list">
        ${state.subscriptions.map(sub => {
          const team = normalizeTeam(sub);
          const flags = sub.notify_flags || {};
          const chips = [
            flags.goals ? 'Голы' : null,
            flags.final ? 'Финал' : null,
            flags.reminder ? 'Напоминание' : null,
            flags.news ? 'Новости' : null
          ].filter(Boolean).slice(0, 3);

          return `
            <button class="team-row" type="button" data-team-id="${team.team_id}">
              <div class="team-avatar">${initials(team.team_name)}</div>
              <div class="team-meta">
                <strong>${escapeHtml(team.team_name)}</strong>
                <span>${escapeHtml(team.league_name || team.country || 'Команда')}</span>
                <div class="mini-chips">${chips.map(c => `<em>${c}</em>`).join('')}</div>
              </div>
              <span class="chevron">›</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderSearch() {
    $view.innerHTML = `
      <section class="search-panel">
        <button class="ghost-back" type="button" data-action="back-home">‹ Главная</button>
        <h1>Поиск команды</h1>
        <p>Начни вводить название. Поиск работает по нашей базе и не тратит API-Football на каждый клик.</p>
        <div class="search-box">
          <span>⌕</span>
          <input id="searchInput" type="search" placeholder="Например: Zenit, CSKA, Real" value="${escapeAttr(state.searchQuery)}" autocomplete="off" />
        </div>
        <div id="searchResults">${renderSearchResults()}</div>
      </section>
    `;

    const input = document.getElementById('searchInput');
    input.focus();
    input.addEventListener('input', debounce(e => searchTeams(e.target.value), 420));
    bindSearchResults();
  }

  function renderSearchOnly() {
    const box = document.getElementById('searchResults');
    if (box) {
      box.innerHTML = renderSearchResults();
      bindSearchResults();
    } else {
      renderSearch();
    }
  }

  function renderSearchResults() {
    if (state.loading) return loadingSmallMarkup('Ищем команду…');
    if (state.error) return errorMarkup(state.error);
    if (state.searchQuery.length < 2) return emptyMarkup('Введите минимум 2 символа', 'Например: Zenit');
    if (!state.searchResults.length) return emptyMarkup('Ничего не найдено', 'Попробуй другое название или латиницу.');

    return `
      <div class="team-list search-results">
        ${state.searchResults.map(team => `
          <button class="team-row" type="button" data-team-id="${team.team_id}">
            <div class="team-avatar">${team.logo_url ? `<img src="${escapeAttr(team.logo_url)}" alt="">` : initials(team.team_name)}</div>
            <div class="team-meta">
              <strong>${escapeHtml(team.team_name)}</strong>
              <span>${escapeHtml([team.country, team.league_name].filter(Boolean).join(' · ') || 'Команда')}</span>
            </div>
            <span class="chevron">›</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderTeam() {
    if (!state.selectedTeam) {
      $view.innerHTML = emptyMarkup('Команда не выбрана', 'Вернись в поиск и открой карточку.');
      return;
    }

    $view.innerHTML = teamMarkup();
    bindTeamScreen();
  }

  function renderTeamOnly() {
    if (state.route === 'team') renderTeam();
  }

  function teamMarkup() {
    const team = getTeamHeader();
    const profile = state.teamDetails.profile?.profile || {};
    const subscribed = isSubscribed();
    const logo = profile.logo_url || team.logo_url;
    const tab = state.activeTab;

    return `
      <section class="team-hero">
        <button class="ghost-back" type="button" data-action="back">‹ Назад</button>
        <div class="team-title">
          <div class="team-logo">${logo ? `<img src="${escapeAttr(logo)}" alt="">` : initials(team.team_name)}</div>
          <div>
            <h1>${escapeHtml(team.team_name)}</h1>
            <p>${escapeHtml(profile.country || team.country || team.league_name || 'Футбольная команда')}</p>
          </div>
        </div>
        <div class="team-actions">
          ${subscribed
            ? `<button class="secondary-btn danger" type="button" data-action="unsubscribe">Отписаться</button>`
            : `<button class="primary-btn" type="button" data-action="subscribe">Подписаться</button>`}
        </div>
      </section>

      <section class="tabs" role="tablist">
        ${tabButton('matches', 'Матчи')}
        ${tabButton('profile', 'Профиль')}
        ${tabButton('squad', 'Состав')}
        ${tabButton('stats', 'Статистика')}
        ${tabButton('transfers', 'Трансферы')}
      </section>

      <section class="tab-body">
        ${state.error ? errorMarkup(state.error) : ''}
        ${state.loading && !state.loadedTabs.has(tab) ? loadingSmallMarkup('Загружаем…') : renderActiveTab()}
      </section>
    `;
  }

  function renderActiveTab() {
    if (state.activeTab === 'matches') return renderMatchesTab();
    if (state.activeTab === 'profile') return renderProfileTab();
    if (state.activeTab === 'squad') return renderSquadTab();
    if (state.activeTab === 'stats') return renderStatsTab();
    if (state.activeTab === 'transfers') return renderTransfersTab();
    return '';
  }

  function renderMatchesTab() {
    const all = getFixtures();
    if (!all.length) return emptyMarkup('Матчи обновляются', 'Как только кэш получит данные, они появятся здесь.');

    const now = Date.now();
    const upcoming = all.filter(f => new Date(f.kickoff_utc).getTime() >= now).sort(sortByKickoff).slice(0, 8);
    const past = all.filter(f => new Date(f.kickoff_utc).getTime() < now).sort((a, b) => sortByKickoff(b, a)).slice(0, 8);

    return `
      ${upcoming.length ? `<h2 class="subhead">Ближайшие</h2>${renderFixtureList(upcoming)}` : ''}
      ${past.length ? `<h2 class="subhead">Последние</h2>${renderFixtureList(past)}` : ''}
      ${!upcoming.length && !past.length ? emptyMarkup('Матчи пока не найдены', 'Кэш обновляется в фоне.') : ''}
    `;
  }

  function renderFixtureList(fixtures) {
    return `<div class="fixture-list">${fixtures.map(f => {
      const fixture = normalizeFixture(f);
      return `
        <article class="fixture-card">
          <div class="fixture-date">${formatDate(fixture.kickoff_utc)}</div>
          <div class="fixture-main">
            <span>${escapeHtml(fixture.home_team)}</span>
            <strong>${renderScore(fixture)}</strong>
            <span>${escapeHtml(fixture.away_team)}</span>
          </div>
          <div class="fixture-meta">${escapeHtml([fixture.league_name, fixture.venue].filter(Boolean).join(' · ') || fixture.status_short)}</div>
        </article>
      `;
    }).join('')}</div>`;
  }

  function renderProfileTab() {
    const data = state.teamDetails.profile;
    const p = data?.profile || {};
    if (!data || data.profile_found === false) return emptyMarkup('Профиль команды обновляется', 'Данные подтянутся из кэша.');

    return `
      ${isSubscribed() ? `<h2 class="subhead">Уведомления</h2>${renderNotificationsBlock()}` : ''}
      <div class="info-grid">
        ${infoCell('Город', p.city || p.venue_city)}
        ${infoCell('Страна', p.country)}
        ${infoCell('Основан', p.founded)}
        ${infoCell('Стадион', p.venue_name)}
        ${infoCell('Вместимость', p.venue_capacity ? Number(p.venue_capacity).toLocaleString('ru-RU') : '')}
        ${infoCell('Адрес', p.venue_address)}
      </div>
    `;
  }

  function renderSquadTab() {
    const data = state.teamDetails.squad;
    const squad = Array.isArray(data?.squad) ? data.squad : [];
    if (!data || data.squad_found === false || !squad.length) return emptyMarkup('Состав скоро появится', 'Открой вкладку позже.');

    const groups = groupBy(squad, p => p.position || 'Other');
    const order = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Other'];

    return order.filter(pos => groups[pos]?.length).map(pos => `
      <h2 class="subhead">${positionLabels[pos] || pos}</h2>
      <div class="player-list">
        ${groups[pos].map(player => `
          <article class="player-row">
            <div class="player-photo">${player.photo_url ? `<img src="${escapeAttr(player.photo_url)}" alt="">` : initials(player.player_name)}</div>
            <div>
              <strong>${escapeHtml(player.player_name)}</strong>
              <span>${[player.number ? `№${player.number}` : '', player.age ? `${player.age} лет` : ''].filter(Boolean).join(' · ')}</span>
            </div>
          </article>
        `).join('')}
      </div>
    `).join('');
  }

  function renderStatsTab() {
    const data = state.teamDetails.stats;
    const stats = Array.isArray(data?.stats) ? data.stats[0] : null;
    if (!data || data.stats_found === false || !stats) return emptyMarkup('Статистика обновляется', 'Данные появятся после фонового обновления.');

    const points = Number(stats.wins || 0) * 3 + Number(stats.draws || 0);
    const gd = Number(stats.goals_for || 0) - Number(stats.goals_against || 0);

    return `
      <div class="stat-hero">
        <div><strong>${points}</strong><span>очков</span></div>
        <div><strong>${stats.played ?? '—'}</strong><span>матчей</span></div>
        <div><strong>${gd > 0 ? '+' : ''}${gd}</strong><span>разница</span></div>
      </div>
      <div class="info-grid">
        ${infoCell('Победы', stats.wins)}
        ${infoCell('Ничьи', stats.draws)}
        ${infoCell('Поражения', stats.losses)}
        ${infoCell('Голы', `${stats.goals_for ?? 0}:${stats.goals_against ?? 0}`)}
        ${infoCell('Сухие матчи', stats.clean_sheets)}
        ${infoCell('Не забили', stats.failed_to_score)}
      </div>
      ${stats.form ? `<div class="form-line">${String(stats.form).slice(-12).split('').map(r => `<span class="form-${r}">${r}</span>`).join('')}</div>` : ''}
    `;
  }

  function renderTransfersTab() {
    const data = state.teamDetails.transfers;
    const transfers = Array.isArray(data?.transfers) ? data.transfers : [];
    if (!data || data.transfers_found === false || !transfers.length) return emptyMarkup('Трансферы пока не загружены', 'Показываем 10 последних, когда они есть в кэше.');

    return `
      <div class="transfer-list">
        ${transfers.map(t => `
          <article class="transfer-card">
            <div class="fixture-date">${formatDate(t.transfer_date)}</div>
            <strong>${escapeHtml(t.player_name || 'Игрок')}</strong>
            <span>${escapeHtml(t.from_team || '—')} → ${escapeHtml(t.to_team || '—')}</span>
            ${t.transfer_type ? `<em>${escapeHtml(t.transfer_type)}</em>` : ''}
          </article>
        `).join('')}
      </div>
    `;
  }

  function renderSettings() {
    const ctx = getMaxContext();
    $view.innerHTML = `
      <section class="hero-card compact">
        <div class="eyebrow">Настройки</div>
        <h1>OFB mini app</h1>
        <p>Авторизация выполняется через подписанный <strong>MAX initData</strong>. ID пользователя не передаётся с frontend.</p>
      </section>

      <section class="section">
        <h2>Уведомления</h2>
        <p class="muted">Настройки уведомлений находятся внутри карточки каждой команды.</p>
      </section>

      <section class="section">
        <h2>Канал</h2>
        <button class="secondary-btn" type="button" data-action="open-channel">Открыть OFB в MAX</button>
      </section>
    `;
    bind('[data-action="open-channel"]', 'click', () => {
      if (window.WebApp?.openMaxLink) window.WebApp.openMaxLink(CFG.CHANNEL_URL);
      else window.open(CFG.CHANNEL_URL, '_blank', 'noopener');
    });
  }

  function bindTeamScreen() {
    bind('[data-action="back"]', 'click', () => setRoute('home'));
    bind('[data-action="subscribe"]', 'click', subscribeTeam);
    bind('[data-action="unsubscribe"]', 'click', unsubscribeTeam);

    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.activeTab = btn.dataset.tab;
        renderTeamOnly();
        await ensureTabLoaded(state.activeTab);
      });
    });

    document.querySelectorAll('[data-flag]').forEach(input => {
      input.addEventListener('change', e => updateNotifyFlag(e.target.dataset.flag, e.target.checked));
    });
  }

  function bindTeamCards() {
    document.querySelectorAll('[data-team-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.teamId);
        const team = state.subscriptions.map(normalizeTeam).find(t => Number(t.team_id) === id);
        if (team) openTeam(team);
      });
    });
  }

  function bindSearchResults() {
    document.querySelectorAll('.search-results [data-team-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.teamId);
        const team = state.searchResults.find(t => Number(t.team_id) === id);
        if (team) openTeam(team);
      });
    });
  }

  function getTeamHeader() {
    const cardTeam = state.teamCard?.team || {};
    const profile = state.teamDetails.profile?.profile || {};
    return normalizeTeam({ ...state.selectedTeam, ...cardTeam, ...profile });
  }

  function getCurrentFlags() {
    return state.teamCard?.notify_flags || state.selectedTeam?.notify_flags || {
      news: true,
      goals: true,
      final: true,
      reminder: true,
      match_start: true
    };
  }

  function isSubscribed() {
    if (typeof state.teamCard?.is_subscribed === 'boolean') return state.teamCard.is_subscribed;
    return state.subscriptions.some(s => Number(s.team_id) === Number(state.selectedTeam?.team_id));
  }

  function getFixtures() {
    const f4 = state.teamDetails.fixtures?.fixtures || [];
    const cardFixtures = state.teamCard?.fixtures;
    const next = state.teamCard?.next_fixtures || [];
    if (Array.isArray(f4) && f4.length) return f4.map(normalizeFixture);
    if (Array.isArray(cardFixtures)) return cardFixtures.map(normalizeFixture);
    if (cardFixtures && (cardFixtures.upcoming || cardFixtures.past)) {
      return [...(cardFixtures.upcoming || []), ...(cardFixtures.past || [])].map(normalizeFixture);
    }
    return next.map(normalizeFixture);
  }

  function tabButton(tab, label) {
    return `<button class="${state.activeTab === tab ? 'active' : ''}" type="button" data-tab="${tab}">${label}</button>`;
  }

  function renderNotificationsBlock() {
    const flags = getCurrentFlags();
    return `
      <div class="toggle-list">
        ${Object.entries(flagLabels).map(([flag, label]) => `
          <label class="toggle-row">
            <span>${label}</span>
            <input type="checkbox" data-flag="${flag}" ${flags[flag] !== false ? 'checked' : ''}>
          </label>
        `).join('')}
      </div>
    `;
  }

  function loadingMarkup(text) {
    return `<section class="hero-card"><h1>${escapeHtml(text)}</h1><div class="skeleton-line w90"></div><div class="skeleton-line w60"></div></section>`;
  }

  function loadingSmallMarkup(text) {
    return `<div class="loading-small"><span class="spinner"></span>${escapeHtml(text)}</div>`;
  }

  function emptyMarkup(title, text) {
    return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div>`;
  }

  function errorMarkup(text) {
    return `<div class="error-box"><strong>Ошибка</strong><span>${escapeHtml(text)}</span></div>`;
  }

  function infoCell(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return `<div class="info-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
  }

  function normalizeTeam(team = {}) {
    return {
      team_id: Number(team.team_id || team.id || team.team?.id || 0),
      team_name: team.team_name || team.name || team.team?.name || 'Команда',
      country: team.country || team.team?.country || '',
      league_id: team.league_id || '',
      league_name: team.league_name || '',
      logo_url: team.logo_url || team.logo || team.team?.logo || ''
    };
  }

  function normalizeFixture(f = {}) {
    return {
      fixture_id: f.fixture_id || f.id || '',
      home_team_id: f.home_team_id,
      away_team_id: f.away_team_id,
      home_team: f.home_team || f.home_team_name || 'Хозяева',
      away_team: f.away_team || f.away_team_name || 'Гости',
      league_name: f.league_name || '',
      kickoff_utc: f.kickoff_utc || f.fixture_date || f.date || '',
      status_short: f.status_short || '',
      score_home: f.score_home ?? f.home_goals ?? f.goals_home ?? null,
      score_away: f.score_away ?? f.away_goals ?? f.goals_away ?? null,
      venue: f.venue || f.city || ''
    };
  }

  function renderScore(f) {
    const hasScore = f.score_home !== null && f.score_home !== undefined && f.score_away !== null && f.score_away !== undefined;
    if (hasScore) return `${f.score_home}:${f.score_away}`;
    return formatTime(f.kickoff_utc);
  }

  function sortByKickoff(a, b) {
    return new Date(a.kickoff_utc).getTime() - new Date(b.kickoff_utc).getTime();
  }

  function formatDate(value) {
    if (!value) return 'Дата уточняется';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function initials(name = '') {
    const letters = String(name).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return escapeHtml(letters || 'O');
  }

  function groupBy(items, fn) {
    return items.reduce((acc, item) => {
      const key = fn(item);
      (acc[key] ||= []).push(item);
      return acc;
    }, {});
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function bind(selector, event, fn) {
    const el = document.querySelector(selector);
    if (el) el.addEventListener(event, fn);
  }

  function toast(message) {
    $toast.textContent = message;
    $toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => $toast.classList.remove('show'), 2200);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }
})();
