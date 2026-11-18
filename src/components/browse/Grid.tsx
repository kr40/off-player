import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useOnline } from "../../lib/net";

/** Stagger index for an item: rises in with its batch of 20, at most 12 steps of delay. */
export const reveal = (i: number): CSSProperties => ({ ["--i" as string]: Math.min(i % 20, 11) });

/** Calls `onMore` when the end of the grid comes within 1.5 screens. */
export function EndSentinel({ onMore, active }: { onMore: () => void; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onMore);
  cb.current = onMore;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb.current(), { rootMargin: "0px 0px 150% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  return <div ref={ref} className="end-sentinel" aria-hidden />;
}

export function SkeletonCards({ count = 12 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="dskel grid" style={reveal(i)} />
      ))}
    </>
  );
}

/** Quiet strip shown above cached content when TMDB can't be reached. */
export function OfflineStrip({ onRetry, children }: { onRetry?: () => void; children?: ReactNode }) {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-strip" role="status">
      <span>{children ?? "You're offline. Showing what's saved on this PC."}</span>
      {onRetry && <button className="link-btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}

/** One sentence, one action. */
export function EmptyState({ title, text, action, icon }: { title: string; text?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon" aria-hidden>{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
