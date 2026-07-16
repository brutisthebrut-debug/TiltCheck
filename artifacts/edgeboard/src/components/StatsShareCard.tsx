/**
 * StatsShareCard — a fixed-size card rendered off-screen for image export.
 *
 * All styles are inline (no Tailwind/CSS-var) so html2canvas can capture them
 * faithfully without needing to resolve computed properties at snapshot time.
 *
 * Card size: 1200 × 630 (landscape Twitter/Instagram OG ratio).
 */
import React from "react"

// ── Electric dark theme palette (hardcoded so html2canvas sees real values) ─
const C = {
  bg:         "#080a10",   // hsl(240 10% 4%)
  card:       "#0d0f18",   // hsl(240 10% 7%)
  border:     "#1a1d2e",   // hsl(240 10% 14%)
  primary:    "#00d4ff",   // hsl(190 100% 50%) — Electric Cyan
  green:      "#00ff80",   // hsl(150 100% 50%) — Neon Green
  pink:       "#ff1a66",   // hsl(340 100% 55%) — Hot Pink
  amber:      "#ffaa00",   // hsl(40 100% 50%) — streak accent
  fg:         "#f8fafc",
  muted:      "#8890aa",
  mutedDark:  "#50566e",
} as const

export interface StatsCardData {
  displayName: string
  avatarColor: string
  roi: number
  winRate: number
  currentStreak: number
  currentStreakType: "win" | "loss" | "none"
  wins: number
  losses: number
  pushes: number
  bestSport: string | null
  bestSportRoi: number | null
  totalWagered: number
  filterLabel: string   // e.g. "NBA · Last 30 days" or "All time"
}

