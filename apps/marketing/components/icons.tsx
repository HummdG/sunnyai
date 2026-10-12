/** A small set of line icons, drawn for this site (24×24, round caps). */

const PATHS: Record<string, string> = {
  chat: 'M4 5h16v10H9l-5 4z',
  check: 'M4 12l5 5L20 6',
  sun: 'M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5S14 15 15 15h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8zM7.5 11h.01M10 7h.01M15 7.5h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9c-4.5-1-8-4-8-9V6z',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  sparkle: 'M12 3l2 6l6 2l-6 2l-2 6l-2-6l-6-2l6-2z',
  people:
    'M9 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M17 11a2.5 2.5 0 1 0 0-5M16 14c3 0 5 2.5 5 6',
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  battery: 'M3 8h15v8H3zM18 11h2v2h-2M6 11h6v2H6',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name] ?? PATHS.sparkle} />
    </svg>
  );
}
