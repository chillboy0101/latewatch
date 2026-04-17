import 'server-only';

import { Rest } from 'ably';

let restClient: Rest | null = null;

export function getAblyRestClient() {
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;

  if (!restClient) {
    restClient = new Rest({ key });
  }

  return restClient;
}
