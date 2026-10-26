let host: HTMLDivElement | null = null;

export function toast(message: string, ms = 2600) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
