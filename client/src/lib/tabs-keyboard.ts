export type TabKeyAction =
  | { type: "focus"; index: number }
  | { type: "activate" };

function wrapIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

export function resolveTabKeyAction(
  key: string,
  currentIndex: number,
  tabCount: number,
): TabKeyAction | null {
  if (tabCount === 0) {
    return null;
  }

  switch (key) {
    case "ArrowRight":
      return { type: "focus", index: wrapIndex(currentIndex + 1, tabCount) };
    case "ArrowLeft":
      return { type: "focus", index: wrapIndex(currentIndex - 1, tabCount) };
    case "Home":
      return { type: "focus", index: 0 };
    case "End":
      return { type: "focus", index: tabCount - 1 };
    case "Enter":
    case " ":
      return { type: "activate" };
    default:
      return null;
  }
}
