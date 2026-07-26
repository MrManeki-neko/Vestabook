import { NextResponse } from "next/server";
import { getCurrentFrame } from "@/lib/sequencer";
import { getState, isPausedNow } from "@/lib/state";
import { getQuietHoursConfig, isQuietNow } from "@/lib/quietHours";
import { listBookIds, getBookFrames } from "@/lib/library";
import { titleFromId } from "@/lib/bookTitle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { bookId, frameIndex, frame } = getCurrentFrame();
  const state = getState();

  const quietCfg = getQuietHoursConfig();
  const quietNow = quietCfg ? isQuietNow(new Date(), quietCfg) : false;

  const books = listBookIds().map((id) => ({
    id,
    title: titleFromId(id),
    frames: getBookFrames(id).length,
  }));

  const totalFrames = getBookFrames(bookId).length;

  return NextResponse.json(
    {
      bookId,
      frameIndex,
      totalFrames,
      frame,
      mode: state.mode.type,
      paused: isPausedNow(),
      quietHours: quietNow,
      intervalMinutes: state.intervalMinutes ?? (Number(process.env.INTERVAL_MINUTES) || 5),
      books,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
