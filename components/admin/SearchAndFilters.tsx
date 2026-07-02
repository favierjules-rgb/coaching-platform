"use client";

import { Search } from "lucide-react";

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1">
      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full border border-border bg-background py-3 pl-11 pr-4 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
      />
    </div>
  );
}

export function FilterButtons<T extends string>({
  options,
  active,
  onChange,
}: {
  options: { value: T; label: string }[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
            active === option.value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
