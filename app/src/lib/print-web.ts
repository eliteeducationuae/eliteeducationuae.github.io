/**
 * Prints a branded HTML document in the browser.
 *
 * expo-print's web printAsync ignores its `html` option and prints the whole app window, so documents are
 * written into a hidden iframe and printed from there; the browser's print dialog offers "Save as PDF".
 */
export function printHtmlOnWeb(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('data-elite-print', '');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    // Remove the previous document's frame, if any, so only the latest one is kept.
    document.querySelectorAll('iframe[data-elite-print]').forEach((old) => old.remove());
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return resolve();
      // Give the embedded logo a moment to decode before the print preview is built.
      setTimeout(() => {
        win.focus();
        win.print();
        resolve();
      }, 150);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