function pct(n: number | null | undefined, decimals = 1) {
  if (n == null || !isFinite(n)) return "—"
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`
}

export const StatsShareCard = React.forwardRef<HTMLDivElement, { data: StatsCardData }>(
  function StatsShareCard({ data }, ref) {
    const roiColor  = data.roi > 0 ? C.green : data.roi < 0 ? C.pink : C.muted
    const streakLabel =
      data.currentStreakType === "none" || data.currentStreak === 0
        ? "—"
        : `${data.currentStreakType === "win" ? "W" : "L"}${data.currentStreak}`
    const streakColor =
      data.currentStreakType === "win"
        ? C.green
        : data.currentStreakType === "loss"
        ? C.pink
        : C.muted
    const initial = (data.displayName[0] ?? "?").toUpperCase()
    const totalDecided = data.wins + data.losses

    return (
      <div
        ref={ref}
        style={{
          width: 1200,
          height: 630,
          background: C.bg,
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
          flexShrink: 0,
        }}
      >
        {/* ── Background grid decoration ─────────────────────────────────── */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: `
            linear-gradient(${C.border}33 1px, transparent 1px),
            linear-gradient(90deg, ${C.border}33 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          opacity: 0.5,
        }} />

        {/* ── Cyan glow blob top-left ────────────────────────────────────── */}
        <div style={{
          position: "absolute", top: -120, left: -80,
          width: 480, height: 480,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.primary}18 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />

        {/* ── Pink glow blob bottom-right ────────────────────────────────── */}
        <div style={{
          position: "absolute", bottom: -140, right: -100,
          width: 500, height: 500,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.pink}14 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />

        {/* ── Content container ─────────────────────────────────────────── */}
        <div style={{
          position: "relative", zIndex: 1,
          padding: "52px 64px",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}>

          {/* ── Header row: brand + filter label ──────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 36 }}>
            {/* Brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* TC logo mark */}
              <div style={{
                width: 36, height: 36,
                borderRadius: 8,
                background: `linear-gradient(135deg, ${C.primary}, ${C.green})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 800, color: C.bg, letterSpacing: "-0.5px",
                flexShrink: 0,
              }}>TC</div>
              <span style={{
                fontSize: 17, fontWeight: 700, color: C.fg,
                letterSpacing: "-0.2px",
              }}>TiltCheck</span>
              <span style={{
                marginLeft: 6,
                padding: "2px 8px",
                borderRadius: 6,
                background: `${C.primary}20`,
                border: `1px solid ${C.primary}40`,
                fontSize: 11, fontWeight: 600, color: C.primary,
                letterSpacing: "0.3px",
              }}>EdgeBoard</span>
            </div>

            {/* Filter context */}
            {data.filterLabel !== "All time" && (
              <div style={{
                padding: "4px 14px",
                borderRadius: 20,
                background: `${C.border}cc`,
                border: `1px solid ${C.border}`,
                fontSize: 13, fontWeight: 500, color: C.muted,
                letterSpacing: "0.1px",
              }}>{data.filterLabel}</div>
            )}
          </div>

          {/* ── Avatar + name row ─────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 40 }}>
            <div style={{
              width: 72, height: 72,
              borderRadius: "50%",
              background: data.avatarColor,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 30, fontWeight: 800, color: "#fff",
              flexShrink: 0,
              boxShadow: `0 0 0 3px ${C.bg}, 0 0 0 5px ${data.avatarColor}60`,
            }}>{initial}</div>
            <div>
              <div style={{ fontSize: 32, fontWeight: 800, color: C.fg, letterSpacing: "-0.8px", lineHeight: 1.1 }}>
                {data.displayName}
              </div>
              <div style={{ fontSize: 14, color: C.muted, marginTop: 4, letterSpacing: "0.2px" }}>
                {totalDecided > 0
                  ? `${data.wins}W – ${data.losses}L${data.pushes > 0 ? ` – ${data.pushes}P` : ""} · ${data.filterLabel}`
                  : data.filterLabel}
              </div>
            </div>
          </div>

          {/* ── Metrics grid ───────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 16, flex: 1 }}>
            {/* ROI */}
            <MetricCard
              label="ROI"
              value={totalDecided > 0 ? pct(data.roi) : "—"}
              valueColor={totalDecided > 0 ? roiColor : C.muted}
              sub={totalDecided > 0 ? `on ${totalDecided} graded` : "no graded bets yet"}
              glow={data.roi > 0 ? C.green : data.roi < 0 ? C.pink : undefined}
            />
            {/* Win Rate */}
            <MetricCard
              label="Win Rate"
              value={totalDecided > 0 ? `${data.winRate.toFixed(1)}%` : "—"}
              valueColor={data.winRate >= 52 ? C.green : data.winRate >= 45 ? C.fg : C.muted}
              sub={`${data.wins}W / ${data.losses}L`}
            />
            {/* Current Streak */}
            <MetricCard
              label="Current Streak"
              value={streakLabel}
              valueColor={streakColor}
              sub={
                data.currentStreakType === "win"
                  ? `${data.currentStreak}-game win streak`
                  : data.currentStreakType === "loss"
                  ? `${data.currentStreak}-game loss streak`
                  : "No active streak"
              }
              glow={data.currentStreakType === "win" && data.currentStreak >= 3 ? C.green : undefined}
            />
            {/* Best Sport */}
            <MetricCard
              label={data.bestSport ? `Best · ${data.bestSport}` : "Best Sport"}
              value={data.bestSport && data.bestSportRoi != null ? pct(data.bestSportRoi) : "—"}
              valueColor={data.bestSportRoi != null && data.bestSportRoi > 0 ? C.green : C.muted}
              sub={data.bestSport ? `ROI in ${data.bestSport}` : "no sport data"}
            />
          </div>

          {/* ── Footer watermark ───────────────────────────────────────────── */}
          <div style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 13, color: C.mutedDark, letterSpacing: "0.2px" }}>
              Track your edge at <span style={{ color: C.primary }}>EdgeBoard</span>
            </span>
            <span style={{ fontSize: 12, color: C.mutedDark, fontFamily: "'Space Mono', monospace" }}>
              tiltcheck.io
            </span>
          </div>
        </div>
      </div>
    )
  }
)

// ── Individual metric card ─────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  valueColor,
  sub,
  glow,
}: {
  label: string
  value: string
  valueColor: string
  sub: string
  glow?: string
}) {
  return (
    <div style={{
      flex: 1,
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: "22px 24px",
      display: "flex", flexDirection: "column", gap: 8,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Glow blob behind big value */}
      {glow && (
        <div style={{
          position: "absolute", top: -20, right: -20,
          width: 120, height: 120,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${glow}18 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />
      )}
      <div style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "1px" }}>
        {label}
      </div>
      <div style={{
        fontSize: 40, fontWeight: 800, color: valueColor,
        fontFamily: "'Space Mono', 'Courier New', monospace",
        lineHeight: 1.1,
        letterSpacing: "-1px",
        textShadow: glow ? `0 0 24px ${glow}60` : undefined,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: C.mutedDark, marginTop: "auto" }}>
        {sub}
      </div>
    </div>
  )
}
