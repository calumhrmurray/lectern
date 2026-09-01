/** Dropdown / context menus. */

import { h, svgIcon } from './dom';
import { icons, type IconName } from './icons';

export interface MenuItem {
  label?: string;
  icon?: IconName;
  shortcut?: string;
  hint?: string;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  title?: boolean;
  onSelect?: () => void;
}

let openMenu: (() => void) | null = null;

export function closeMenus(): void { openMenu?.(); }

export function showMenu(items: MenuItem[], anchor: HTMLElement | { x: number; y: number }): Promise<void> {
  closeMenus();
  return new Promise<void>((resolve) => {
    const backdrop = h('div', { class: 'lec-menu-backdrop' });
    const menu = h('div', { class: 'lec-menu', role: 'menu' });
    const close = () => {
      const hadFocus = menu.contains(document.activeElement);
      backdrop.remove(); menu.remove();
      document.removeEventListener('keydown', onKey, true);
      openMenu = null;
      // Give focus back to the button that opened the menu (only if the menu had it).
      if (hadFocus && anchor instanceof HTMLElement && anchor.isConnected) anchor.focus({ preventScroll: true });
      resolve();
    };
    const itemsOf = () => Array.from(menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'));
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
        const list = itemsOf();
        if (!list.length) return;
        ev.preventDefault(); ev.stopPropagation();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? list.length - 1
          : ev.key === 'ArrowDown' ? (i + 1) % list.length : (i <= 0 ? list.length - 1 : i - 1);
        list[next].focus();
      } else if (ev.key === 'Tab') { ev.preventDefault(); ev.stopPropagation(); close(); }
    };
    for (const it of items) {
      if (it.separator) { menu.appendChild(h('div', { class: 'lec-menu-sep' })); continue; }
      if (it.title) { menu.appendChild(h('div', { class: 'lec-menu-title' }, it.label)); continue; }
      const btn = h('button', {
        class: 'lec-menu-item', type: 'button', disabled: !!it.disabled, role: 'menuitem',
        onclick: () => { close(); it.onSelect?.(); },
      },
        it.checked !== undefined ? h('span', { class: 'lec-check-mark' }, it.checked ? svgIcon(icons.check) : null) : null,
        it.icon ? svgIcon(icons[it.icon]) : null,
        it.label,
        it.hint ? h('span', { class: 'lec-hint' }, it.hint) : null,
        it.shortcut ? h('span', { class: 'lec-shortcut' }, it.shortcut) : null,
      );
      menu.appendChild(btn);
    }
    backdrop.addEventListener('pointerdown', close);
    backdrop.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
    document.body.append(backdrop, menu);
    document.addEventListener('keydown', onKey, true);
    openMenu = close;

    // Position
    let x: number, y: number;
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      x = r.left; y = r.bottom + 4;
    } else { x = anchor.x; y = anchor.y; }
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    if (x + mw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - mw - 8);
    if (y + mh > window.innerHeight - 8) y = Math.max(8, (anchor instanceof HTMLElement ? anchor.getBoundingClientRect().top - mh - 4 : window.innerHeight - mh - 8));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    (menu.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus();
  });
}
