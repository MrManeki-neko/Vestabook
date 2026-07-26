// Derives a display title from a book id (the filename minus `.txt`), e.g.
// `moby_dick` -> "Moby Dick", `paradise_lost` -> "Paradise Lost". Pure string
// transform, no I/O — keeps `listBookIds`/`getBookFrames` as the only filesystem access.
export function titleFromId(id: string): string {
  return id
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
