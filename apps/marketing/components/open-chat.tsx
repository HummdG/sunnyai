'use client';

/** Opens the live widget on this page, through its public `window.sunny` handle. */
export function OpenChatButton({
  children = 'Open the chat',
  className = 'button',
}: {
  children?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        (window as unknown as { sunny?: { open?: () => void } }).sunny?.open?.();
      }}
    >
      {children}
    </button>
  );
}
