import type { ReactNode } from "react";
import { PRIMARY_NAV, type PrimaryPage } from "../lib/navigation.js";

interface AppHeaderProps {
  active: PrimaryPage;
  onNavigate: (page: PrimaryPage) => void;
  brand?: ReactNode;
  trailing?: ReactNode;
}

export function AppHeader({
  active,
  onNavigate,
  brand,
  trailing,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header__brand-group">
        {brand}
        <nav className="primary-nav" aria-label="Primary">
          {PRIMARY_NAV.map((item) => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                className={
                  isActive
                    ? "primary-nav__link primary-nav__link--active"
                    : "primary-nav__link"
                }
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
      {trailing !== undefined && (
        <div className="app-header__status-group">{trailing}</div>
      )}
    </header>
  );
}
