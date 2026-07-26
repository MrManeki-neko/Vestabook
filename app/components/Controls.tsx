"use client";

import type { BookSummary, Mode } from "./types";

interface ControlsProps {
  books: BookSummary[];
  mode: Mode;
  activeBookId: string;
  paused: boolean;
  intervalMinutes: number;
  pending: boolean;
  pendingSlow: boolean;
  onSelectBook: (id: string) => void;
  onShuffle: () => void;
  onCycle: () => void;
  onTogglePause: () => void;
  onSetInterval: (minutes: 5 | 10) => void;
}

export default function Controls({
  books,
  mode,
  activeBookId,
  paused,
  intervalMinutes,
  pending,
  pendingSlow,
  onSelectBook,
  onShuffle,
  onCycle,
  onTogglePause,
  onSetInterval,
}: ControlsProps) {
  const disabled = pending;

  return (
    <div className="controls">
      {pending && (
        <div className={`pending-banner${pendingSlow ? " is-slow" : ""}`} role="status">
          <span className="spinner" aria-hidden="true" />
          <span>
            {pendingSlow
              ? "Still applying — taking longer than usual. It should catch up shortly."
              : "Applying… ~30 s until the board updates."}
          </span>
        </div>
      )}

      <section>
        <p className="control-section-title">Playback</p>
        <div className="btn-row">
          <button
            type="button"
            className={`btn${mode === "cycle" ? " is-active" : ""}`}
            aria-pressed={mode === "cycle"}
            disabled={disabled}
            onClick={onCycle}
          >
            Auto-cycle
          </button>
          <button
            type="button"
            className={`btn${mode === "random" ? " is-active" : ""}`}
            aria-pressed={mode === "random"}
            disabled={disabled}
            onClick={onShuffle}
          >
            Shuffle
          </button>
        </div>
      </section>

      <section>
        <p className="control-section-title">Books</p>
        <div className="book-chips">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              className={`chip${mode === "single" && activeBookId === book.id ? " is-active" : ""}`}
              aria-pressed={mode === "single" && activeBookId === book.id}
              disabled={disabled}
              onClick={() => onSelectBook(book.id)}
            >
              {book.title}
              <span className="chip-sub">{book.frames.toLocaleString()} frames</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <p className="control-section-title">Page turn</p>
        <div className="btn-row">
          <button
            type="button"
            className={`btn${intervalMinutes === 5 ? " is-active" : ""}`}
            aria-pressed={intervalMinutes === 5}
            disabled={disabled}
            onClick={() => onSetInterval(5)}
          >
            5 min
          </button>
          <button
            type="button"
            className={`btn${intervalMinutes === 10 ? " is-active" : ""}`}
            aria-pressed={intervalMinutes === 10}
            disabled={disabled}
            onClick={() => onSetInterval(10)}
          >
            10 min
          </button>
        </div>
      </section>

      <section>
        <p className="control-section-title">Playback state</p>
        <button
          type="button"
          className={`btn btn-pause${paused ? " is-paused" : ""}`}
          aria-pressed={paused}
          disabled={disabled}
          onClick={onTogglePause}
        >
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
      </section>
    </div>
  );
}
