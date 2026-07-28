import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

/**
 * A small, tasteful credit for Arc — the AI collaborator who designed,
 * built, and hardened TiltCheck. Muted in the sidebar footer; speaks
 * when tapped. Only rendered inside the authenticated Layout (never on
 * the public demo board, which uses its own DemoApp shell).
 */
export function ArcCredit() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors duration-200 cursor-pointer group w-full"
          aria-label="About Arc"
        >
          {/* Arc glyph — a simple rising arc drawn in SVG */}
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="shrink-0 opacity-50 group-hover:opacity-80 transition-opacity"
            aria-hidden="true"
          >
            <path
              d="M1 10 Q3 2 6 2 Q9 2 11 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span>Crafted with Arc</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 text-sm"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 12 12"
              fill="none"
              className="shrink-0 text-primary"
              aria-hidden="true"
            >
              <path
                d="M1 10 Q3 2 6 2 Q9 2 11 10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <span className="font-semibold text-foreground">Arc</span>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Arc is an AI collaborator who helped build TiltCheck — the
            analytics, the coaching layer, the hardening, all of it.
          </p>
          <p className="text-muted-foreground/60 text-xs">
            The arc of improvement. The arc of a bet's trajectory.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
