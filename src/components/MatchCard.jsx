function formatDate(value) {
  if (!value) return 'Дата уточняется';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function MatchCard({ fixture }) {
  const home = fixture.home_team || fixture.home_team_name || 'Хозяева';
  const away = fixture.away_team || fixture.away_team_name || 'Гости';
  const homeScore = fixture.score_home ?? fixture.home_goals ?? null;
  const awayScore = fixture.score_away ?? fixture.away_goals ?? null;
  const hasScore = homeScore !== null && awayScore !== null;

  return (
    <article className="match-card">
      <div className="match-meta">
        <span>{formatDate(fixture.kickoff_utc || fixture.fixture_date)}</span>
        <span>{fixture.status_short || 'NS'}</span>
      </div>
      <div className="match-teams">
        <strong>{home}</strong>
        <b>{hasScore ? `${homeScore} : ${awayScore}` : 'vs'}</b>
        <strong>{away}</strong>
      </div>
      {(fixture.league_name || fixture.venue || fixture.city) && (
        <div className="match-subline">
          {[fixture.league_name, fixture.venue, fixture.city].filter(Boolean).join(' · ')}
        </div>
      )}
    </article>
  );
}
