/** Native-style HTML5 video play triangle (shared by theatre + audiovisual). */
export default function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M8 5.14v13.72L19 12 8 5.14z" fill="currentColor" />
    </svg>
  );
}

export function PauseGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 6h3v12H7V6zm7 0h3v12h-3V6z" fill="currentColor" />
    </svg>
  );
}
