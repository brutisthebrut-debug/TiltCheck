import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // 400-series text on 500/20 tints: keeps the electric glow while
        // clearing WCAG AA contrast on the dark card background (500-series
        // "lost" and "push" measured 4.16:1 and 3.28:1 — below the 4.5:1 bar).
        won: "border-transparent bg-green-500/20 text-green-400",
        lost: "border-transparent bg-red-500/20 text-red-400",
        pending: "border-transparent bg-yellow-500/20 text-yellow-400",
        push: "border-transparent bg-gray-500/20 text-gray-400",
        void: "border-transparent bg-gray-500/20 text-gray-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
