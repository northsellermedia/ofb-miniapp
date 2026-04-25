import { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronRight, Search, Shield, Sparkles, Star, Trophy, UsersRound } from 'lucide-react';
import { api, getMaxUserId } from './api';
import { CONFIG } from './config';
import logo from './assets/logo-ofb.jpg';
import GlassCard from './components/GlassCard';
import BottomNav from './components/BottomNav';
import LoadingView from './components/LoadingView';
import ToggleRow from './components/ToggleRow';
import MatchCard from './components/MatchCard';

const defaultFlags = {
  news: true,
  goals: true,
  final: true,
  reminder: true,
  match_start: true
};

function normalizeTeamName(team) {
  return team?.team_name || team?.name || `Команда ${team?.team_id || ''}`.trim();
}

function splitFixtures(fixtures = []) {
  const now = Date.now();
  const upcoming = [];
  const past = [];

  fixtures.forEach((fixture) => {
    const time = new Date(fixture.kickoff_utc || fixture.fixture_date || 0).getTime();
    if (time >= now) upcoming.push(fixture);
    else past.push(fixture);
  });

  return {
    upcoming: upcoming.sort((a, b) => new Date(a.kickoff_utc || a.fixture_date) - new Date(b.kickoff_utc || b.fixture_date)),
    past: past.sort((a, b) => new Date(b.kickoff_utc || b.fixture_date) - new Date(a.kickoff_utc || a.fixture_date))
  };
}

