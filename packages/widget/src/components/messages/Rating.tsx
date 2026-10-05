/**
 * Was this reply helpful? Two small toggle buttons under an assistant reply,
 * shown only when the server records ratings. Pressing the chosen one again
 * takes the rating back. Never interrupts: no prompt, no follow-up question.
 */

const UP = 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7';
const DOWN = 'M17 13V4h3v9h-3Zm0 0-4 7a2 2 0 0 1-2-2v-3H6a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 7.2 4H17';

function Thumb({ path, label, pressed, onClick }: { path: string; label: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" class="mm-rate-btn" aria-label={label} aria-pressed={pressed} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d={path} />
      </svg>
    </button>
  );
}

export function Rating({ value, labels, onRate }: { value: number; labels: [string, string]; onRate: (value: 1 | -1 | 0) => void }) {
  return (
    <div class="mm-rate" role="group" aria-label={`${labels[0]} / ${labels[1]}`}>
      <Thumb path={UP} label={labels[0]} pressed={value === 1} onClick={() => onRate(value === 1 ? 0 : 1)} />
      <Thumb path={DOWN} label={labels[1]} pressed={value === -1} onClick={() => onRate(value === -1 ? 0 : -1)} />
    </div>
  );
}
