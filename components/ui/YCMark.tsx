/**
 * Y Combinator's square, drawn rather than fetched: it sits next to a line of text at 13 px, where a bitmap would be
 * soft, and it is two shapes. The Y is stroked with square ends and a mitred join, which is what gives it the flat
 * terminals of the real mark rather than the rounded ones a default cap would.
 */
export function YCMark({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden focusable="false">
      <rect width="100" height="100" rx="7" fill="#FF6600" />
      <path d="M28 26 L50 54 L72 26 M50 54 L50 78" stroke="#fff" strokeWidth="10" strokeLinecap="butt" strokeLinejoin="miter" fill="none" />
    </svg>
  );
}
