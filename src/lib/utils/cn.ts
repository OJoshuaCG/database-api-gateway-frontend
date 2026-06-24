type ClassValue = string | number | false | null | undefined

/** Une clases condicionales filtrando valores falsy. */
export function cn(...classes: ClassValue[]): string {
  return classes.filter((c): c is string | number => Boolean(c)).join(' ')
}