export default function App() {
  const [maxUserId] = useState(() => getMaxUserId());
  const [view, setView] = useState('home');
  const [profile, setProfile] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamCard, setTeamCard] = useState(null);
  const [teamData, setTeamData] = useState({ fixtures: null, profile: null, squad: null, transfers: null, stats: null });
  const [teamTab, setTeamTab] = useState('fixtures');
  const [loading, setLoading] = useState({ app: true });
  const [error, setError] = useState('');

  const firstName = profile?.user?.first_name || profile?.profile?.first_name || 'OFB';

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLoading((s) => ({ ...s, search: true }));
        const data = await api.searchTeams(trimmed);
        setSearchResults(data.teams || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading((s) => ({ ...s, search: false }));
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [query]);

  async function loadProfile() {
    try {
      setError('');
      setLoading((s) => ({ ...s, app: true }));
      const data = await api.loadProfile(maxUserId);
      setProfile(data);
      setSubscriptions(data.subscriptions || data.teams || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading((s) => ({ ...s, app: false }));
    }
  }

  async function openTeam(team) {
    const team_id = Number(team.team_id);
    const team_name = normalizeTeamName(team);
    const baseTeam = { ...team, team_id, team_name };

    try {
      setError('');
      setSelectedTeam(baseTeam);
      setTeamTab('fixtures');
      setTeamCard(null);
      setTeamData({ fixtures: null, profile: null, squad: null, transfers: null, stats: null });
      setView('team');
      setLoading((s) => ({ ...s, team: true }));

      const [card, fixtures, profileData] = await Promise.allSettled([
        api.openTeam(maxUserId, team_id),
        api.teamFixtures({ max_user_id: maxUserId, team_id }),
        api.teamProfile({ max_user_id: maxUserId, team_id })
      ]);

      if (card.status === 'fulfilled') setTeamCard(card.value);
      if (fixtures.status === 'fulfilled') setTeamData((s) => ({ ...s, fixtures: fixtures.value.fixtures || [] }));
      if (profileData.status === 'fulfilled') setTeamData((s) => ({ ...s, profile: profileData.value.profile || null }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading((s) => ({ ...s, team: false }));
    }
  }

  async function subscribeTeam() {
    if (!selectedTeam) return;
    try {
      setLoading((s) => ({ ...s, action: true }));
      await api.subscribe({ max_user_id: maxUserId, team_id: selectedTeam.team_id, team_name: selectedTeam.team_name });
      await loadProfile();
      await openTeam(selectedTeam);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading((s) => ({ ...s, action: false }));
    }
  }

  async function unsubscribeTeam() {
    if (!selectedTeam) return;
    try {
      setLoading((s) => ({ ...s, action: true }));
      await api.unsubscribe({ max_user_id: maxUserId, team_id: selectedTeam.team_id });
      await loadProfile();
      await openTeam(selectedTeam);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading((s) => ({ ...s, action: false }));
    }
  }

  async function updateFlag(flag, value) {
    if (!selectedTeam) return;
    const current = teamCard?.notify_flags || selectedTeam?.notify_flags || defaultFlags;
    const nextFlags = { ...current, [flag]: value };
    setTeamCard((s) => ({ ...(s || {}), notify_flags: nextFlags }));

    try {
      await api.updateFlags({ max_user_id: maxUserId, team_id: selectedTeam.team_id, notify_flags: nextFlags });
      await loadProfile();
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadLazyTab(tab) {
    if (!selectedTeam) return;
    setTeamTab(tab);

    const team_id = selectedTeam.team_id;
    if (tab === 'squad' && !teamData.squad) {
      await lazyLoad('squad', () => api.teamSquad({ max_user_id: maxUserId, team_id }).then((d) => d.squad || []));
    }
    if (tab === 'stats' && !teamData.stats) {
      await lazyLoad('stats', () => api.teamSeasonStats({ max_user_id: maxUserId, team_id }).then((d) => d.stats?.[0] || null));
    }
    if (tab === 'transfers' && !teamData.transfers) {
      await lazyLoad('transfers', () => api.teamTransfers({ max_user_id: maxUserId, team_id }).then((d) => d.transfers || []));
    }
  }

  async function lazyLoad(key, loader) {
    try {
      setLoading((s) => ({ ...s, [key]: true }));
      const data = await loader();
      setTeamData((s) => ({ ...s, [key]: data }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading((s) => ({ ...s, [key]: false }));
    }
  }

  const isSubscribed = useMemo(() => {
    const id = selectedTeam?.team_id;
    return Boolean(teamCard?.is_subscribed || subscriptions.some((s) => Number(s.team_id) === Number(id)));
  }, [teamCard, subscriptions, selectedTeam]);

  if (loading.app) return <AppShell view={view} setView={setView}><LoadingView text="Открываем OFB" /></AppShell>;

  return (
    <AppShell view={view} setView={setView} error={error} clearError={() => setError('')}>
      {view === 'home' && (
        <HomeView
          firstName={firstName}
          subscriptions={subscriptions}
          openTeam={openTeam}
          setView={setView}
        />
      )}
      {view === 'search' && (
        <SearchView
          query={query}
          setQuery={setQuery}
          results={searchResults}
          loading={loading.search}
          openTeam={openTeam}
        />
      )}
      {view === 'team' && selectedTeam && (
        <TeamView
          team={selectedTeam}
          card={teamCard}
          data={teamData}
          tab={teamTab}
          setTab={loadLazyTab}
          loading={loading}
          isSubscribed={isSubscribed}
          subscribeTeam={subscribeTeam}
          unsubscribeTeam={unsubscribeTeam}
          updateFlag={updateFlag}
          goBack={() => setView('home')}
        />
      )}
      {view === 'alerts' && (
        <AlertsView subscriptions={subscriptions} openTeam={openTeam} />
      )}
      {view === 'profile' && (
        <ProfileView maxUserId={maxUserId} profile={profile} subscriptions={subscriptions} reload={loadProfile} />
      )}
    </AppShell>
  );
}

function AppShell({ children, view, setView, error, clearError }) {
  return (
    <div className="app">
      <div className="bg-orb orb-one" />
      <div className="bg-orb orb-two" />
      <header className="topbar">
        <img src={logo} alt="OFB" />
        <div>
          <span>OFB</span>
          <strong>Около футбола</strong>
        </div>
      </header>
      {error && (
        <button className="error-toast" onClick={clearError} type="button">
          {error}
        </button>
      )}
      <main className="content">{children}</main>
      <BottomNav active={view} onChange={setView} />
    </div>
  );
}

function HomeView({ firstName, subscriptions, openTeam, setView }) {
  return (
    <div className="screen fade-in">
      <GlassCard className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={15} /> MAX mini app</span>
          <h1>Футбол рядом. Без лишнего шума.</h1>
          <p>Матчи, уведомления и команды в одном стильном приложении OFB.</p>
        </div>
        <img src={logo} alt="OFB logo" />
      </GlassCard>

      <div className="section-head">
        <h2>Мои команды</h2>
        <button onClick={() => setView('search')} type="button">Добавить</button>
      </div>

      {subscriptions.length === 0 ? (
        <GlassCard className="empty-card">
          <Trophy size={28} />
          <h3>Команд пока нет</h3>
          <p>Найди любимый клуб и включи уведомления.</p>
          <button className="primary-btn" onClick={() => setView('search')} type="button">Найти команду</button>
        </GlassCard>
      ) : (
        <div className="team-list">
          {subscriptions.map((team) => (
            <TeamListItem key={`${team.team_id}-${team.team_name}`} team={team} onClick={() => openTeam(team)} />
          ))}
        </div>
      )}

      <GlassCard className="mini-info">
        <Shield size={22} />
        <div>
          <strong>Архитектура без лишних API-запросов</strong>
          <p>Приложение читает Postgres через n8n. API-Football работает только в фоне.</p>
        </div>
      </GlassCard>
    </div>
  );
}

function SearchView({ query, setQuery, results, loading, openTeam }) {
  return (
    <div className="screen fade-in">
      <h1 className="page-title">Поиск команды</h1>
      <div className="search-box">
        <Search size={20} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zenit, CSKA, Real Madrid..." autoFocus />
      </div>
      {loading && <LoadingView text="Ищем команду" />}
      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <GlassCard className="empty-card"><p>Команда не найдена в базе.</p></GlassCard>
      )}
      <div className="team-list">
        {results.map((team) => (
          <TeamListItem key={`${team.team_id}-${normalizeTeamName(team)}`} team={team} onClick={() => openTeam(team)} />
        ))}
      </div>
    </div>
  );
}

function TeamListItem({ team, onClick }) {
  return (
    <button className="team-row" onClick={onClick} type="button">
      <div className="team-badge">{normalizeTeamName(team).slice(0, 2).toUpperCase()}</div>
      <div>
        <strong>{normalizeTeamName(team)}</strong>
        <span>{[team.league_name, team.country].filter(Boolean).join(' · ') || 'Открыть карточку'}</span>
      </div>
      <ChevronRight size={20} />
    </button>
  );
}

function TeamView({ team, card, data, tab, setTab, loading, isSubscribed, subscribeTeam, unsubscribeTeam, updateFlag, goBack }) {
  const fixtures = data.fixtures || card?.fixtures || card?.next_fixtures || [];
  const { upcoming, past } = Array.isArray(fixtures) ? splitFixtures(fixtures) : {
    upcoming: fixtures?.upcoming || [],
    past: fixtures?.past || []
  };
  const flags = card?.notify_flags || team?.notify_flags || defaultFlags;

  return (
    <div className="screen fade-in team-screen">
      <button className="back-btn" onClick={goBack} type="button">← Назад</button>
      <GlassCard className="team-hero">
        <div className="team-badge xl">{team.team_name.slice(0, 2).toUpperCase()}</div>
        <div>
          <span className="eyebrow"><Star size={14} /> Команда</span>
          <h1>{team.team_name}</h1>
          <p>{isSubscribed ? 'Вы подписаны на команду' : 'Можно подписаться и включить уведомления'}</p>
        </div>
      </GlassCard>

      <div className="action-pair">
        {isSubscribed ? (
          <button className="danger-btn" onClick={unsubscribeTeam} disabled={loading.action} type="button">Отписаться</button>
        ) : (
          <button className="primary-btn" onClick={subscribeTeam} disabled={loading.action} type="button">Подписаться</button>
        )}
      </div>

      <div className="tabs">
        {[
          ['fixtures', 'Матчи'],
          ['profile', 'Профиль'],
          ['squad', 'Состав'],
          ['stats', 'Статистика'],
          ['transfers', 'Трансферы']
        ].map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} type="button">{label}</button>
        ))}
      </div>

      {tab === 'fixtures' && <FixturesTab upcoming={upcoming} past={past} />}
      {tab === 'profile' && <ProfileTab profile={data.profile} />}
      {tab === 'squad' && <SquadTab squad={data.squad} loading={loading.squad} />}
      {tab === 'stats' && <StatsTab stats={data.stats} loading={loading.stats} />}
      {tab === 'transfers' && <TransfersTab transfers={data.transfers} loading={loading.transfers} />}

      <GlassCard className="notify-card">
        <h2>Уведомления</h2>
        {Object.entries(CONFIG.NOTIFY_LABELS).map(([key, label]) => (
          <ToggleRow key={key} label={label} checked={Boolean(flags[key])} onChange={(value) => updateFlag(key, value)} />
        ))}
      </GlassCard>
    </div>
  );
}

function FixturesTab({ upcoming, past }) {
  return (
    <div className="tab-panel">
      <h2>Ближайшие матчи</h2>
      {upcoming.length ? upcoming.slice(0, 6).map((f) => <MatchCard key={f.fixture_id || `${f.kickoff_utc}-${f.home_team}`} fixture={f} />) : <GlassCard><p>Ближайшие матчи обновляются.</p></GlassCard>}
      <h2>Прошедшие</h2>
      {past.length ? past.slice(0, 6).map((f) => <MatchCard key={f.fixture_id || `${f.kickoff_utc}-${f.home_team}`} fixture={f} />) : <GlassCard><p>Прошедших матчей в кэше пока нет.</p></GlassCard>}
    </div>
  );
}

function ProfileTab({ profile }) {
  if (!profile) return <GlassCard><p>Профиль команды обновляется.</p></GlassCard>;
  return (
    <div className="tab-panel">
      <GlassCard className="facts-grid">
        <Fact label="Страна" value={profile.country} />
        <Fact label="Город" value={profile.city || profile.venue_city} />
        <Fact label="Основан" value={profile.founded} />
        <Fact label="Стадион" value={profile.venue_name} />
        <Fact label="Вместимость" value={profile.venue_capacity ? Number(profile.venue_capacity).toLocaleString('ru-RU') : null} />
      </GlassCard>
    </div>
  );
}

function SquadTab({ squad, loading }) {
  if (loading) return <LoadingView text="Загружаем состав" />;
  if (!squad?.length) return <GlassCard><p>Состав скоро появится.</p></GlassCard>;

  const groups = squad.reduce((acc, player) => {
    const key = player.position || 'Игроки';
    acc[key] ||= [];
    acc[key].push(player);
    return acc;
  }, {});

  return <div className="tab-panel">{Object.entries(groups).map(([pos, players]) => <GlassCard key={pos}><h3>{pos}</h3>{players.map((p) => <div className="player-row" key={p.player_id}><span>{p.number || '—'}</span><strong>{p.player_name}</strong><small>{p.age ? `${p.age} лет` : ''}</small></div>)}</GlassCard>)}</div>;
}

function StatsTab({ stats, loading }) {
  if (loading) return <LoadingView text="Загружаем статистику" />;
  if (!stats) return <GlassCard><p>Статистика обновляется.</p></GlassCard>;
  const points = (Number(stats.wins || 0) * 3) + Number(stats.draws || 0);
  const gd = Number(stats.goals_for || 0) - Number(stats.goals_against || 0);
  return (
    <GlassCard className="stats-card">
      <h2>{stats.league_name || 'Сезон'}</h2>
      <div className="stats-grid">
        <Fact label="Матчи" value={stats.played} />
        <Fact label="Очки" value={points} />
        <Fact label="Победы" value={stats.wins} />
        <Fact label="Ничьи" value={stats.draws} />
        <Fact label="Поражения" value={stats.losses} />
        <Fact label="Разница" value={gd > 0 ? `+${gd}` : gd} />
        <Fact label="Голы" value={`${stats.goals_for ?? 0}:${stats.goals_against ?? 0}`} />
        <Fact label="Сухие" value={stats.clean_sheets} />
      </div>
    </GlassCard>
  );
}

function TransfersTab({ transfers, loading }) {
  if (loading) return <LoadingView text="Загружаем трансферы" />;
  if (!transfers?.length) return <GlassCard><p>Трансферы пока не загружены.</p></GlassCard>;
  return (
    <div className="tab-panel">
      {transfers.map((t) => (
        <GlassCard key={t.id || `${t.player_id}-${t.transfer_date}`} className="transfer-card">
          <strong>{t.player_name}</strong>
          <span>{[t.from_team, t.to_team].filter(Boolean).join(' → ')}</span>
          <small>{[t.transfer_date, t.transfer_type].filter(Boolean).join(' · ')}</small>
        </GlassCard>
      ))}
    </div>
  );
}

function AlertsView({ subscriptions, openTeam }) {
  return (
    <div className="screen fade-in">
      <h1 className="page-title">Уведомления</h1>
      <GlassCard className="mini-info"><Bell size={24} /><div><strong>Настройки по командам</strong><p>Открой команду и выбери нужные типы уведомлений.</p></div></GlassCard>
      <div className="team-list">{subscriptions.map((team) => <TeamListItem key={team.team_id} team={team} onClick={() => openTeam(team)} />)}</div>
    </div>
  );
}

function ProfileView({ maxUserId, profile, subscriptions, reload }) {
  return (
    <div className="screen fade-in">
      <h1 className="page-title">Профиль</h1>
      <GlassCard className="profile-card">
        <UsersRound size={30} />
        <h2>{profile?.user?.first_name || profile?.profile?.first_name || 'Пользователь MAX'}</h2>
        <p>MAX ID: {maxUserId}</p>
        <p>Подписок: {subscriptions.length}</p>
        <button className="primary-btn" onClick={reload} type="button">Обновить</button>
      </GlassCard>
    </div>
  );
}

function Fact({ label, value }) {
  return <div className="fact"><span>{label}</span><strong>{value ?? '—'}</strong></div>;
}
