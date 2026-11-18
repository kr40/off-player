// Keyboard use of poster rows and grids: arrow keys move focus between cards
// (left/right along a row, up/down between rows of a grid), Enter opens,
// W toggles Watched and L toggles Watchlist on the focused card.

// `.tcard-art` is the focusable part of a landscape title card (its root is a div).
const CARD = ".pcard, .tcard-art, .ecard, .scard, .coll-tile, .tl-tile";

function cardsIn(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(CARD)].filter((c) => c.offsetParent !== null);
}

function containerOf(el: HTMLElement): Element | null {
  return el.closest(".row-track, .pgrid, .coll-grid, .tl-grid, .partof-row");
}

function move(from: HTMLElement, dir: "left" | "right" | "up" | "down"): HTMLElement | null {
  const box = containerOf(from);
  if (!box) return null;
  const cards = cardsIn(box);
  const i = cards.indexOf(from);
  if (dir === "left") return cards[i - 1] ?? null;
  if (dir === "right") return cards[i + 1] ?? null;
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  // Up/down: in a grid, the card in the next visual row closest horizontally;
  // in a row, the nearest card of the row above or below.
  let pool: HTMLElement[];
  if (box.classList.contains("row-track") || box.classList.contains("partof-row")) {
    const rows = [...document.querySelectorAll(".page-host[style*=block] .row-track")].filter((t) => (t as HTMLElement).offsetParent);
    const at = rows.indexOf(box);
    const target = rows[dir === "down" ? at + 1 : at - 1];
    if (!target) return null;
    pool = cardsIn(target).filter((c) => {
      const b = c.getBoundingClientRect();
      return b.right > 0 && b.left < innerWidth;
    });
  } else {
    pool = cards.filter((c) => {
      const b = c.getBoundingClientRect();
      return dir === "down" ? b.top > r.top + r.height / 2 : b.bottom < r.top + r.height / 2;
    });
    const rowTop = dir === "down" ? Math.min(...pool.map((c) => c.getBoundingClientRect().top)) : Math.max(...pool.map((c) => c.getBoundingClientRect().top));
    pool = pool.filter((c) => Math.abs(c.getBoundingClientRect().top - rowTop) < 4);
  }
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const c of pool) {
    const b = c.getBoundingClientRect();
    const d = Math.abs(b.left + b.width / 2 - cx);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function installCardKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const el = document.activeElement as HTMLElement | null;
    if (!el || !el.matches(CARD)) return;
    const dirs: Record<string, "left" | "right" | "up" | "down"> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (dirs[e.key]) {
      const to = move(el, dirs[e.key]);
      if (to) {
        e.preventDefault();
        to.focus({ preventScroll: true });
        to.scrollIntoView({ block: "nearest", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      return;
    }
    const card = el.closest("[data-card]");
    if (!card) return;
    const act = e.key === "w" || e.key === "W" ? "watched" : e.key === "l" || e.key === "L" ? "watchlist" : null;
    if (act) {
      const b = card.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
      if (b) {
        e.preventDefault();
        b.click();
      }
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
