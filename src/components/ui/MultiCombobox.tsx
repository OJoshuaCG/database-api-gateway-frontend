import { useMemo, useState, type ReactNode } from 'react'
import { useCombobox, useMultipleSelection } from 'downshift'
import { cn } from '@/lib/utils'

export interface MultiComboboxProps<T> {
  items: T[]
  selectedItems: T[]
  onChange: (items: T[]) => void
  itemToString: (item: T) => string
  itemToKey: (item: T) => string | number
  renderItem?: (item: T) => ReactNode
  label?: string
  placeholder?: string
  disabled?: boolean
}

/** Multiselect con búsqueda accesible (Downshift `useMultipleSelection` + `useCombobox`). */
export function MultiCombobox<T>({
  items,
  selectedItems,
  onChange,
  itemToString,
  itemToKey,
  renderItem,
  label,
  placeholder = 'Añadir…',
  disabled,
}: MultiComboboxProps<T>) {
  const [filter, setFilter] = useState('')

  const { getSelectedItemProps, getDropdownProps, addSelectedItem, removeSelectedItem } =
    useMultipleSelection<T>({
      selectedItems,
      onStateChange: ({ selectedItems: sel, type }) => {
        switch (type) {
          case useMultipleSelection.stateChangeTypes.SelectedItemKeyDownBackspace:
          case useMultipleSelection.stateChangeTypes.SelectedItemKeyDownDelete:
          case useMultipleSelection.stateChangeTypes.DropdownKeyDownBackspace:
          case useMultipleSelection.stateChangeTypes.FunctionRemoveSelectedItem:
            onChange(sel ?? [])
            break
          default:
            break
        }
      },
    })

  const selectedKeys = new Set(selectedItems.map(itemToKey))
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return items.filter(
      (item) => !selectedKeys.has(itemToKey(item)) && itemToString(item).toLowerCase().includes(q),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter, selectedItems])

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
    selectedItem: null,
    inputValue: filter,
    itemToString: (item) => (item ? itemToString(item) : ''),
    stateReducer: (state, { changes, type }) => {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          return { ...changes, isOpen: true, highlightedIndex: state.highlightedIndex }
        default:
          return changes
      }
    },
    onStateChange: ({ type, selectedItem, inputValue }) => {
      switch (type) {
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
        case useCombobox.stateChangeTypes.ItemClick:
          if (selectedItem) {
            onChange([...selectedItems, selectedItem])
            addSelectedItem(selectedItem)
            setFilter('')
          }
          break
        case useCombobox.stateChangeTypes.InputChange:
          setFilter(inputValue ?? '')
          break
        default:
          break
      }
    },
  })

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label {...getLabelProps()} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <div className="relative">
        <div
          className={cn(
            'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-surface px-2 py-1.5',
            'focus-within:ring-2 focus-within:ring-ring',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {selectedItems.map((item, index) => (
            <span
              key={itemToKey(item)}
              {...getSelectedItemProps({ selectedItem: item, index })}
              className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground"
            >
              {itemToString(item)}
              <button
                type="button"
                aria-label={`Quitar ${itemToString(item)}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onChange(selectedItems.filter((s) => itemToKey(s) !== itemToKey(item)))
                  removeSelectedItem(item)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor">
                  <path d="M6 6l8 8M14 6l-8 8" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
          <input
            {...getInputProps(getDropdownProps({ preventKeyAction: isOpen, disabled }))}
            placeholder={selectedItems.length === 0 ? placeholder : ''}
            className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          />
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
                )}
              >
                {renderItem ? renderItem(item) : itemToString(item)}
              </li>
            ))}
        </ul>
      </div>
    </div>
  )
}
