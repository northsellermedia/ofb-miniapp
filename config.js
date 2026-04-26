// OFB MAX mini app config
// Для GitHub Pages можно оставить так. Backend — n8n webhook API.
window.OFB_CONFIG = {
  API_BASE: 'https://n8n.northsellermedia.com/webhook',
  CHANNEL_URL: 'https://max.ru/ofb24news',
  APP_NAME: 'OFB | Около футбола',
  REQUIRE_MAX_INIT_DATA: true,
  REQUEST_TIMEOUT_MS: 15000,
  SEARCH_MIN_LENGTH: 2,
  SEARCH_DEBOUNCE_MS: 450,
  DEFAULT_TEAM_ID: null
};
