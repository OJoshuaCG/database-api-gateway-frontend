import { useMemo, useState, type ReactNode } from 'react'
import { useCombobox } from 'downshift'
import { cn } from '@/lib/utils'
import { Spinner } from './Spinner'

export interface ComboboxProps<T> {
  items: T[]
  value: T | null
  onChange: (item: T | null) => void
  itemToString: (item: T) => string
  itemToKey: (item: T) => string | number
  renderItem?: (item: T) => ReactNode
  label?: string
  placeholder?: string
  error?: string
  hint?: string
  disabled?: boolean
  isLoading?: boolean
  clearable?: boolean
  required?: boolean
}

/**
 * Select con búsqueda accesible (Downshift `useCombobox`). El filtrado es client-side
 * sobre `items`; Downshift gestiona ARIA, teclado y foco.
 */
export function Combobox<T>({
  items,
  value,
  onChange,
  itemToString,
  itemToKey,
  renderItem,
  label,
  placeholder = 'Selecciona…',
  error,
  hint,
  disabled,
  isLoading,
  clearable,
  required,
}: ComboboxProps<T>) {
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => itemToString(item).toLowerCase().includes(q))
  }, [items, filter, itemToString])

  const {
    isOpen,
    getToggleButtonProps,
    getLabelProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
  } = useCombobox({
    items: filtered,
    selectedItem: value,
    itemToString: (item) => (item ? itemToString(item) : ''),
    onIsOpenChange: ({ isOpen: open }) => {
      if (open) setFilter('')
    },
    onInputValueChange: ({ inputValue, type }) => {
      if (type === useCombobox.stateChangeTypes.InputChange) setFilter(inputValue ?? '')
    },
    onSelectedItemChange: ({ selectedItem }) => onChange(selectedItem ?? null),
  })

  const errorId = 'cb-error'

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label {...getLabelProps()} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-error">*</span>}
        </label>
      )}
      <div className="relative">
        <input
          {...getInputProps({
            disabled,
            placeholder,
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? errorId : undefined,
          })}
          className={cn(
            'h-10 w-full rounded-lg border bg-surface px-3 pr-16 text-sm text-foreground transition-colors',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-error' : 'border-input',
          )}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {isLoading && <Spinner className="h-4 w-4 text-muted-foreground" />}
          {clearable && value && !disabled && (
            <button
              type="button"
              aria-label="Limpiar selección"
              onClick={() => {
                onChange(null)
                setFilter('')
              }}
              className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor">
                <path d="M6 6l8 8M14 6l-8 8" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            type="button"
            aria-label="Abrir lista"
            disabled={disabled}
            {...getToggleButtonProps()}
            className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor">
              <path
                d="M6 8l4 4 4-4"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <ul
          {...getMenuProps()}
          className={cn(
            'absolute left-0 right-0 top-full z-30 mt-1 max-h-60 list-none overflow-auto rounded-lg border border-border bg-surface py-1 shadow-elevated',
            isOpen && filtered.length > 0 ? 'block' : 'hidden',
          )}
        >
          {isOpen &&
            filtered.map((item, index) => (
              <li
                key={itemToKey(item)}
                {...getItemProps({ item, index })}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm text-foreground',
                  highlightedIndex === index && 'bg-surface-muted',
                  value && itemToKey(value) === itemToKey(item) && 'font-semibold',
                )}
              >
                {renderItem ? renderItem(item) : itemToString(item)}
              </li>
            ))}
        </ul>
      </div>
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={errorId} className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  )
}
