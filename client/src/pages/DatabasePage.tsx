import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/page-header'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface TableInfo {
  name: string
  rowCount: number
}

interface TableData {
  table: string
  columns: string[]
  rowCount: number
  limit: number
  offset: number
  rows: Array<Record<string, unknown>>
}

const PAGE_SIZE = 100

// Render a cell value: nulls greyed out, objects as JSON, everything else as a
// truncated string.
function renderCell(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">null</span>
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return (
    <span className="block max-w-[200px] truncate" title={text}>
      {text}
    </span>
  )
}

export default function DatabasePage() {
  const [selected, setSelected] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)

  const { data: tablesData } = useQuery<{ tables: TableInfo[] }>({
    queryKey: ['db-tables'],
    queryFn: () => apiFetch('/api/database'),
  })

  const tables = tablesData?.tables ?? []

  // Default to the first table once the list loads.
  useEffect(() => {
    if (!selected && tables.length > 0) setSelected(tables[0].name)
  }, [tables, selected])

  const { data, isLoading } = useQuery<TableData>({
    queryKey: ['db-table', selected, offset],
    queryFn: () => apiFetch(`/api/database/${selected}?limit=${PAGE_SIZE}&offset=${offset}`),
    enabled: !!selected,
  })

  const selectTable = (name: string) => {
    setSelected(name)
    setOffset(0)
  }

  const total = data?.rowCount ?? 0
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div>
      <PageHeader
        title="Database"
        description="Read-only view of the local SQLite database. Secrets (keys, hashes) are masked."
      />

      <div className="flex gap-4 min-h-0">
        {/* Table list — fixed sidebar */}
        <div className="w-48 shrink-0">
          <div className="flex flex-col gap-0.5">
            {tables.map(t => (
              <button
                key={t.name}
                onClick={() => selectTable(t.name)}
                className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-left transition-colors ${
                  selected === t.name
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                <span className="font-mono truncate">{t.name}</span>
                <span className="text-xs tabular-nums opacity-70 shrink-0">{t.rowCount}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Table contents */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="rounded-2xl border bg-card overflow-hidden">
            <div className="overflow-x-auto max-w-full">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
              ) : !data || data.columns.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No data.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.columns.map(col => (
                        <TableHead key={col} className="font-mono text-xs whitespace-nowrap">{col}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={data.columns.length} className="text-center text-muted-foreground py-8">
                          Empty table
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.rows.map((row, i) => (
                        <TableRow key={i}>
                          {data.columns.map(col => (
                            <TableCell key={col} className="text-xs align-top">{renderCell(row[col])}</TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          {/* Pagination */}
          {data && total > 0 && (
            <div className="flex items-center justify-between mt-3 text-sm text-muted-foreground">
              <span className="tabular-nums">{from}–{to} of {total}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={to >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
