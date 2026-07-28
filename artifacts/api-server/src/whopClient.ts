import Whop from '@whop/sdk';

let client: Whop | null = null;

function initWhopClient(): Whop {
  const apiKey = process.env.WHOP_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'WHOP_API_KEY is not configured. Add a Whop API key to the hosting environment.',
    );
  }

  return new Whop({ apiKey });
}

export async function getWhopClient(): Promise<Whop> {
  if (!client) {
    client = initWhopClient();
  }

  return client;
}
