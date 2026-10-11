import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOVELACE_PER_ADA = 1_000_000;
const EPOCH_SECONDS = 5 * 24 * 60 * 60;
const DAY_SECONDS = 24 * 60 * 60;

type BlockfrostAccount = {
  stake_address: string;
  active: boolean;
  controlled_amount: string;
  rewards_sum: string;
  withdrawable_amount: string;
  pool_id: string | null;
};

type BlockfrostPoolMetadata = {
  ticker?: string;
  name?: string;
};

type BlockfrostReward = {
  epoch: number;
  amount: string;
  pool_id: string;
  earned_epoch?: number;
  spendable_epoch?: number;
  type?: string;
};

type BlockfrostEpoch = {
  epoch: number;
  start_time: number;
  end_time: number;
};

type BlockfrostAddress = {
  stake_address: string | null;
};

type PricePoint = [number, number];

class ApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function blockfrostBaseUrl() {
  const configured =
    process.env.BLOCKFROST_API_URL ??
    "https://cardano-mainnet.blockfrost.io/api/v0";
  const base = configured.replace(/\/+$/, "");
  return base.endsWith("/api/v0") ? base : `${base}/api/v0`;
}

function blockfrostNetwork() {
  const base = blockfrostBaseUrl().toLowerCase();
  if (base.includes("preprod")) return "Preprod";
  if (base.includes("preview")) return "Preview";
  return "Mainnet";
}

async function blockfrost<T>(path: string): Promise<T> {
  const projectId = process.env.BLOCKFROST_PROJECT_ID;
  if (!projectId) {
    throw new ApiError(
      "Der Blockfrost-Projektschlüssel fehlt. Bitte BLOCKFROST_PROJECT_ID in .env.local eintragen.",
      503,
    );
  }

  const response = await fetch(`${blockfrostBaseUrl()}${path}`, {
    headers: { project_id: projectId, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new ApiError("Die Adresse oder das Stake-Konto wurde bei Blockfrost nicht gefunden.", 404);
    }
    if (response.status === 403) {
      throw new ApiError("Blockfrost hat den API-Schlüssel abgelehnt. Prüfe Netzwerk und Projekt-ID.", 502);
    }
    if (response.status === 429) {
      throw new ApiError("Das Blockfrost-Anfragelimit ist erreicht. Bitte versuche es gleich erneut.", 429);
    }
    throw new ApiError(`Blockfrost ist gerade nicht verfügbar (HTTP ${response.status}).`, 502);
  }

  return (await response.json()) as T;
}

async function getAllRewards(stakeAddress: string) {
  const all: BlockfrostReward[] = [];
  const maxPages = 100;

  for (let page = 1; page <= maxPages; page += 1) {
    const search = new URLSearchParams({ count: "100", page: String(page), order: "asc" });
    const batch = await blockfrost<BlockfrostReward[]>(
      `/accounts/${encodeURIComponent(stakeAddress)}/rewards?${search.toString()}`,
    );
    all.push(...batch);
    if (batch.length < 100) return all;
  }

  throw new ApiError(
    "Die Reward-Historie überschreitet die Sicherheitsgrenze von 10.000 Einträgen. Bitte exportiere einen kürzeren Zeitraum.",
    413,
  );
}

function coingeckoConfig() {
  const proKey = process.env.COINGECKO_PRO_API_KEY;
  if (proKey) {
    return {
      base: "https://pro-api.coingecko.com/api/v3",
      headers: { "x-cg-pro-api-key": proKey },
    };
  }

  return {
    base: (process.env.COINGECKO_API_URL ?? "https://api.coingecko.com/api/v3").replace(/\/+$/, ""),
    headers: process.env.COINGECKO_API_KEY
      ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY }
      : {},
  };
}

