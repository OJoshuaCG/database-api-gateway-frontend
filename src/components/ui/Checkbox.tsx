import { forwardRef, useId, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  hint?: string
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, id, className, ...props },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const hintId = `${fieldId}-hint`

  return (
    <div className="flex items-start gap-2.5">
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary accent-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          className,
        )}
        {...props}
      />
      <div className="flex flex-col">
        <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
})
