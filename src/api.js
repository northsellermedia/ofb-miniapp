import { CONFIG } from './config';

export function getMaxUserId() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('max_user_id') || params.get('user_id');
  if (fromUrl && /^\d+$/.test(fromUrl)) return Number(fromUrl);

  // Safe fallbacks for future MAX bridge integration.
  const candidates = [
    window?.MAX?.initDataUnsafe?.user?.id,
    window?.Max?.initDataUnsafe?.user?.id,
    window?.max?.initDataUnsafe?.user?.id,
    window?.Telegram?.WebApp?.initDataUnsafe?.user?.id
  ];

  const found = candidates.find((v) => v && /^\d+$/.test(String(v)));
  return found ? Number(found) : CONFIG.TEST_MAX_USER_ID;
}

export async function postOFB(endpointKey, payload = {}) {
  const endpoint = CONFIG.ENDPOINTS[endpointKey] || endpointKey;
  const url = `${CONFIG.API_BASE}/${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.ok === false) {
    const message = data?.message || data?.error || `OFB API error ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export const api = {
  loadProfile: (max_user_id) => postOFB('PROFILE', { max_user_id }),
  searchTeams: (q) => postOFB('TEAM_SEARCH', { q }),
  openTeam: (max_user_id, team_id) => postOFB('TEAM_CARD', { max_user_id, team_id }),
  subscribe: ({ max_user_id, team_id, team_name }) => postOFB('SUBSCRIBE', { max_user_id, team_id, team_name }),
  updateFlags: ({ max_user_id, team_id, notify_flags }) => postOFB('UPDATE_FLAGS', { max_user_id, team_id, notify_flags }),
  unsubscribe: ({ max_user_id, team_id }) => postOFB('UNSUBSCRIBE', { max_user_id, team_id }),
  teamFixtures: ({ max_user_id, team_id }) => postOFB('TEAM_FIXTURES', { max_user_id, team_id }),
  teamProfile: ({ max_user_id, team_id }) => postOFB('TEAM_PROFILE', { max_user_id, team_id }),
  teamSquad: ({ max_user_id, team_id }) => postOFB('TEAM_SQUAD', { max_user_id, team_id }),
  teamTransfers: ({ max_user_id, team_id }) => postOFB('TEAM_TRANSFERS', { max_user_id, team_id }),
  teamSeasonStats: ({ max_user_id, team_id }) => postOFB('TEAM_SEASON_STATS', { max_user_id, team_id })
};
