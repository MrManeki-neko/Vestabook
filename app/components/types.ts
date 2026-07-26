export interface BookSummary {
  id: string;
  title: string;
  frames: number;
}

export type Mode = "cycle" | "single" | "random";

export interface StatusResponse {
  bookId: string;
  frameIndex: number;
  totalFrames: number;
  frame: string[];
  mode: Mode;
  paused: boolean;
  quietHours: boolean;
  intervalMinutes: number;
  books: BookSummary[];
}
