import { useEffect, useRef, useState } from "react";
import { IconChevronDown } from "../icons";

/** Netflix-style "Categories" dropdown: a button that opens a multi-column list. */
export default function CategoryMenu({ value, options, onChange, label = "Categories" }: {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open]);

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="catmenu" ref={root}>
      <button className={`catmenu-btn ${value ? "set" : ""}`} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {value ?? label}
        <IconChevronDown />
      </button>
      {value && (
        <button className="catmenu-clear" onClick={() => pick(null)} aria-label="Clear category" title="Show all categories">×</button>
      )}
      {open && (
        <div className="catmenu-panel" role="listbox">
          <button role="option" aria-selected={!value} className={!value ? "on" : ""} onClick={() => pick(null)}>All categories</button>
          {options.map((o) => (
            <button key={o} role="option" aria-selected={o === value} className={o === value ? "on" : ""} onClick={() => pick(o)}>{o}</button>
          ))}
        </div>
      )}
    </div>
  );
}
