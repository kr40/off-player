// One toast at a time at the bottom of the window, optionally with Undo.
import { useEffect, useSyncExternalStore } from "react";

type ToastMsg = { id: number; text: string; undo?: () => void | Promise<void> };

let current: ToastMsg | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function showToast(text: string, undo?: ToastMsg["undo"]) {
  current = { id: ++seq, text, undo };
  emit();
}
const dismiss = (id: number) => {
  if (current?.id === id) {
    current = null;
    emit();
  }
};

export default function Toaster() {
  const t = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => current,
  );
  useEffect(() => {
    if (!t) return;
    const timer = window.setTimeout(() => dismiss(t.id), 5000);
    return () => window.clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (
    <div className="toast" role="status" key={t.id}>
      <span>{t.text}</span>
      {t.undo && (
        <button
          onClick={async () => {
            dismiss(t.id);
            await t.undo!();
          }}
        >
          Undo
        </button>
      )}
      <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">×</button>
    </div>
  );
}
