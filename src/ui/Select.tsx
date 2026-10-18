import { useEffect, useId, useMemo, useRef, useState } from "react"

export type Option<T> = { value: T; label: string }

/**
 * A listbox popover in place of the native <select>, which can't be styled consistently and lists
 * 700+ districts with no way to search. Long lists get a filter box. Keyboard: arrows, Home/End,
 * Enter to pick, Escape to close.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  labelledBy,
  placeholder = "Choose…",
  disabled = false,
  className = "",
  id,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  /** Shown above the value inside the control (filter-bar style). */
  label?: string | undefined
  /** Id of an external <label>/<span>, for form fields. */
  labelledBy?: string | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
  className?: string | undefined
  id?: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const searchable = options.length > 12

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    // Prefix matches first ("ma" → Maharashtra before Himachal Pradesh), then the rest.
    const hits = options.filter((o) => o.label.toLowerCase().includes(q))
    return [...hits.filter((o) => o.label.toLowerCase().startsWith(q)), ...hits.filter((o) => !o.label.toLowerCase().startsWith(q))]
  }, [options, query])
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [open, options, value])

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [open, active])

  const pick = (o: Option<T> | undefined) => {
    if (o) onChange(o.value)
    setOpen(false)
    button.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    const last = shown.length - 1
    if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1))
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1))
    else if (e.key === "Home") setActive(0)
    else if (e.key === "End") setActive(last)
    else if (e.key === "Enter") pick(shown[active])
    else if (e.key === "Escape") {
      setOpen(false)
      button.current?.focus()
    } else if (e.key === "Tab") setOpen(false)
    else return
    e.preventDefault()
  }

  return (
    <div ref={root} className={`select${open ? " open" : ""} ${className}`} onKeyDown={onKey}>
      <button
        ref={button}
        id={id}
        type="button"
        className="select-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelledBy ? `${labelledBy} ${id ?? ""}`.trim() : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {label && <span className="select-k">{label}</span>}
        <span className={`select-v${current ? "" : " placeholder"}`}>{current?.label ?? placeholder}</span>
        <svg className="select-chev" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="select-pop">
          {searchable && (
            <input
              className="select-search"
              autoFocus
              value={query}
              placeholder="Search…"
              aria-label="Filter options"
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
            />
          )}
          <ul ref={list} id={listId} role="listbox" tabIndex={-1} aria-label={label}>
            {shown.length === 0 && <li className="select-none">No matches</li>}
            {shown.map((o, i) => (
              <li
                key={String(o.value)}
                data-i={i}
                role="option"
                aria-selected={o.value === value}
                className={i === active ? "active" : undefined}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.label}
                {o.value === value && (
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
