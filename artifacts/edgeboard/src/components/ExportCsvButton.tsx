import { useState } from "react"
import { dayOf } from "@workspace/weeks"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

/**
 * Downloads a CSV export via an authenticated fetch (session cookies ride
 * along automatically) and hands it to the browser as a file download.
 */
export function ExportCsvButton({
  fetchCsv,
  filenameStem,
  testId,
}: {
  fetchCsv: () => Promise<string>
  filenameStem: string
  testId: string
}) {
  const [isExporting, setIsExporting] = useState(false)
  const { toast } = useToast()

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const csv = await fetchCsv()
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `edgeboard-${filenameStem}-${dayOf(new Date())}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message ?? "Could not download the CSV. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleExport} disabled={isExporting} data-testid={testId}>
      <Download className="mr-2 h-4 w-4" />
      {isExporting ? "Exporting…" : "Export CSV"}
    </Button>
  )
}
