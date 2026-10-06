/**
 * A hidden "website" field that people never see but form-filling bots often complete.
 * It is moved off-screen rather than hidden with display: none, so that bots still find it.
 */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      name="website"
      autoComplete="off"
      tabIndex={-1}
      aria-hidden="true"
      data-testid="honeypot"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ position: 'absolute', left: -10000, top: 'auto', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
    />
  );
}
