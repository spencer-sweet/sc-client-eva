/** Show a fatal message in the Dev UI's #err panel (console fallback when absent). */
export function bail(message: string): void {
  const el = document.getElementById('err');
  if (!el) {
    console.error(message);
    return;
  }
  el.style.display = 'grid';
  if (el.firstElementChild) el.firstElementChild.innerHTML = message;
  else el.innerHTML = '<div>' + message + '</div>';
}
