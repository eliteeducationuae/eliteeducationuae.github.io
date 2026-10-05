/**
 * A hidden "website" field that people never see but form-filling bots often complete.
 * Native apps are not targeted by such bots, so nothing is rendered here; see honeypot.web.tsx.
 */
export function Honeypot(_props: { value: string; onChange: (v: string) => void }) {
  return null;
}
