import Modal from "./Modal";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      ["/", "Search"],
      ["Esc or Backspace", "Back"],
      ["g then h", "Home"],
      ["g then l", "Library"],
      ["g then d", "Discover"],
      ["g then m", "My List"],
      ["g then s", "Settings"],
      ["?", "This list"],
    ],
  },
  {
    title: "Rows and grids",
    keys: [
      ["Tab", "Move between controls"],
      ["← → ↑ ↓", "Move between posters"],
      ["Enter", "Open"],
      ["W", "Mark as watched"],
      ["L", "Add to or remove from watchlist"],
    ],
  },
  {
    title: "Player",
    keys: [
      ["Space or K", "Play / pause"],
      ["← →", "Back / forward 10 s"],
      ["↑ ↓", "Volume"],
      ["F", "Full screen"],
      ["S", "Skip intro"],
      ["N", "Next episode"],
      ["P", "Previous episode"],
      ["E", "Episodes"],
      ["C", "Subtitles"],
      ["A", "Audio track"],
      ["[ ]", "Slower / faster"],
      ["M", "Mute"],
    ],
  },
];

export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} wide>
      <div className="keys-help">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.keys.map(([k, what]) => (
                <div key={k}>
                  <dt>{k.split(" ").map((p, i) => (["then", "or"].includes(p) ? <span key={i} className="kbd-sep"> {p} </span> : <kbd key={i}>{p}</kbd>))}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
