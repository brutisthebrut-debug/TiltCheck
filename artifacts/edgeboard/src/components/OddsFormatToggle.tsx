import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { OddsFormat } from "@workspace/odds"

const OPTIONS: Array<{ value: OddsFormat; label: string }> = [
  { value: "american", label: "-110" },
  { value: "decimal", label: "1.91" },
  { value: "fractional", label: "10/11" },
]

interface OddsFormatToggleProps {
  value: OddsFormat
  onChange: (format: OddsFormat) => void
}

/** Three-way switch for how odds are typed and displayed. */
export function OddsFormatToggle({ value, onChange }: OddsFormatToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Odds format</span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value}
        onValueChange={(v) => {
          if (v === "american" || v === "decimal" || v === "fractional") onChange(v)
        }}
      >
        {OPTIONS.map((opt) => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            className="font-mono text-xs px-2"
            aria-label={`${opt.value} odds`}
            data-testid={`toggle-odds-${opt.value}`}
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
