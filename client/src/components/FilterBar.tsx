interface FilterOption<T extends string> {
  value: T;
  label: string;
}

interface FilterBarProps<T extends string> {
  options: readonly FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  groupName: string;
}

export function FilterBar<T extends string>({
  options,
  value,
  onChange,
  searchValue,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  groupName,
}: FilterBarProps<T>) {
  return (
    <div className="filter-bar">
      <fieldset className="filter-bar__filters">
        <legend className="filter-bar__legend">Filters</legend>
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={
                checked
                  ? "filter-bar__option filter-bar__option--active"
                  : "filter-bar__option"
              }
            >
              <input
                className="filter-bar__radio"
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              <span className="filter-bar__label">{option.label}</span>
            </label>
          );
        })}
      </fieldset>
      <input
        className="filter-bar__search"
        type="search"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
      />
    </div>
  );
}
