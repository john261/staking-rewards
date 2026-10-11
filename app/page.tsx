"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, FormEvent, ReactNode } from "react";

type Reward = {
  epoch: number;
  earnedEpoch: number;
  timestamp: number;
  ada: number;
  poolIds: string[];
  priceEur: number | null;
  priceTimestamp: number | null;
  valueEur: number | null;
};

type DashboardData = {
  account: {
    stakeAddress: string;
    balanceAda: number;
    rewardsAda: number;
    withdrawableAda: number;
    poolId: string | null;
    poolTicker: string | null;
    poolName: string | null;
    active: boolean;
    historyCount: number;
  };
  network: string;
  currentPriceEur: number | null;
  currentEpoch: { number: number; startTime: number; endTime: number };
  rewards: Reward[];
  priceCoverage: {
    startTime: number | null;
    endTime: number | null;
    pointCount: number;
    source: "range" | "last365" | null;
    error: string | null;
    keyConfigured: boolean;
    valuationMethod: string;
  };
};

type Period = "currentYear" | "last365" | "all" | `year:${number}`;

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const adaFormat = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 6,
});
const currency = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const localDate = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: "grid" | "wallet" | "chart" | "download" | "arrow" | "refresh" | "clock" | "coins" | "external" | "check";
  className?: string;
}) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true as const,
  };
  const paths: Record<typeof name, ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18"/><path d="M16 14h2"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.9-2L20 12M4 12l2.5 5a7 7 0 0 0 11.9-2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    coins: <><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></>,
    external: <><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function formatCountdown(seconds: number) {
  const safe = Math.max(0, seconds);
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const secs = safe % 60;
  return { days, hours, minutes, seconds: secs };
}

