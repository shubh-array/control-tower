import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  status?: ReactNode;
}

export function PageHeader({ title, subtitle, meta, status }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        <h1 className="page-heading">{title}</h1>
        {subtitle !== undefined && (
          <p className="page-header__subtitle">{subtitle}</p>
        )}
      </div>
      {status !== undefined && (
        <div className="page-header__status">{status}</div>
      )}
      {meta !== undefined && <div className="page-header__meta">{meta}</div>}
    </header>
  );
}
