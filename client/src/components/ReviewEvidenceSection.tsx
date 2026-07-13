import type { ReactNode } from "react";

export function ReviewEvidenceSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="review-evidence">
      <summary>{`${title} (${count})`}</summary>
      <div className="review-evidence__body">{children}</div>
    </details>
  );
}