function epochYear(timestamp: number) {
  return Number(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" }).format(timestamp * 1000));
}

function csvNumber(value: number | null, fractionDigits: number) {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toFixed(fractionDigits).replace(".", ",");
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function downloadCsv(rewards: Reward[], address: string, periodLabel: string, announcedEpoch: number | null) {
  const sorted = [...rewards].sort((a, b) => a.timestamp - b.timestamp);
  let cumulative = 0;
  let cumulativeKnown = true;
  const rows = [
    [
      "Epoche (Epoch)",
      "Datum & Uhrzeit der Ausschüttung",
      "Erhaltene Rewards in ADA",
      "ADA/EUR Kurs (CoinGecko-Datenpunkt am UTC-Tag)",
      "Zeitpunkt des Kurs-Datenpunkts",
      "Wert in EUR zum Zuflusszeitpunkt",
      "Laufende Summe (EUR)",
      "Status",
    ],
  ];

  for (const reward of sorted) {
    const isAnnounced = reward.epoch === announcedEpoch;
    if (!isAnnounced) {
      if (reward.valueEur === null) cumulativeKnown = false;
      else cumulative += reward.valueEur;
    }
    rows.push([
      String(reward.epoch),
      localDate.format(reward.timestamp * 1000),
      csvNumber(reward.ada, 6),
      isAnnounced ? "" : csvNumber(reward.priceEur, 6),
      isAnnounced || reward.priceTimestamp === null ? "" : localDate.format(reward.priceTimestamp * 1000),
      isAnnounced ? "" : csvNumber(reward.valueEur, 2),
      isAnnounced || !cumulativeKnown ? "" : csvNumber(cumulative, 2),
      isAnnounced ? "Blockfrost gemeldet – Ausschüttung steht noch aus" : "Ausgeschüttet",
    ]);
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeAddress = address.slice(0, 12).replace(/[^a-z0-9]/gi, "");
  const safePeriod = periodLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  link.href = url;
  link.download = `cardano-steuerexport-${safeAddress}-${safePeriod || "gesamt"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function StatCard({
  title,
  icon,
  children,
  note,
  accent = false,
}: {
  title: string;
  icon: ComponentProps<typeof Icon>["name"];
  children: ReactNode;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className={`relative overflow-hidden rounded-xl border p-5 ${accent ? "border-[#9bd964]/50 bg-[#1d2b34]" : "border-[#334158] bg-[#192235]"}`}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[#c4cfe1]">{title}</p>
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${accent ? "bg-[#b9f574]/15 text-[#b9f574]" : "bg-[#26334b] text-[#9eacc3]"}`}>
          <Icon name={icon} className="h-[18px] w-[18px]" />
        </span>
      </div>
      {children}
      <p className="mt-4 text-xs text-[#91a0b9]">{note}</p>
    </article>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[#36445b] ${className}`} />;
}

function RewardBars({ rewards }: { rewards: Reward[] }) {
  const bars = useMemo(() => {
    const recent = rewards.slice(-12);
    const max = Math.max(...recent.map((item) => item.ada), 0.000001);
    return recent.map((item) => ({ ...item, height: Math.max(8, (item.ada / max) * 100) }));
  }, [rewards]);

  if (bars.length === 0) {
    return <div className="flex h-[84px] items-center justify-center text-xs text-[#8492aa]">Die Epoch-Rewards erscheinen hier nach dem Laden.</div>;
  }

  return (
    <div className="flex h-[84px] items-end gap-2 sm:gap-3" aria-label="Rewards der letzten zwölf Ausschüttungsepochen">
      {bars.map((bar) => (
        <div key={bar.epoch} className="group relative flex h-full flex-1 items-end justify-center">
          <span className="absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded bg-[#0d1421] px-2 py-1 text-[11px] text-white shadow-lg group-hover:block">
            Epoche {bar.epoch}: {adaFormat.format(bar.ada)} ADA
          </span>
          <div
            className="w-full max-w-8 rounded-t-sm border-t border-[#d5ff9e] bg-gradient-to-t from-[#6a9b47] to-[#b9f574] opacity-80 transition-opacity group-hover:opacity-100"
            style={{ height: `${bar.height}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [addressInput, setAddressInput] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [period, setPeriod] = useState<Period>("currentYear");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const currentYear = epochYear(Math.floor(now / 1000));
  const nextKnownReward = useMemo(() => {
    if (!data) return null;
    return data.rewards
      .filter((reward) => reward.epoch > data.currentEpoch.number)
      .sort((a, b) => a.epoch - b.epoch)[0] ?? null;
  }, [data]);

  const visibleRewards = useMemo(() => {
    if (!data) return [];
    const isAnnounced = (reward: Reward) => reward.epoch === nextKnownReward?.epoch;
    const belongsToPeriod = (reward: Reward) => {
      if (period === "all") return true;
      if (period === "last365") return reward.timestamp >= Math.floor(now / 1000) - 365 * 86_400;
      const selectedYear = period === "currentYear" ? currentYear : Number(period.split(":")[1]);
      return epochYear(reward.timestamp) === selectedYear;
    };

    // Blockfrost already reports the next epoch's concrete reward. Include it even
    // before its availability timestamp, but keep it visibly marked as pending.
    return data.rewards.filter((reward) => (reward.timestamp <= Math.floor(now / 1000) || isAnnounced(reward)) && belongsToPeriod(reward));
  }, [currentYear, data, nextKnownReward, now, period]);

  const isAnnouncedReward = (reward: Reward) => reward.epoch === nextKnownReward?.epoch;
  const historicalRewards = visibleRewards.filter((reward) => !isAnnouncedReward(reward));
  const announcedReward = visibleRewards.find(isAnnouncedReward) ?? null;

  const cumulativeByEpoch = useMemo(() => {
    let cumulative = 0;
    let cumulativeKnown = true;
    const totals = new Map<number, number | null>();
    for (const reward of [...visibleRewards].sort((a, b) => a.timestamp - b.timestamp)) {
      if (reward.epoch === nextKnownReward?.epoch) {
        totals.set(reward.epoch, null);
        continue;
      }
      if (reward.valueEur === null) cumulativeKnown = false;
      else cumulative += reward.valueEur;
      totals.set(reward.epoch, cumulativeKnown ? cumulative : null);
    }
    return totals;
  }, [nextKnownReward, visibleRewards]);

  const pricedEur = historicalRewards.reduce((sum, reward) => sum + (reward.valueEur ?? 0), 0);
  const summaryAda = visibleRewards.reduce((sum, reward) => sum + reward.ada, 0);
  const valuedRows = historicalRewards.filter((reward) => reward.valueEur !== null).length;
  const summaryEur = valuedRows === historicalRewards.length ? pricedEur : null;
  const unpricedHistoricalCount = historicalRewards.length - valuedRows;
  const receivedRewardCount = visibleRewards.length;
  const nextRewardTimestamp = nextKnownReward?.timestamp ?? data?.currentEpoch.endTime ?? null;
  const nextRewardTimeLabel = nextKnownReward ? "Reward-Verfügbarkeit in" : "Nächster Epochengrenzpunkt in";
  const timeLeft = nextRewardTimestamp === null
    ? null
    : formatCountdown(Math.floor(nextRewardTimestamp - now / 1000));
  const years = Array.from({ length: Math.max(1, currentYear - 2020 + 1) }, (_, index) => currentYear - index);
  const periodLabel = period === "all"
    ? "Gesamtzeitraum"
    : period === "last365"
      ? "Letzte 365 Tage"
      : period === "currentYear"
        ? `Steuerjahr ${currentYear} (bis heute)`
        : `Steuerjahr ${period.split(":")[1]}`;

  async function loadWallet(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const address = addressInput.trim();
    if (!address) {
      setError("Bitte gib zuerst eine Cardano Stake- oder Wallet-Adresse ein.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard?address=${encodeURIComponent(address)}`, { cache: "no-store" });
      const result = (await response.json()) as DashboardData | { error: string };
      if (!response.ok || "error" in result) {
        throw new Error("error" in result ? result.error : "Die Adresse konnte nicht geladen werden.");
      }
      setData(result);
      setAddressInput(result.account.stakeAddress);
      setPeriod("currentYear");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unbekannter Fehler beim Laden der Wallet.");
    } finally {
      setLoading(false);
    }
  }

  async function copyAddress() {
    if (!data) return;
    await navigator.clipboard.writeText(data.account.stakeAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  function exportCsv() {
    if (!data || visibleRewards.length === 0) return;
    downloadCsv(visibleRewards, data.account.stakeAddress, periodLabel, announcedReward?.epoch ?? null);
  }

  return (
    <div className="min-h-screen text-[#f2f5fc]">
      <div className="mx-auto flex min-h-screen max-w-[1680px]">
        <aside className="hidden w-[226px] shrink-0 border-r border-[#2b3850] bg-[#141d2d]/80 px-4 py-6 lg:flex lg:flex-col">
          <div className="flex items-center gap-3 px-2">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#b9f574] text-[#1c2a23]">
              <span className="text-xl font-black">₳</span>
            </div>
            <div>
              <p className="font-semibold tracking-tight">epoch<span className="text-[#b9f574]">.</span></p>
              <p className="text-[10px] uppercase tracking-[.19em] text-[#8695ad]">Cardano analytics</p>
            </div>
          </div>

          <p className="mb-2 mt-12 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-[#7f8da4]">Workspace</p>
          <nav className="space-y-1" aria-label="Hauptnavigation">
            <a href="#overview" className="flex items-center gap-3 rounded-lg bg-[#26334b] px-3 py-2.5 text-sm font-medium text-white">
              <Icon name="grid" className="h-[17px] w-[17px] text-[#b9f574]" /> Dashboard
            </a>
            <a href="#rewards" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#a4b1c8] transition hover:bg-[#202b41] hover:text-white">
              <Icon name="chart" className="h-[17px] w-[17px]" /> Reward-Historie
            </a>
            <a href="#steuerexport" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#a4b1c8] transition hover:bg-[#202b41] hover:text-white">
              <Icon name="download" className="h-[17px] w-[17px]" /> Steuer-Export
            </a>
          </nav>

          <div className="mt-auto rounded-xl border border-[#334158] bg-[#192235] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[#dce4f2]">
              <span className="h-2 w-2 rounded-full bg-[#b9f574] shadow-[0_0_10px_#b9f574]" /> {data?.network ?? "Mainnet"} verbunden
            </div>
            <p className="text-[11px] leading-relaxed text-[#929fb5]">Nur Lesezugriff. Deine Adresse wird nicht dauerhaft gespeichert.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-12 pt-5 sm:px-6 lg:px-9 lg:pt-7">
          <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-[#2b3850] pb-5">
            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[.18em] text-[#8f9db4]">
                <span className="hidden sm:inline">Cardano</span><span className="hidden sm:inline text-[#53627c]">/</span><span>Dashboard</span>
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Staking Overview</h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-[#394962] bg-[#192235] px-3 py-1.5 text-xs text-[#c7d2e4]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#b9f574]" /> Cardano {data?.network ?? "Mainnet"}
              </div>
              <button
                onClick={() => void loadWallet()}
                disabled={!data || loading}
                aria-label="Daten aktualisieren"
                className="grid h-9 w-9 place-items-center rounded-lg border border-[#394962] text-[#aab7ca] transition hover:bg-[#202b41] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="refresh" className="h-4 w-4" />
              </button>
            </div>
          </header>

          <section id="overview" className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.8fr)]">
            <article className="soft-grid relative overflow-hidden rounded-xl border border-[#34445e] bg-[#192235] p-5 sm:p-7">
              <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border border-[#7188a8]/10" />
              <div className="absolute -right-8 -top-16 h-56 w-56 rounded-full border border-[#7188a8]/10" />
              <div className="relative">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[#bac6d9]">Delegated Balance</p>
                    <p className="mt-1 text-xs text-[#8392aa]">Aktuell delegierter ADA-Kontostand</p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-md border border-[#465774] bg-[#111a29]/80 px-2.5 py-1.5 text-[11px] font-medium text-[#c8d5e8]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#b9f574]" /> LIVE
                  </span>
                </div>

                <div className="grid gap-7 md:grid-cols-[minmax(0,1.2fr)_minmax(220px,.8fr)] md:items-end">
                  <div>
                    {loading && !data ? (
                      <><Skeleton className="h-10 w-56"/><Skeleton className="mt-3 h-5 w-36"/></>
                    ) : (
                      <>
                        <p className="text-4xl font-semibold tracking-tight sm:text-5xl">{data ? adaFormat.format(data.account.balanceAda) : "—"}<span className="ml-2 text-lg font-medium text-[#a4b1c8]">ADA</span></p>
                        <p className="mt-2 text-base text-[#a6b4ca]">
                          {data ? data.currentPriceEur !== null ? currency.format(data.account.balanceAda * data.currentPriceEur) : "ADA/EUR-Kurs gerade nicht verfügbar" : "Warte auf Wallet-Verbindung"}
                        </p>
                      </>
                    )}
                  </div>

                  <form onSubmit={loadWallet} className="rounded-lg border border-[#3b4b64] bg-[#111a29]/80 p-3">
                    <label htmlFor="wallet-address" className="mb-2 block text-[11px] font-medium text-[#aebbd0]">Stake- oder Wallet-Adresse</label>
                    <div className="flex gap-2">
                      <input
                        id="wallet-address"
                        value={addressInput}
                        onChange={(event) => setAddressInput(event.target.value)}
                        placeholder="stake1… oder addr1…"
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby={error ? "address-error" : undefined}
                        className="min-w-0 flex-1 bg-transparent px-1 py-2 text-xs text-white outline-none placeholder:text-[#738199]"
                      />
                      <button type="submit" disabled={loading} className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#b9f574] px-3 py-2 text-xs font-semibold text-[#18251d] transition hover:bg-[#caff91] disabled:opacity-60">
                        {loading ? "Lädt…" : "Verbinden"}<Icon name="arrow" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </form>
                </div>

                {error && <p id="address-error" role="alert" className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">{error}</p>}
                {data && (
                  <button onClick={() => void copyAddress()} className="mt-5 inline-flex max-w-full items-center gap-2 rounded-md border border-[#394962] bg-[#141e2e]/70 px-2.5 py-1.5 text-[11px] text-[#aebbd0] transition hover:border-[#7185a3]">
                    <Icon name="wallet" className="h-3.5 w-3.5 shrink-0" />
                    <span className="max-w-[260px] truncate">{data.account.stakeAddress}</span>
                    <span className="text-[#b9f574]">{copied ? "Kopiert" : "Kopieren"}</span>
                  </button>
                )}
              </div>
            </article>

            <article className="relative flex flex-col justify-between overflow-hidden rounded-xl border border-[#34445e] bg-[#202c42] p-5 sm:p-6">
              <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-[#82b5ff]/[.06] blur-2xl" />
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-[#d7e2f3]">Nächste Reward-Ausschüttung</p>
                  <p className="mt-1 text-xs text-[#91a0b8]">{nextKnownReward ? `Blockfrost meldet Epoche ${nextKnownReward.epoch}` : "Für den nächsten Termin ist noch kein Reward gemeldet"}</p>
                </div>
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#35445f] text-[#a8caff]"><Icon name="clock" className="h-[18px] w-[18px]" /></span>
              </div>
              <div className="relative mt-7">
                <p className="text-2xl font-semibold tracking-tight text-[#c7d2e4]">{nextKnownReward ? `${adaFormat.format(nextKnownReward.ada)} ADA` : "Betrag unbekannt"}</p>
                <p className="mt-1 text-sm text-[#a9b7cc]">{nextKnownReward ? nextKnownReward.valueEur === null ? "Kein exakt passender EUR-Kurs" : currency.format(nextKnownReward.valueEur) : "Kein künftiger Reward gemeldet"}</p>
              </div>
              <div className="relative mt-6 border-t border-[#43516a] pt-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#a2b0c6]">{nextKnownReward ? `Epoche ${nextKnownReward.epoch} · ${localDate.format(nextKnownReward.timestamp * 1000)}` : data ? `${nextRewardTimeLabel} · ${localDate.format(data.currentEpoch.endTime * 1000)}` : nextRewardTimeLabel}</p>
                <div className="flex gap-2">
                  {[
                    ["Tage", timeLeft?.days],
                    ["Std.", timeLeft?.hours],
                    ["Min.", timeLeft?.minutes],
                    ["Sek.", timeLeft?.seconds],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="min-w-0 flex-1 rounded-md border border-[#3a4962] bg-[#182237]/60 px-2 py-2 text-center">
                      <p className="font-mono text-lg font-semibold tabular-nums">{value === undefined ? "—" : String(value).padStart(2, "0")}</p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-wider text-[#94a2b8]">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          </section>

          <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="ADA-Rewards im Zeitraum" icon="coins" note={data ? `${announcedReward ? `inkl. Blockfrost-gemeldeter Epoche ${announcedReward.epoch} (noch offen)` : "ausgeschüttete Rewards"} · ${periodLabel}` : "Rewards des gewählten Zeitraums"}>
              <p className="text-2xl font-semibold">{data ? `${adaFormat.format(summaryAda)} ADA` : "—"}</p>
              <p className="mt-1 text-xs text-[#91a0b9]">{data ? `ADA inkl. gemeldetem Reward · EUR-Wert der ausgeschütteten Rewards: ${summaryEur === null ? "historische Kursdaten fehlen teilweise" : currency.format(summaryEur)}` : "ADA-Rewards und EUR-Bewertung des Zeitraums"}</p>
            </StatCard>
            <StatCard title="Aktueller ADA-Kurs" icon="chart" note="ADA / EUR · CoinGecko">
              <p className="text-2xl font-semibold">{data && data.currentPriceEur !== null ? currency.format(data.currentPriceEur) : "—"}</p>
              <p className="mt-1 text-xs text-[#91a0b9]">Live-Marktkurs</p>
            </StatCard>
            <StatCard title="Reward-Epochen" icon="grid" note={data ? `${announcedReward ? `inkl. Epoche ${announcedReward.epoch} · noch ausstehend` : "ausgeschüttet"} · ${periodLabel}` : "Einträge im gewählten Zeitraum"}>
              <p className="text-2xl font-semibold">{data ? number.format(receivedRewardCount) : "—"}</p>
              <p className="mt-1 text-xs text-[#91a0b9]">{data ? `${valuedRows} von ${historicalRewards.length} ausgeschütteten Rewards mit EUR-Kurs bewertet` : "Reward-Einträge des Zeitraums"}</p>
            </StatCard>
            <StatCard title="Aktuell delegiert an" icon="wallet" note={data?.account.active ? "Aktuelle Delegation laut Blockfrost" : "Stake-Konto noch nicht verbunden"}>
              <p className="truncate text-base font-semibold" title={data?.account.poolId ?? undefined}>
                {data?.account.poolId
                  ? [data.account.poolTicker ? `[${data.account.poolTicker}]` : null, data.account.poolName].filter(Boolean).join(" · ") || `${data.account.poolId.slice(0, 13)}…${data.account.poolId.slice(-5)}`
                  : "Keine aktive Delegation"}
              </p>
              {data?.account.poolId && <p className="mt-2 break-all font-mono text-[9px] leading-4 text-[#91a0b9]">{data.account.poolId}</p>}
              <p className="mt-2 text-xs text-[#91a0b9]">{data?.account.active ? "Delegation aktiv" : "Keine aktive Delegation"}</p>
            </StatCard>
          </section>

          <section id="rewards" className="overflow-hidden rounded-xl border border-[#334158] bg-[#192235]">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#344158] px-4 py-4 sm:px-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold">Epoch Rewards</h2>
                  <span className="rounded bg-[#293650] px-1.5 py-0.5 text-[10px] text-[#aab8cf]">{visibleRewards.length} Epochen</span>
                </div>
                <p className="mt-1 text-xs text-[#93a1b7]">Reward-Datum entspricht dem Beginn der Verfügbarkeitsepoche.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="period">Zeitraum auswählen</label>
                <select
                  id="period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value as Period)}
                  className="h-9 rounded-lg border border-[#465671] bg-[#121b2b] px-3 text-xs text-[#dbe4f1] outline-none focus:border-[#b9f574]"
                >
                  <option value="currentYear">Laufendes Steuerjahr {currentYear} (bis heute)</option>
                  <option value="last365">Letzte 365 Tage</option>
                  {years.filter((year) => year !== currentYear).map((year) => <option key={year} value={`year:${year}`}>Steuerjahr {year}</option>)}
                  <option value="all">Gesamter Zeitraum</option>
                </select>
                <button
                  id="steuerexport"
                  onClick={exportCsv}
                  disabled={!data || visibleRewards.length === 0}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#b9f574] px-3.5 text-xs font-semibold text-[#18251d] shadow-[0_4px_18px_rgba(185,245,116,.12)] transition hover:bg-[#caff91] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Icon name="download" className="h-4 w-4" />
                  📊 Steuer-Export (Excel / CSV) herunterladen
                </button>
              </div>
            </div>

            <div className="grid gap-0 border-b border-[#344158] lg:grid-cols-[minmax(230px,.8fr)_minmax(320px,1.2fr)]">
              <div className="border-b border-[#344158] px-4 py-4 lg:border-b-0 lg:border-r sm:px-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-[#bac6d9]">Rewards je Epoche · letzte 12</p>
                  <span className="text-[10px] text-[#8e9cb3]">ADA</span>
                </div>
                <RewardBars rewards={data?.rewards ?? []} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 sm:px-5">
                <div>
                  <p className="text-[11px] text-[#92a0b7]">EUR-Steuerwert · {periodLabel}{announcedReward ? " · ohne angekündigten Reward" : ""}</p>
                  <p className="mt-1 text-xl font-semibold">{data ? summaryEur === null ? "Nicht vollständig bewertbar" : currency.format(summaryEur) : "—"}</p>
                </div>
                <div className="flex gap-6">
                  <div><p className="text-[10px] uppercase tracking-wider text-[#8795ac]">Rewards</p><p className="mt-1 text-sm font-medium">{data ? `${adaFormat.format(summaryAda)} ADA` : "—"}</p></div>
                  <div><p className="text-[10px] uppercase tracking-wider text-[#8795ac]">Kurse vorhanden</p><p className="mt-1 text-sm font-medium">{data ? `${valuedRows} / ${historicalRewards.length} ausgeschüttet` : "—"}</p></div>
                </div>
              </div>
            </div>

            {announcedReward && (
              <div className="border-b border-[#344158] bg-[#213629]/70 px-4 py-2.5 text-[11px] leading-relaxed text-[#c7edaa] sm:px-5" role="status">
                Epoche {announcedReward.epoch}: {adaFormat.format(announcedReward.ada)} ADA sind bereits konkret von Blockfrost gemeldet und in ADA-Summe, Tabelle und CSV enthalten. Die Ausschüttung steht noch aus; deshalb bleiben Kurs und EUR-Zuflusswert bis zum tatsächlichen Ausschüttungsdatum offen.
              </div>
            )}

            {data && unpricedHistoricalCount > 0 && historicalRewards.length > 0 && (
              <div className="border-b border-[#344158] bg-[#57441c]/20 px-4 py-2.5 text-[11px] leading-relaxed text-[#ead39a] sm:px-5">
                Für {unpricedHistoricalCount} von {historicalRewards.length} bereits ausgeschütteten Rewards fehlt ein CoinGecko-Kursdatenpunkt für denselben UTC-Kalendertag. Nur für diese historischen Rewards bleibt der EUR-Wert offen; angekündigte Rewards werden separat ausgewiesen.
                {valuedRows === 0 && (
                  <div className="mt-1 text-[#f3d993]" role="status">
                    Kursabruf: {data.priceCoverage.source ?? "keine Kursreihe"} · {data.priceCoverage.pointCount} Datenpunkte · API-Key {data.priceCoverage.keyConfigured ? "vorhanden" : "fehlt"}{data.priceCoverage.error ? ` · ${data.priceCoverage.error}` : ""}
                  </div>
                )}
              </div>
            )}

            <div className="table-scroll overflow-x-auto">
              <table className="w-full min-w-[1020px] border-collapse text-left text-xs">
                <thead className="bg-[#151e2e] text-[10px] uppercase tracking-[.08em] text-[#b0bdd0]">
                  <tr>
                    <th className="border-b border-[#39465b] px-4 py-3 font-semibold">Epoch <span className="text-[#b9f574]">↓</span></th>
                    <th className="border-b border-[#39465b] px-4 py-3 font-semibold">Reward Date</th>
                    <th className="border-b border-[#39465b] px-4 py-3 font-semibold">Pool</th>
                    <th className="border-b border-[#39465b] px-4 py-3 text-right font-semibold">Rewards (₳)</th>
                    <th className="border-b border-[#39465b] px-4 py-3 text-right font-semibold">Rate (€/₳)</th>
                    <th className="border-b border-[#39465b] px-4 py-3 text-right font-semibold">Wert (€)</th>
                    <th className="border-b border-[#39465b] px-4 py-3 text-right font-semibold">Laufend (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {!data && !loading && (
                    <tr><td colSpan={7} className="px-6 py-14 text-center">
                      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-[#26344b] text-[#b9f574]"><Icon name="wallet" /></div>
                      <p className="text-sm font-medium text-[#dbe3f0]">Verbinde deine Cardano-Adresse</p>
                      <p className="mt-1 text-xs text-[#8e9cb3]">Deine Reward-Epochen erscheinen anschließend hier.</p>
                    </td></tr>
                  )}
                  {loading && !data && Array.from({ length: 4 }, (_, index) => (
                    <tr key={index} className="border-b border-[#2f3b50]"><td colSpan={7} className="px-4 py-4"><Skeleton className="h-4 w-full" /></td></tr>
                  ))}
                  {data && visibleRewards.length === 0 && (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-[#96a4ba]">Für den ausgewählten Zeitraum wurden keine Reward-Ausschüttungen gefunden.</td></tr>
                  )}
                  {data && [...visibleRewards].sort((a, b) => b.timestamp - a.timestamp).map((reward) => {
                    const cumulative = cumulativeByEpoch.get(reward.epoch);
                    return (
                      <tr key={`${reward.epoch}-${reward.timestamp}`} className="border-b border-[#303d52] text-[#e5eaf3] transition hover:bg-[#222e44]">
                        <td className="whitespace-nowrap px-4 py-3.5 font-semibold tabular-nums">
                          {reward.epoch}
                          {isAnnouncedReward(reward) && <span className="ml-2 rounded bg-[#b9f574]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#c8f59a]">Gemeldet · offen</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-[#bdc9db]">{localDate.format(reward.timestamp * 1000)}</td>
                        <td className="px-4 py-3.5"><span title={reward.poolIds.join(", ")} className="inline-flex items-center gap-1.5 text-[#d1dceb]">{reward.poolIds.length === 1 ? `${reward.poolIds[0].slice(0, 5)}…` : reward.poolIds.length > 1 ? `${reward.poolIds[0].slice(0, 5)}… +${reward.poolIds.length - 1}` : "—"}<span className="grid h-4 w-4 place-items-center rounded-full bg-[#b9f574] text-[#17251c]"><Icon name="arrow" className="h-2.5 w-2.5" /></span></span></td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-medium tabular-nums">{adaFormat.format(reward.ada)}</td>
                        <td title={isAnnouncedReward(reward) ? "Noch keine historische Kursbewertung: die Ausschüttung steht aus" : reward.priceTimestamp === null ? "Kein CoinGecko-Datenpunkt für denselben UTC-Kalendertag" : `CoinGecko-Datenpunkt: ${localDate.format(reward.priceTimestamp * 1000)}`} className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-[#bfcbdd]">{isAnnouncedReward(reward) ? "nach Ausschüttung" : reward.priceEur === null ? "—" : currency.format(reward.priceEur)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right font-medium tabular-nums">{isAnnouncedReward(reward) ? "offen" : reward.valueEur === null ? "—" : currency.format(reward.valueEur)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-[#bdc9db]">{cumulative == null ? "—" : currency.format(cumulative)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[10px] text-[#8694aa] sm:px-5">
              <span>EUR-Kurs = nächster tatsächlicher CoinGecko-Datenpunkt desselben UTC-Kalendertags; keine Interpolation. Kurszeitpunkt steht im CSV.</span>
              <span>{data ? `${visibleRewards.length} Einträge · ${periodLabel}` : "Noch keine Wallet geladen"}</span>
            </div>
          </section>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-[#718099]">
            <p>Nur zur Information — bitte Steuerwerte mit den Anforderungen deines Finanzamts abgleichen.</p>
            <p>Epoch Dashboard <span className="mx-1 text-[#43516a]">·</span> ADA {data?.network ?? "Mainnet"}</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
