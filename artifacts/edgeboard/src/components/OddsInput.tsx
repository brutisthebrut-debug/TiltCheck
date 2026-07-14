import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  formatOddsAs,
  isValidAmericanOdds,
  parseOddsInput,
  type OddsFormat,
} from "@workspace/odds"

const PLACEHOLDERS: Record<OddsFormat, string> = {
  american: "-110",
  decimal: "1.91",
  fractional: "10/11",
}

interface OddsInputProps {
  /** Stored American price (int), or NaN while the input is invalid. */
  value: number
  onChange: (american: number) => void
  format: OddsFormat
  className?: string
  "data-testid"?: string
}

/**
 * Odds input that accepts whatever format the bettor's book shows
 * (American -110, decimal 1.91, fractional 10/11) and stores the
 * canonical American price. Shows the equivalent price inline so the
 * number can be reconciled against the sportsbook.
 */
export function OddsInput({ value, onChange, format, className, "data-testid": testId }: OddsInputProps) {
  const [text, setText] = useState(() =>
    isValidAmericanOdds(value) ? formatOddsAs(value, format) : ""
  )
  const [parseError, setParseError] = useState<string | null>(null)
  const lastFormat = useRef(format)

  // When the format toggle changes, re-render the current price in the new format.
  useEffect(() => {
    if (lastFormat.current !== format) {
      lastFormat.current = format
      setParseError(null)
      setText(isValidAmericanOdds(value) ? formatOddsAs(value, format) : "")
    }
  }, [format, value])

  function handleChange(raw: string) {
    setText(raw)
    const parsed = parseOddsInput(raw, format)
    if (parsed.ok) {
      setParseError(null)
      onChange(parsed.american)
    } else {
      setParseError(raw.trim() ? parsed.error : null)
      onChange(Number.NaN)
    }
  }

  const valid = isValidAmericanOdds(value)

  return (
    <div className="space-y-1">
      <Input
        className={className}
        type="text"
        inputMode={format === "fractional" ? "text" : "decimal"}
        placeholder={PLACEHOLDERS[format]}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        data-testid={testId}
      />
      {parseError ? (
        <p className="text-xs text-destructive">{parseError}</p>
      ) : valid && format !== "american" ? (
        <p className="text-xs text-muted-foreground font-mono">= {formatOddsAs(value, "american")} American</p>
      ) : valid && format === "american" ? (
        <p className="text-xs text-muted-foreground font-mono">= {formatOddsAs(value, "decimal")} decimal</p>
      ) : null}
    </div>
  )
}
