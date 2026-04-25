window.OFB_CONFIG = {
  API_BASE: 'https://n8n.northsellermedia.com/webhook',
  TEST_MAX_USER_ID: 5712595,
  SEARCH_MIN_LENGTH: 2,
  SEARCH_DEBOUNCE_MS: 420,
  CHANNEL_URL: 'https://max.ru/ofb24news',
  ENDPOINTS: {
    profile: 'ofb-api-profile',
    teamSearch: 'ofb-api-team-search',
    teamCard: 'ofb-api-team-card',
    subscribe: 'ofb-api-subscribe',
    updateFlags: 'ofb-api-update-flags',
    unsubscribe: 'ofb-api-unsubscribe',
    fixtures: 'ofb-api-team-fixtures',
    teamProfile: 'ofb-api-team-profile',
    squad: 'ofb-api-team-squad',
    transfers: 'ofb-api-team-transfers',
    seasonStats: 'ofb-api-team-season-stats'
  },
  NOTIFY_LABELS: {
    news: 'Новости',
    goals: 'Голы',
    final: 'Финальный счёт',
    reminder: 'Напоминание',
    match_start: 'Начало матча'
  }
};
