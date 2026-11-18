import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconChevronLeft, IconChevronRight } from "../icons";

/** A titled horizontal row of cards with paging arrows. `variant` sets card sizing. */
export default function Row({ title, variant = "landscape", more, children }: {
  title: string;
  variant?: "landscape" | "poster";
  more?: { label?: string; onClick: () => void }; // "See all" link in the header
  children: ReactNode;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (track.current) ro.observe(track.current);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: "smooth" });
  };

  return (
    <section className={`row row-${variant}`}>
      <h2 className="row-title">
        {title}
        {more && <button className="row-more" onClick={more.onClick}>{more.label ?? "See all"}<IconChevronRight /></button>}
      </h2>
      <div className="row-viewport">
        {!edges.start && (
          <button className="row-arrow left" onClick={() => page(-1)} aria-label={`Scroll ${title} left`}>
            <IconChevronLeft />
          </button>
        )}
        <div className="row-track" ref={track} onScroll={measure}>
          {children}
        </div>
        {!edges.end && (
          <button className="row-arrow right" onClick={() => page(1)} aria-label={`Scroll ${title} right`}>
            <IconChevronRight />
          </button>
        )}
      </div>
    </section>
  );
}
