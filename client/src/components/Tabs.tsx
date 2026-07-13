import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { resolveTabKeyAction } from "../lib/tabs-keyboard.js";

interface TabOption<T extends string> {
  id: T;
  label: string;
}

interface TabsProps<T extends string> {
  tabs: readonly TabOption<T>[];
  active: T;
  onChange: (tab: T) => void;
  ariaLabel: string;
  tabIdPrefix?: string;
  panelIdPrefix?: string;
}

function findTabIndex<T extends string>(
  tabs: readonly TabOption<T>[],
  active: T,
): number {
  const index = tabs.findIndex((tab) => tab.id === active);
  return index >= 0 ? index : 0;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
  tabIdPrefix = "tab",
  panelIdPrefix = "tab-panel",
}: TabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(() =>
    findTabIndex(tabs, active),
  );

  useEffect(() => {
    setFocusedIndex(findTabIndex(tabs, active));
  }, [active, tabs]);

  useEffect(() => {
    tabRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = resolveTabKeyAction(event.key, focusedIndex, tabs.length);
    if (action === null) {
      return;
    }

    event.preventDefault();

    if (action.type === "focus") {
      setFocusedIndex(action.index);
      return;
    }

    const tab = tabs[focusedIndex];
    if (tab !== undefined) {
      onChange(tab.id);
    }
  };

  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === active;
        const isFocused = index === focusedIndex;
        const tabId = `${tabIdPrefix}-${tab.id}`;
        const panelId = `${panelIdPrefix}-${tab.id}`;

        return (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={tabId}
            type="button"
            role="tab"
            className={isActive ? "tabs__tab tabs__tab--active" : "tabs__tab"}
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isFocused ? 0 : -1}
            onClick={() => {
              setFocusedIndex(index);
              onChange(tab.id);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
