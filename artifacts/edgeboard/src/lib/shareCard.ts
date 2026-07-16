/**
 * shareCard — export a DOM node as a PNG and share or download it.
 *
 * Uses html2canvas to snapshot the off-screen card element. On mobile, tries
 * the Web Share API with the image file; falls back to a direct download on
 * desktop or when the Share API is unavailable/doesn't support files.
 */

export async function exportAndShare(
  cardEl: HTMLElement,
  filename = "tiltcheck-stats.png",
): Promise<void> {
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

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b)
      else reject(new Error("canvas.toBlob returned null"))
    }, "image/png")
  })

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
      text: "Check out my betting edge on EdgeBoard",
    })
    return
  }

  // ── Fallback: native share without file (some mobile browsers) ────────────
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "My TiltCheck stats",
        text: "Check out my betting edge on EdgeBoard",
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
