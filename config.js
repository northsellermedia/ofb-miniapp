// OFB Mini App config
// Frontend reads only n8n webhook API. API-Football must never be called from GitHub Pages.

window.OFB_CONFIG = {
  API_BASE: 'https://n8n.northsellermedia.com/webhook',

  // Test fallback for browser/GitHub Pages checks outside MAX.
  // In real MAX mini app user id is taken from window.WebApp.initDataUnsafe.user.id.
  TEST_MAX_USER_ID: 5712595,

  ENDPOINTS: {
    profile: '/ofb-api-profile',
    teamSearch: '/ofb-api-team-search',
    teamCard: '/ofb-api-team-card',
    subscribe: '/ofb-api-subscribe',
    updateFlags: '/ofb-api-update-flags',
    unsubscribe: '/ofb-api-unsubscribe',

    fixtures: '/ofb-api-team-fixtures',
    teamProfile: '/ofb-api-team-profile',
    squad: '/ofb-api-team-squad',
    transfers: '/ofb-api-team-transfers',
    seasonStats: '/ofb-api-team-season-stats'
  }
};
