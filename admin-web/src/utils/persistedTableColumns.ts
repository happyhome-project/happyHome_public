import { ref, type Ref } from 'vue'

type ColumnWidthMap<K extends string> = Record<K, number>

interface PersistedTableColumnsOptions<K extends string> {
  storageKey: string
  defaults: ColumnWidthMap<K>
  minimums?: Partial<ColumnWidthMap<K>>
}

function cloneWidths<K extends string>(value: ColumnWidthMap<K>): ColumnWidthMap<K> {
  return { ...value }
}

function hasColumnKey<K extends string>(defaults: ColumnWidthMap<K>, key: unknown): key is K {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(defaults, key)
}

function normalizeWidths<K extends string>(
  value: unknown,
  defaults: ColumnWidthMap<K>,
  minimums: Partial<ColumnWidthMap<K>>,
): ColumnWidthMap<K> {
  const result = cloneWidths(defaults)
  if (!value || typeof value !== 'object') return result

  for (const key of Object.keys(defaults) as K[]) {
    const rawWidth = Number((value as Record<string, unknown>)[key])
    if (Number.isFinite(rawWidth)) {
      result[key] = Math.max(minimums[key] ?? defaults[key], Math.round(rawWidth))
    }
  }
  return result
}

function loadWidths<K extends string>(
  storageKey: string,
  defaults: ColumnWidthMap<K>,
  minimums: Partial<ColumnWidthMap<K>>,
): ColumnWidthMap<K> {
  if (typeof window === 'undefined') return cloneWidths(defaults)
  try {
    return normalizeWidths(JSON.parse(window.localStorage.getItem(storageKey) || '{}'), defaults, minimums)
  } catch {
    return cloneWidths(defaults)
  }
}

export function usePersistedTableColumns<K extends string>(
  options: PersistedTableColumnsOptions<K>,
): {
  columnWidths: Ref<ColumnWidthMap<K>>
  handleColumnDragEnd: (newWidth: number, oldWidth: number, column: any) => void
} {
  const minimums = (options.minimums || {}) as Partial<ColumnWidthMap<K>>
  const columnWidths = ref<ColumnWidthMap<K>>(
    loadWidths(options.storageKey, options.defaults, minimums)
  ) as Ref<ColumnWidthMap<K>>

  function saveWidths(widths: ColumnWidthMap<K>) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(options.storageKey, JSON.stringify(widths))
  }

  function handleColumnDragEnd(newWidth: number, _oldWidth: number, column: any) {
    const key = column?.columnKey || column?.property
    if (!hasColumnKey(options.defaults, key) || !Number.isFinite(Number(newWidth))) return
    const next = {
      ...columnWidths.value,
      [key]: Math.max(minimums[key] ?? options.defaults[key], Math.round(Number(newWidth))),
    }
    columnWidths.value = next
    saveWidths(next)
  }

  return { columnWidths, handleColumnDragEnd }
}
