"use client";

import { useEffect, useRef, useState } from "react";

const ROWS = 6;
const COLS = 22;

function normalizeLine(line: string | undefined): string {
  const padded = (line ?? "").slice(0, COLS);
  return padded.padEnd(COLS, " ");
}

interface BoardProps {
  frame: string[];
  loading?: boolean;
}

export default function Board({ frame, loading = false }: BoardProps) {
  const lines = Array.from({ length: ROWS }, (_, i) => normalizeLine(frame[i]));
  const prevLinesRef = useRef<string[]>(lines);
  const [flipKeys, setFlipKeys] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const prevLines = prevLinesRef.current;
    const changed = new Map<string, number>();
    const now = Date.now();
    for (let r = 0; r < ROWS; r++) {
      const prevLine = prevLines[r] ?? "";
      const curLine = lines[r];
      for (let c = 0; c < COLS; c++) {
        if (prevLine[c] !== curLine[c]) {
          changed.set(`${r}-${c}`, now);
        }
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (changed.size > 0) {
      setFlipKeys(changed);
      timer = setTimeout(() => setFlipKeys(new Map()), 700);
    }
    prevLinesRef.current = lines;
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.join("\n")]);

  const plainText = lines.map((l) => l.trimEnd()).join("\n");

  return (
    <div className="board-wrap">
      <div
        className={`board${loading ? " is-loading" : ""}`}
        role="img"
        aria-label={loading ? "Board loading" : `Board showing:\n${plainText}`}
      >
        {lines.map((line, r) =>
          Array.from({ length: COLS }, (_, c) => {
            const key = `${r}-${c}`;
            const isFlipping = flipKeys.has(key);
            return (
              <div
                key={key}
                className={`tile${isFlipping ? " is-flipping" : ""}`}
                style={isFlipping ? { animationDelay: `${c * 12}ms` } : undefined}
                aria-hidden="true"
              >
                {line[c] === " " ? " " : line[c]}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