async function coingeckoJson<T>(path: string, params: URLSearchParams): Promise<T> {
  const config = coingeckoConfig();
  const response = await fetch(`${config.base}${path}?${params.toString()}`, {
    headers: { accept: "application/json", ...config.headers },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function getCurrentPrice() {
  try {
    const params = new URLSearchParams({ ids: "cardano", vs_currencies: "eur" });
    const result = await coingeckoJson<{ cardano?: { eur?: number } }>("/simple/price", params);
    return typeof result.cardano?.eur === "number" ? result.cardano.eur : null;
  } catch {
    return null;
  }
}

type HistoricalPricesResult = {
  prices: PricePoint[];
  source: "range" | "last365" | null;
  error: string | null;
  keyConfigured: boolean;
};

function coingeckoErrorLabel(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/CoinGecko HTTP (\d{3})/);
  return status ? `HTTP ${status[1]}` : "Verbindungsfehler";
}

async function getHistoricalPrices(fromSeconds: number): Promise<HistoricalPricesResult> {
  const keyConfigured = Boolean(process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY);
  if (!Number.isFinite(fromSeconds)) return { prices: [], source: null, error: "Ungültiger Zeitraum", keyConfigured };
  const now = Math.floor(Date.now() / 1000);
  const hasProPlan = Boolean(process.env.COINGECKO_PRO_API_KEY);
  const earliestAllowed = hasProPlan ? 0 : now - 365 * DAY_SECONDS;
  const start = Math.max(0, fromSeconds - DAY_SECONDS, earliestAllowed);
  const rangeParams = new URLSearchParams({
    vs_currency: "eur",
    from: String(start),
    to: String(now),
  });
  let rangeError = "Keine Datenpunkte geliefert";
  try {
    const result = await coingeckoJson<{ prices?: PricePoint[] }>(
      "/coins/cardano/market_chart/range",
      rangeParams,
    );
    if (Array.isArray(result.prices) && result.prices.length > 0) {
      return { prices: result.prices, source: "range", error: null, keyConfigured };
    }
  } catch (error) {
    rangeError = coingeckoErrorLabel(error);
  }

  // Use the same compact 365-day chart endpoint that previously supplied the
  // visible historical prices; it avoids a burst of range requests.
  try {
    const recent = new URLSearchParams({ vs_currency: "eur", days: "365" });
    const result = await coingeckoJson<{ prices?: PricePoint[] }>(
      "/coins/cardano/market_chart",
      recent,
    );
    if (Array.isArray(result.prices) && result.prices.length > 0) {
      return { prices: result.prices, source: "last365", error: null, keyConfigured };
    }
    return { prices: [], source: null, error: `range: ${rangeError}; last365: keine Datenpunkte`, keyConfigured };
  } catch (error) {
    return { prices: [], source: null, error: `range: ${rangeError}; last365: ${coingeckoErrorLabel(error)}`, keyConfigured };
  }
}

function nearestSameDayPrice(timestampSeconds: number, prices: PricePoint[]) {
  const target = timestampSeconds * 1000;
  const dayStart = Math.floor(target / 86_400_000) * 86_400_000;
  let low = 0;
  let high = prices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (prices[middle][0] < dayStart) low = middle + 1;
    else high = middle;
  }
  const candidates: PricePoint[] = [];
  for (let index = low; index < prices.length && prices[index][0] < dayStart + 86_400_000; index += 1) {
    candidates.push(prices[index]);
  }
  const closest = candidates.sort(
    (a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target),
  )[0];
  if (!closest) return null;
  return { timestamp: Math.floor(closest[0] / 1000), priceEur: closest[1] };
}

function validAddress(address: string) {
  return /^(stake1|addr1|stake_test1|addr_test1)[a-z0-9]{20,150}$/.test(address);
}

export async function GET(request: NextRequest) {
  const rawAddress = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!validAddress(rawAddress)) {
    return NextResponse.json(
      { error: "Bitte gib eine gültige Cardano-Adresse beginnend mit stake1… oder addr1… ein." },
      { status: 400 },
    );
  }

  try {
    let stakeAddress = rawAddress;
    if (rawAddress.startsWith("addr")) {
      const addressInfo = await blockfrost<BlockfrostAddress>(
        `/addresses/${encodeURIComponent(rawAddress)}`,
      );
      if (!addressInfo.stake_address) {
        throw new ApiError("Diese addr1-Adresse besitzt keine zugehörige Stake-Adresse.", 422);
      }
      stakeAddress = addressInfo.stake_address;
    }

    const [account, latestEpoch, rewards] = await Promise.all([
      blockfrost<BlockfrostAccount>(`/accounts/${encodeURIComponent(stakeAddress)}`),
      blockfrost<BlockfrostEpoch>("/epochs/latest"),
      getAllRewards(stakeAddress),
    ]);

    // Pool metadata is optional; the pool id remains available if the pool has
    // no published metadata or Blockfrost cannot serve this extra request.
    const poolMetadata = account.pool_id
      ? await blockfrost<BlockfrostPoolMetadata>(
          `/pools/${encodeURIComponent(account.pool_id)}/metadata`,
        ).catch(() => null)
      : null;

    const payoutGroups = new Map<
      number,
      { ada: number; earliestEarnedEpoch: number; poolIds: Set<string> }
    >();
    for (const reward of rewards) {
      const earnedEpoch = reward.earned_epoch ?? reward.epoch;
      const payoutEpoch = reward.spendable_epoch ?? earnedEpoch + 2;
      const amountAda = Number(reward.amount) / LOVELACE_PER_ADA;
      const existing = payoutGroups.get(payoutEpoch);
      if (existing) {
        existing.ada += amountAda;
        existing.earliestEarnedEpoch = Math.min(existing.earliestEarnedEpoch, earnedEpoch);
        existing.poolIds.add(reward.pool_id);
      } else {
        payoutGroups.set(payoutEpoch, {
          ada: amountAda,
          earliestEarnedEpoch: earnedEpoch,
          poolIds: new Set([reward.pool_id]),
        });
      }
    }

    const history = [...payoutGroups.entries()]
      .map(([payoutEpoch, values]) => {
        const payoutAt = latestEpoch.start_time - (latestEpoch.epoch - payoutEpoch) * EPOCH_SECONDS;
        return {
          epoch: payoutEpoch,
          earnedEpoch: values.earliestEarnedEpoch,
          timestamp: payoutAt,
          ada: values.ada,
          poolIds: [...values.poolIds],
        };
      })
      .filter((item) => Number.isFinite(item.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);

    const firstPayout = history[0]?.timestamp;
    const [currentPriceEur, historicalResult] = await Promise.all([
      getCurrentPrice(),
      firstPayout
        ? getHistoricalPrices(firstPayout)
        : Promise.resolve({ prices: [], source: null, error: "Keine Rewards vorhanden", keyConfigured: Boolean(process.env.COINGECKO_API_KEY || process.env.COINGECKO_PRO_API_KEY) }),
    ]);
    const historicalPrices = historicalResult.prices;

    const pricedHistory = history.map((reward) => {
      const quote = nearestSameDayPrice(reward.timestamp, historicalPrices);
      const priceEur = quote?.priceEur ?? null;
      return {
        ...reward,
        priceEur,
        priceTimestamp: quote?.timestamp ?? null,
        valueEur: priceEur === null ? null : priceEur * reward.ada,
      };
    });

    const coverageStart = historicalPrices[0]?.[0] ?? null;
    const coverageEnd = historicalPrices[historicalPrices.length - 1]?.[0] ?? null;

    return NextResponse.json(
      {
        account: {
          stakeAddress,
          balanceAda: Number(account.controlled_amount) / LOVELACE_PER_ADA,
          rewardsAda: Number(account.rewards_sum) / LOVELACE_PER_ADA,
          withdrawableAda: Number(account.withdrawable_amount) / LOVELACE_PER_ADA,
          poolId: account.pool_id,
          poolTicker: poolMetadata?.ticker ?? null,
          poolName: poolMetadata?.name ?? null,
          active: account.active,
          historyCount: rewards.length,
        },
        network: blockfrostNetwork(),
        currentPriceEur,
        currentEpoch: {
          number: latestEpoch.epoch,
          startTime: latestEpoch.start_time,
          endTime: latestEpoch.end_time,
        },
        rewards: pricedHistory,
        priceCoverage: {
          startTime: coverageStart === null ? null : Math.floor(coverageStart / 1000),
          endTime: coverageEnd === null ? null : Math.floor(coverageEnd / 1000),
          pointCount: historicalPrices.length,
          source: historicalResult.source,
          error: historicalResult.error,
          keyConfigured: historicalResult.keyConfigured,
          valuationMethod: "Nächster tatsächlicher CoinGecko-Kursdatenpunkt desselben UTC-Kalendertags; keine Interpolation",
        },
      },
      {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  } catch (error) {
    const apiError = error instanceof ApiError ? error : null;
    const message = apiError?.message ?? "Die Wallet-Daten konnten gerade nicht geladen werden.";
    return NextResponse.json(
      { error: message },
      { status: apiError?.status ?? 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
