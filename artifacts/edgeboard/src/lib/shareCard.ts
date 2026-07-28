/**
 * shareCard — export a DOM node as a PNG and share or download it.
 *
 * Uses html2canvas to snapshot the off-screen card element. On mobile, tries
 * the Web Share API with the image file; falls back to a direct download on
 * desktop or when the Share API is unavailable/doesn't support files.
 */

/** Snapshot a card element to a PNG blob (shared by share, download, and clipboard paths). */
async function renderCardBlob(cardEl: HTMLElement): Promise<Blob> {
  // Dynamic import keeps html2canvas out of the main bundle.
  const html2canvas = (await import("html2canvas")).default

  const canvas = await html2canvas(cardEl, {
    // Card is rendered off-screen; bring it into the viewport coordinate space.
    useCORS: true,
    allowTaint: false,
    // html2canvas can't resolve CSS vars, so the card uses inline styles only.
    // Scale 2× for a crisp Retina-quality export without making the canvas huge.
    scale: 2,
    backgroundColor: null, // preserve transparency if any
    logging: false,
  })

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error("canvas.toBlob returned null"))
    }, "image/png")
  })
}

/** Whether this browser can copy a PNG to the clipboard. */
export function canCopyImage(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  )
}

/**
 * #195: copy the card straight to the clipboard as a PNG.
 * Throws when the browser refuses (unsupported, permission denied) — the
 * caller surfaces the failure; silent fallbacks would lie about the copy.
 */
export async function exportToClipboard(cardEl: HTMLElement): Promise<void> {
  if (!canCopyImage()) throw new Error("Clipboard image copy not supported in this browser")
  // Safari requires the ClipboardItem to be constructed with a promise that
  // resolves inside the user-gesture window, so pass the pending blob.
  const item = new ClipboardItem({ "image/png": renderCardBlob(cardEl) })
  await navigator.clipboard.write([item])
}

export async function exportAndShare(
  cardEl: HTMLElement,
  filename = "tiltcheck-stats.png",
): Promise<void> {
  const blob = await renderCardBlob(cardEl)
  const file = new File([blob], filename, { type: "image/png" })

  // ── Mobile: Web Share API ────────────────────────────────────────────────
  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({
      files: [file],
      title: "My TiltCheck stats",
      text: "Check out my decision record on TiltCheck",
    })
    return
  }

  // ── Fallback: native share without file (some mobile browsers) ────────────
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "My TiltCheck stats",
        text: "Check out my decision record on TiltCheck",
      })
      return
    } catch {
      // If share fails for any reason (e.g. user dismissed), fall through to download
    }
  }

  // ── Desktop / fallback: trigger a file download ──────────────────────────
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  // Clean up after browser has had a tick to start the download
  setTimeout(() => {
    URL.revokeObjectURL(url)
    document.body.removeChild(a)
  }, 200)
}
