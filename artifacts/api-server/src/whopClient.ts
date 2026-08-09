import Whop from '@whop/sdk';

let clientPromise: Promise<Whop> | null = null;

async function initWhopClient(): Promise<Whop> {
  const apiKey = process.env.WHOP_API_KEY;

  if (!apiKey) {
    throw new Error(
      'WHOP_API_KEY is not configured. Billing features stay unavailable until a Whop API key is provided.',
    );
  }

  return new Whop({ apiKey });
}

export function getWhopClient(): Promise<Whop> {
  if (!clientPromise) {
    clientPromise = initWhopClient().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }

  return clientPromise;
}
