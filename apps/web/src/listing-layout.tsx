import { useState, type ReactNode } from 'react';

export type ListingLayout = 'details' | 'list' | 'tiles';

const STORAGE_KEY = 'marketscope-listing-layout';

function storedLayout(): ListingLayout {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'list' || stored === 'tiles' ? stored : 'details';
}

export function useListingLayout(): readonly [
  ListingLayout,
  (layout: ListingLayout) => void,
] {
  const [layout, setLayout] = useState<ListingLayout>(storedLayout);
  const update = (next: ListingLayout): void => {
    window.localStorage.setItem(STORAGE_KEY, next);
    setLayout(next);
  };
  return [layout, update] as const;
}

export function ListingLayoutToggle({
  layout,
  onChange,
}: {
  layout: ListingLayout;
  onChange: (layout: ListingLayout) => void;
}): ReactNode {
  return (
    <div
      className="listing-layout-toggle"
      role="group"
      aria-label="Listing view"
    >
      <button
        type="button"
        aria-pressed={layout === 'details'}
        onClick={() => onChange('details')}
      >
        Details
      </button>
      <button
        type="button"
        aria-pressed={layout === 'list'}
        onClick={() => onChange('list')}
      >
        List
      </button>
      <button
        type="button"
        aria-pressed={layout === 'tiles'}
        onClick={() => onChange('tiles')}
      >
        Tiles
      </button>
    </div>
  );
}
