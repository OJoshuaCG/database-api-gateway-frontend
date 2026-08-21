import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { CodeBlock } from './CodeBlock'

const SQL = "-- comentario\nSELECT id, nombre\nFROM ventas\nWHERE activo = 'S';"

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

/** `navigator` es un getter no escribible en jsdom: hay que redefinir la propiedad. */
function setClipboard(value: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true, writable: true })
}

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
})

describe('CodeBlock', () => {
  it('muestra el SQL completo, sin perder ni una línea', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    const region = screen.getByRole('group', { name: 'SQL: Consulta' })
    expect(region.textContent).toContain('-- comentario')
    expect(region.textContent).toContain("WHERE activo = 'S';")
  })

  it('colorea cada tipo de token con su token del tema', () => {
    const { container } = renderWithProviders(<CodeBlock code={SQL} />)
    // Solo los spans de TOKEN: `.code-line` envuelve la línea entera y en una línea de un solo
    // token su texto coincide, así que buscar sobre todos los `span` encontraba la fila.
    const tokens = Array.from(container.querySelectorAll('.code-text > span'))
    const keyword = tokens.find((span) => span.textContent === 'SELECT')
    const comment = tokens.find((span) => span.textContent?.startsWith('-- comentario'))
    expect(keyword?.className).toContain('text-syntax-keyword')
    expect(comment?.className).toContain('text-syntax-comment')
  })

  it('numera las líneas cuando hay más de una', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    expect(screen.getByText('4 línea(s)')).toBeInTheDocument()
    const region = screen.getByRole('group', { name: 'SQL: Consulta' })
    // El número se pinta con `content: attr(data-line)` para que no se lo lleve la selección al
    // copiar con el ratón; en el DOM solo existe el atributo, que es lo que se comprueba aquí.
    const lines = Array.from(region.querySelectorAll('[data-line]'))
    expect(lines.map((line) => line.getAttribute('data-line'))).toEqual(['1', '2', '3', '4'])
    expect(region.querySelector('.code-lines--numbered')).not.toBeNull()
  })

  it('reparte cada línea del SQL en su propia fila', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    const region = screen.getByRole('group', { name: 'SQL: Consulta' })
    const lines = Array.from(region.querySelectorAll('[data-line]'))
    expect(lines[0]?.textContent).toBe('-- comentario')
    expect(lines[3]?.textContent).toBe("WHERE activo = 'S';")
  })

  it('omite la numeración en un fragmento de una sola línea', () => {
    renderWithProviders(<CodeBlock code="SELECT 1;" title="Uno" />)
    const region = screen.getByRole('group', { name: 'SQL: Uno' })
    expect(region.querySelector('.code-lines--numbered')).toBeNull()
  })

  it('envuelve las líneas por omisión y deja alternar a scroll horizontal', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)

    const toggle = screen.getByRole('button', { name: 'Ajustar líneas' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset.sqlWrap).toBe('on')

    await user.click(toggle)

    // La etiqueta NO cambia: el estado lo lleva `aria-pressed`, para que el lector de pantalla no
    // lo anuncie dos veces y en sentidos opuestos.
    expect(screen.getByRole('button', { name: 'Ajustar líneas' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(document.documentElement.dataset.sqlWrap).toBe('off')
  })

  it('comparte el modo entre el bloque embebido y el visor a pantalla completa', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    await user.click(screen.getByRole('button', { name: 'Ver a pantalla completa' }))

    // Uno por superficie (embebida y modal), los dos en el mismo estado.
    const toggles = screen.getAllByRole('button', { name: 'Ajustar líneas' })
    expect(toggles).toHaveLength(2)

    await user.click(toggles[1]!)
    for (const toggle of screen.getAllByRole('button', { name: 'Ajustar líneas' })) {
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('abre el visor a pantalla completa con el mismo SQL', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver a pantalla completa' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Consulta')).toBeInTheDocument()
    expect(dialog.textContent).toContain('FROM ventas')
  })

  it('dentro del visor a pantalla completa ya no se ofrece expandir de nuevo', async () => {
    const user = userEvent.setup()
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    await user.click(screen.getByRole('button', { name: 'Ver a pantalla completa' }))

    // El botón que queda es el del bloque embebido, que sigue detrás del modal: solo uno.
    expect(screen.getAllByRole('button', { name: 'Ver a pantalla completa' })).toHaveLength(1)
  })

  it('copia el SQL al portapapeles', async () => {
    // `userEvent.setup()` instala su propio stub del portapapeles, así que el nuestro tiene que
    // definirse DESPUÉS para ganarle.
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard({ writeText })

    renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    await user.click(screen.getAllByRole('button', { name: 'Copiar SQL' })[0]!)

    expect(writeText).toHaveBeenCalledWith(SQL)
    expect(await screen.findByText('SQL copiado al portapapeles')).toBeInTheDocument()
  })

  it('avisa en vez de romper si no hay portapapeles disponible', async () => {
    // Sin contexto seguro (HTTP sin TLS) `navigator.clipboard` no existe.
    const user = userEvent.setup()
    setClipboard(undefined)

    renderWithProviders(<CodeBlock code={SQL} />)
    await user.click(screen.getAllByRole('button', { name: 'Copiar SQL' })[0]!)

    expect(await screen.findByText('El portapapeles no está disponible')).toBeInTheDocument()
  })

  it('ofrece tirador de alto solo cuando el bloque da para redimensionarlo', () => {
    const { unmount } = renderWithProviders(<CodeBlock code={SQL} title="Consulta" />)
    expect(screen.getByRole('group', { name: 'SQL: Consulta' }).className).toContain('resize-y')
    unmount()

    renderWithProviders(<CodeBlock code={'SELECT 1;\nSELECT 2;'} title="Corta" />)
    expect(screen.getByRole('group', { name: 'SQL: Corta' }).className).not.toContain('resize-y')
  })

  it('libera el tope de alto al agarrar el tirador, no al pulsar sobre el SQL', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Consulta" maxHeightClass="max-h-40" />)
    const region = screen.getByRole('group', { name: 'SQL: Consulta' })

    // Pulsar sobre el código no debe tocar el alto: el destino es un descendiente, no la región.
    fireEvent.pointerDown(region.querySelector('.code-text')!)
    expect(region.style.maxHeight).toBe('')

    // El tirador nativo forma parte de la caja de la región, así que el destino es ella misma.
    fireEvent.pointerDown(region)
    expect(region.style.maxHeight).toBe('none')
    // Con el tope fuera hace falta un mínimo, o el bloque se podría dejar en nada.
    expect(region.style.minHeight).toBe('104px')
    expect(region.style.height).toBe('104px')
  })

  it('muestra el texto alternativo cuando no hay SQL', () => {
    renderWithProviders(<CodeBlock code="" emptyLabel="Sin rollback." />)
    expect(screen.getByText('Sin rollback.')).toBeInTheDocument()
  })

  it('renderiza las insignias que se le pasan junto al título', () => {
    renderWithProviders(<CodeBlock code={SQL} title="Rollback" extra={<span>confirmado</span>} />)
    expect(screen.getByText('confirmado')).toBeInTheDocument()
  })
})
