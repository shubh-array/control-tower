import { PRIMARY_NAV, type PrimaryPage } from "../lib/navigation.js";

interface AppHeaderProps {
  active: PrimaryPage;
  onNavigate: (page: PrimaryPage) => void;
}

export function AppHeader({ active, onNavigate }: AppHeaderProps) {
  return (
    <header className="app-header">
      <nav className="primary-nav" aria-label="Primary">
        {PRIMARY_NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              className={isActive ? "primary-nav__link primary-nav__link--active" : "primary-nav__link"}
              aria-current={isActive ? "page" : undefined}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
