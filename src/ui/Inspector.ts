/** The inspector: Format (selected element), Slide and Deck tabs. */

import type { App } from '../app/App';
import { isStack, isTextEditable } from '../deck/html';
import { t, type MessageKey } from '../i18n';
import { h, svgIcon, toHex, fmtNum } from './dom';
import { icons, type IconName } from './icons';

type Tab = 'format' | 'slide' | 'deck';
const TABS: Tab[] = ['format', 'slide', 'deck'];

const FRAGMENT_EFFECTS = ['fade-in', 'fade-out', 'fade-up', 'fade-down', 'fade-left', 'fade-right', 'fade-in-then-out', 'fade-in-then-semi-out', 'grow', 'shrink', 'strike', 'highlight-red', 'highlight-green', 'highlight-blue', 'highlight-current-red', 'highlight-current-green', 'highlight-current-blue', 'semi-fade-out', 'current-visible'];
const TRANSITIONS = ['', 'none', 'fade', 'slide', 'convex', 'concave', 'zoom'];
const SHADOWS: Record<string, string> = { none: '', soft: '0 4px 14px rgba(0,0,0,.15)', medium: '0 8px 26px rgba(0,0,0,.22)', strong: '0 14px 40px rgba(0,0,0,.35)' };

// Visible labels for the shadow presets; the option values stay the same.
const SHADOW_LABELS: Record<string, MessageKey> = { none: 'inspector.none', soft: 'inspector.shadowSoft', medium: 'inspector.shadowMedium', strong: 'inspector.shadowStrong', custom: 'inspector.shadowCustom' };
// Words interpolated into the "Align …" tooltips on the Arrange buttons.
const ALIGN_LABELS: Record<string, MessageKey> = { left: 'inspector.dirLeft', center: 'inspector.dirCenter', right: 'inspector.dirRight', top: 'inspector.dirTop', middle: 'inspector.dirMiddle', bottom: 'inspector.dirBottom' };

export class Inspector {
  tab: Tab = 'format';
  private body: HTMLElement;
  private tabsEl: HTMLElement;
  private geometryInputs: Partial<Record<'x' | 'y' | 'w' | 'h' | 'r', HTMLInputElement>> = {};

  constructor(readonly app: App, readonly container: HTMLElement) {
    this.tabsEl = h('div', { class: 'lec-tabs', role: 'tablist', 'aria-label': t('inspector.ariaLabel') });
    this.body = h('div', { class: 'lec-insp-body', role: 'tabpanel', id: 'lec-insp-panel' });
    container.append(this.tabsEl, this.body);
    // Left/Right arrows move between tabs (roving focus: only the active tab is in the Tab order).
    this.tabsEl.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'Home' && ev.key !== 'End') return;
      ev.preventDefault(); ev.stopPropagation();
      const i = TABS.indexOf(this.tab);
      this.tab = TABS[ev.key === 'Home' ? 0 : ev.key === 'End' ? TABS.length - 1 : (i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      this.render();
      this.tabsEl.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    });
    this.renderTabs();
  }

  private renderTabs(): void {
    this.tabsEl.replaceChildren(
      ...TABS.map((tab) =>
        h('button', {
          class: `lec-tab${this.tab === tab ? ' lec-active' : ''}`, type: 'button', role: 'tab', id: `lec-insp-tab-${tab}`, 'aria-controls': 'lec-insp-panel',
          'aria-selected': String(this.tab === tab), tabindex: this.tab === tab ? 0 : -1, onclick: () => { this.tab = tab; this.render(); },
        }, tab === 'format' ? t('inspector.tab.format') : tab === 'slide' ? t('inspector.tab.slide') : t('inspector.tab.deck'))),
    );
    this.body.setAttribute('aria-labelledby', `lec-insp-tab-${this.tab}`);
  }

  /** Cheap update of geometry fields while dragging. */
  updateGeometry(): void {
    const ed = this.app.editor;
    const el = ed.primary;
    if (!el || this.tab !== 'format') return;
    const r = ed.rectOfSrc(el);
    const set = (k: 'x' | 'y' | 'w' | 'h' | 'r', v: number) => {
      const input = this.geometryInputs[k];
      if (input && document.activeElement !== input) input.value = fmtNum(v);
    };
    set('x', r.x); set('y', r.y); set('w', r.w); set('h', r.h); set('r', ed.rotationOf(el));
  }

  render(): void {
    this.renderTabs();
    this.geometryInputs = {};
    const ed = this.app.editor;
    this.body.replaceChildren();
    if (!ed.ready || !ed.doc.length) {
      this.body.appendChild(h('div', { class: 'lec-insp-empty' }, ed.ready ? t('inspector.emptyAddSlide') : t('inspector.emptyOpenDeck')));
      return;
    }
    if (this.tab === 'format') this.renderFormat();
    else if (this.tab === 'slide') this.renderSlide();
    else this.renderDeck();
  }

  // ---------------------------------------------------------------- Format tab

  private renderFormat(): void {
    const ed = this.app.editor;
    const el = ed.primary;
    if (!el) {
      this.body.appendChild(h('div', { class: 'lec-insp-empty' },
        t('inspector.formatEmpty'), h('br'), h('br'),
        t('inspector.formatEmptyHint')));
      return;
    }
    const live = ed.stage.liveOf(el) as HTMLElement | null;
    if (!live) return;
    const cs = ed.stage.computed(live);
    const multi = ed.selection().length > 1;
    const tag = el.tagName.toLowerCase();

    // Identity + breadcrumb
    const crumbs = h('div', { class: 'lec-crumbs' });
    const chain = [...ed.ancestorsOf(el), el];
    crumbs.appendChild(h('span', { 'data-i18n': 'inspector.crumbRoot' }, t('inspector.crumbRoot')));
    for (const a of chain) {
      crumbs.appendChild(h('span', {}, '›'));
      crumbs.appendChild(h('button', { class: `lec-crumb${a === el ? ' lec-active' : ''}`, type: 'button', title: t('inspector.select'), onclick: () => ed.select([a]) }, describe(a)));
    }
    this.sectionRaw(multi ? t('inspector.nObjects', { n: ed.selection().length }) : describe(el), null, crumbs);

    // Geometry
    const r = ed.rectOfSrc(el);
    const free = ed.isFree(el);
    const num = (k: 'x' | 'y' | 'w' | 'h' | 'r', v: number, on: (n: number) => void, step = 1) => {
      const input = h('input', { class: 'lec-field lec-num', type: 'number', step: String(step), value: fmtNum(v) }) as HTMLInputElement;
      input.addEventListener('change', () => { const n = parseFloat(input.value); if (isFinite(n)) on(n); });
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { input.blur(); } ev.stopPropagation(); });
      this.geometryInputs[k] = input;
      return input;
    };
    this.section('inspector.positionAndSize', null,
      h('div', { class: 'lec-row' },
        h('span', { class: 'lec-mini-label' }, t('inspector.x')), num('x', r.x, (n) => ed.setGeometry({ x: n })),
        h('span', { class: 'lec-mini-label' }, t('inspector.y')), num('y', r.y, (n) => ed.setGeometry({ y: n })),
      ),
      h('div', { class: 'lec-row' },
        h('span', { class: 'lec-mini-label' }, t('inspector.w')), num('w', r.w, (n) => ed.setGeometry({ w: n })),
        h('span', { class: 'lec-mini-label' }, t('inspector.h')), num('h', r.h, (n) => ed.setGeometry({ h: n })),
      ),
      h('div', { class: 'lec-row' },
        h('label', {}, t('inspector.rotate')), num('r', ed.rotationOf(el), (n) => ed.edit('Rotate', () => ed.setRotation(el, n), { top: ed.current.top })), h('span', { class: 'lec-unit' }, '°'),
        h('span', { class: 'lec-fill' }),
      ),
      h('div', { class: 'lec-row' },
        h('label', {}, t('inspector.layout')),
        segmented([
          { value: 'flow', label: t('inspector.layoutInFlow'), icon: 'flow', title: t('inspector.layoutInFlowTitle') },
          { value: 'free', label: t('inspector.layoutFree'), icon: 'free', title: t('inspector.layoutFreeTitle') },
        ], free ? 'free' : 'flow', (v) => { for (const s of ed.selection()) ed.setFree(s, v === 'free'); }),
      ),
    );

    // Text
    if (isTextEditable(el)) {
      const fontFamilies = ['', ...this.app.fonts];
      const currentFamily = cs.fontFamily;
      const familySel = h('select', { class: 'lec-field' },
        h('option', { value: '' }, t('inspector.themeDefault')),
        ...fontFamilies.filter(Boolean).map((f) => h('option', { value: f, selected: normalizeFont(f) === normalizeFont(currentFamily) }, f.split(',')[0].replace(/["']/g, ''))),
        h('option', { value: 'serif' }, t('inspector.serif')), h('option', { value: 'sans-serif' }, t('inspector.sansSerif')), h('option', { value: 'monospace' }, t('inspector.monospace')),
      ) as HTMLSelectElement;
      if (!(el as HTMLElement).style.fontFamily) familySel.value = '';
      familySel.addEventListener('change', () => ed.setStyles({ 'font-family': familySel.value || null }, 'Font'));

      const weightSel = h('select', { class: 'lec-field' },
        ...['', '300', '400', '500', '600', '700', '800'].map((w) => h('option', { value: w, selected: w === ((el as HTMLElement).style.fontWeight || '') }, w === '' ? t('inspector.weightDefault') : w === '400' ? t('inspector.weightRegular') : w === '700' ? t('inspector.weightBold') : w)),
      ) as HTMLSelectElement;
      weightSel.addEventListener('change', () => ed.setStyles({ 'font-weight': weightSel.value || null }, 'Weight'));

      const sizeInput = numberField(parseFloat(cs.fontSize), (n) => ed.setStyles({ 'font-size': `${n}px` }, 'Font size', 'font-size'), 1);
      const lhInput = numberField(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) || 1.4, (n) => ed.setStyles({ 'line-height': String(n) }, 'Line height', 'line-height'), 0.05);
      const italic = cs.fontStyle === 'italic';

      this.section('inspector.text', null,
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.font')), familySel),
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.size')), sizeInput, h('span', { class: 'lec-unit' }, 'px'), h('span', { class: 'lec-fill' }, weightSel)),
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.style')),
          segmented([
            { value: 'italic', label: '', icon: 'italic', title: t('inspector.italic') },
            { value: 'underline', label: '', icon: 'underline', title: t('inspector.underline') },
          ], [italic ? 'italic' : '', cs.textDecorationLine.includes('underline') ? 'underline' : ''], (v) => {
            if (v === 'italic') ed.setStyles({ 'font-style': italic ? null : 'italic' }, 'Italic');
            else ed.setStyles({ 'text-decoration': cs.textDecorationLine.includes('underline') ? null : 'underline' }, 'Underline');
          }, true),
          h('span', { style: 'width:6px' }),
          segmented([
            { value: 'left', label: '', icon: 'alignLeft', title: t('inspector.textAlignLeft') },
            { value: 'center', label: '', icon: 'alignCenter', title: t('inspector.textAlignCentre') },
            { value: 'right', label: '', icon: 'alignRight', title: t('inspector.textAlignRight') },
            { value: 'justify', label: '', icon: 'alignJustify', title: t('inspector.textAlignJustify') },
          ], cs.textAlign === 'start' ? 'left' : cs.textAlign, (v) => ed.setStyles({ 'text-align': v }, 'Align text')),
        ),
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.colour')), colorField(cs.color, (v) => ed.setStyles({ color: v }, 'Text colour', 'color'), true)),
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.lineHeight')), lhInput, h('span', { class: 'lec-fill' })),
      );
    }

    // Fill & border
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const shadowKey = Object.entries(SHADOWS).find(([, v]) => v === (el as HTMLElement).style.boxShadow)?.[0] ?? ((el as HTMLElement).style.boxShadow ? 'custom' : 'none');
    this.section('inspector.fillBorder', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.fill')), colorField(cs.backgroundColor, (v) => ed.setStyles({ 'background-color': v }, 'Fill', 'background-color'), true)),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.opacity')), numberField(Math.round(parseFloat(cs.opacity) * 100), (n) => ed.setStyles({ opacity: n >= 100 ? null : String(n / 100) }, 'Opacity', 'opacity'), 5, 0, 100), h('span', { class: 'lec-unit' }, '%'), h('span', { class: 'lec-fill' })),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.border')),
        numberField(bw, (n) => ed.setStyles({ 'border-width': n ? `${n}px` : null, 'border-style': n ? 'solid' : null }, 'Border', 'border'), 1, 0),
        h('span', { class: 'lec-unit' }, 'px'),
        colorField(bw ? cs.borderTopColor : null, (v) => ed.setStyles({ 'border-color': v, 'border-style': v ? 'solid' : null, 'border-width': v && !bw ? '2px' : null }, 'Border colour', 'border-color'), true),
      ),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.radius')), numberField(parseFloat(cs.borderTopLeftRadius) || 0, (n) => ed.setStyles({ 'border-radius': n ? `${n}px` : null }, 'Radius', 'radius'), 1, 0), h('span', { class: 'lec-unit' }, 'px'),
        h('label', { style: 'flex-basis:auto;margin-left:8px' }, t('inspector.padding')), numberField(parseFloat(cs.paddingTop) || 0, (n) => ed.setStyles({ padding: n ? `${n}px` : null }, 'Padding', 'padding'), 1, 0), h('span', { class: 'lec-unit' }, 'px')),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.shadow')),
        selectField(['none', 'soft', 'medium', 'strong', ...(shadowKey === 'custom' ? ['custom'] : [])], shadowKey, (v) => ed.setStyles({ 'box-shadow': SHADOWS[v] || null }, 'Shadow'), (v) => t(SHADOW_LABELS[v]))),
    );

    // Image / link / media specifics
    if (tag === 'img') {
      const srcInput = textField(el.getAttribute('src') ?? '', (v) => ed.setAttr('src', v, 'Image source'));
      this.section('inspector.image', null,
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.source')), srcInput, h('button', { class: 'lec-btn', type: 'button', title: t('inspector.chooseImage'), onclick: async () => { const pick = await this.app.chooseImage(); if (pick) ed.setAttr('src', pick.src, 'Image source'); } }, svgIcon(icons.folder))),
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.altText')), textField(el.getAttribute('alt') ?? '', (v) => ed.setAttr('alt', v, 'Alt text'))),
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.fit')), selectField(['', 'contain', 'cover', 'fill'], (el as HTMLElement).style.objectFit || '', (v) => ed.setStyles({ 'object-fit': v || null }, 'Object fit'))),
      );
    }
    if (tag === 'a' || el.closest('a')) {
      const a = (tag === 'a' ? el : el.closest('a')!) as HTMLAnchorElement;
      this.section('inspector.link', null,
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.url')), textField(a.getAttribute('href') ?? '', (v) => ed.edit('Link', () => ed.stage.setAttr(a, 'href', v || null), { top: ed.current.top }))),
      );
    }
    if (tag === 'iframe' || tag === 'video' || tag === 'audio') {
      this.section('inspector.media', null,
        h('div', { class: 'lec-row' }, h('label', {}, t('inspector.source')), textField(el.getAttribute('src') ?? '', (v) => ed.setAttr('src', v, 'Source'))),
        tag !== 'iframe' ? h('div', { class: 'lec-row' }, h('label', {}, t('inspector.autoplay')), checkbox(el.hasAttribute('data-autoplay'), (on) => ed.setAttr('data-autoplay', on ? '' : null, 'Autoplay'))) : null,
      );
    }

    // Fragment
    const isReveal = ed.stage.kind === 'reveal';
    const isFragment = el.classList.contains('fragment');
    const effect = Array.from(el.classList).find((c) => FRAGMENT_EFFECTS.includes(c)) ?? '';
    this.section('inspector.build', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.appear')), checkbox(isFragment, (on) => ed.toggleClass('fragment', on), t('inspector.appearHint'))),
      isFragment && isReveal ? h('div', { class: 'lec-row' }, h('label', {}, t('inspector.effect')),
        selectField(['', ...FRAGMENT_EFFECTS], effect, (v) => ed.edit('Fragment effect', () => {
          for (const s of ed.selection()) {
            for (const c of FRAGMENT_EFFECTS) if (s.classList.contains(c)) ed.stage.toggleClass(s, c, false);
            if (v) ed.stage.toggleClass(s, v, true);
          }
        }, { top: ed.current.top }), (v) => v || t('inspector.fragmentDefault'))) : null,
      isFragment && isReveal ? h('div', { class: 'lec-row' }, h('label', {}, t('inspector.order')),
        numberField(parseInt(el.getAttribute('data-fragment-index') ?? '', 10), (n) => ed.setAttr('data-fragment-index', isFinite(n) ? String(n) : null, 'Fragment order'), 1, 0),
        h('span', { class: 'lec-help' }, t('inspector.orderHelp'))) : null,
    );

    // Classes
    const classes = this.app.themeClasses.filter((c) => !c.tags.size || c.tags.has(tag));
    const active = new Set(Array.from(el.classList));
    const customInput = h('input', { class: 'lec-field lec-class-input', placeholder: t('inspector.addClassPlaceholder'), 'aria-label': t('inspector.addClassAria') }) as HTMLInputElement;
    customInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && customInput.value.trim()) { ed.toggleClass(customInput.value.trim(), true); customInput.value = ''; }
    });
    const chips = h('div', { class: 'lec-chips' },
      ...Array.from(active).filter((c) => !classes.some((tc) => tc.name === c) && c !== 'fragment' && !FRAGMENT_EFFECTS.includes(c)).map((c) =>
        h('button', { class: 'lec-chip lec-active lec-custom', type: 'button', title: t('inspector.removeClass'), onclick: () => ed.toggleClass(c, false) }, `.${c}`)),
      ...classes.filter((c) => c.name !== 'fragment').map((c) =>
        h('button', { class: `lec-chip${active.has(c.name) ? ' lec-active' : ''}`, type: 'button', title: c.selector, onclick: () => ed.toggleClass(c.name) }, `.${c.name}`)),
      customInput,
    );
    this.section('inspector.classes', null, chips, classes.length ? null : h('div', { class: 'lec-help' }, t('inspector.classesHint')));

    // Arrange
    this.section('inspector.arrange', null,
      h('div', { class: 'lec-btn-row' },
        ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((how) =>
          h('button', { class: 'lec-btn', type: 'button', title: t(multi ? 'inspector.alignTo' : 'inspector.alignToSlide', { how: t(ALIGN_LABELS[how]) }), 'aria-label': t(multi ? 'inspector.alignTo' : 'inspector.alignToSlide', { how: t(ALIGN_LABELS[how]) }), onclick: () => ed.align(how) },
            svgIcon(icons[({ left: 'objLeft', center: 'objCenterH', right: 'objRight', top: 'objTop', middle: 'objMiddle', bottom: 'objBottom' } as const)[how]]))),
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.distributeH'), 'aria-label': t('inspector.distributeH'), disabled: ed.selection().length < 3, onclick: () => ed.distribute('h') }, svgIcon(icons.distributeH)),
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.distributeV'), 'aria-label': t('inspector.distributeV'), disabled: ed.selection().length < 3, onclick: () => ed.distribute('v') }, svgIcon(icons.distributeV)),
      ),
      h('div', { class: 'lec-btn-row', style: 'margin-top:6px' },
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.bringToFront'), 'aria-label': t('inspector.bringToFront'), onclick: () => ed.reorder(el, 'front') }, svgIcon(icons.front), t('inspector.front')),
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.bringForward'), 'aria-label': t('inspector.bringForward'), onclick: () => ed.reorder(el, 'forward') }, svgIcon(icons.arrowUp)),
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.sendBackward'), 'aria-label': t('inspector.sendBackward'), onclick: () => ed.reorder(el, 'backward') }, svgIcon(icons.arrowDown)),
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.sendToBack'), 'aria-label': t('inspector.sendToBack'), onclick: () => ed.reorder(el, 'back') }, svgIcon(icons.back), t('inspector.back')),
      ),
      h('div', { class: 'lec-help' }, t('inspector.arrangeHelp')),
    );

    // Advanced
    this.section('inspector.advanced', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.id')), textField(el.id, (v) => ed.setAttr('id', v || null, 'ID'))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.style')), textField(el.getAttribute('style') ?? '', (v) => ed.edit('Inline style', () => { for (const s of ed.selection()) ed.stage.setAttr(s, 'style', v || null); }, { top: ed.current.top }))),
      h('div', { class: 'lec-btn-row', style: 'margin-top:6px' },
        h('button', { class: 'lec-btn', type: 'button', onclick: () => ed.deleteSelection() }, svgIcon(icons.trash), t('inspector.delete')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => ed.duplicateSelection() }, svgIcon(icons.duplicate), t('common.duplicate')),
      ),
    );
  }

  // ---------------------------------------------------------------- Slide tab

  private renderSlide(): void {
    const ed = this.app.editor;
    const ref = ed.current;
    const section = ed.stage.srcSection(ref);
    const attr = (n: string) => section.getAttribute(n) ?? '';
    const set = (n: string) => (v: string | null) => ed.setSlideAttr(ref, n, v || null);
    const stack = isStack(ed.doc.slides[ref.top].el);
    const isReveal = ed.stage.kind === 'reveal';

    const imgInput = textField(attr('data-background-image'), (v) => set('data-background-image')(v));
    if (isReveal) this.section('inspector.background', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.colour')), colorField(attr('data-background-color') || null, (v) => set('data-background-color')(v), true)),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.image')), imgInput,
        h('button', { class: 'lec-btn', type: 'button', title: t('inspector.chooseImage'), onclick: async () => { const pick = await this.app.chooseImage(); if (pick) set('data-background-image')(pick.src); } }, svgIcon(icons.folder))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.size')), selectField(['', 'cover', 'contain', 'auto', '100% 100%'], attr('data-background-size'), (v) => set('data-background-size')(v), (v) => v || t('inspector.backgroundSizeDefault'))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.position')), selectField(['', 'center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right'], attr('data-background-position'), (v) => set('data-background-position')(v), (v) => v || t('inspector.backgroundPositionDefault'))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.opacity')), numberField(attr('data-background-opacity') ? Math.round(parseFloat(attr('data-background-opacity')) * 100) : 100, (n) => set('data-background-opacity')(n >= 100 ? null : String(n / 100)), 5, 0, 100), h('span', { class: 'lec-unit' }, '%'), h('span', { class: 'lec-fill' })),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.gradient')), textField(attr('data-background-gradient'), (v) => set('data-background-gradient')(v))),
    );

    if (isReveal) this.section('inspector.transition', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.transitionSlide')), selectField(TRANSITIONS, attr('data-transition'), (v) => set('data-transition')(v), (v) => v || t('inspector.deckDefault'))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.transitionBackground')), selectField(TRANSITIONS, attr('data-background-transition'), (v) => set('data-background-transition')(v), (v) => v || t('inspector.deckDefault'))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.autoAnimate')), checkbox(section.hasAttribute('data-auto-animate'), (on) => set('data-auto-animate')(on ? '' : null), t('inspector.autoAnimateHint'))),
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.autoSlide')), numberField(parseInt(attr('data-autoslide'), 10), (n) => set('data-autoslide')(isFinite(n) && n > 0 ? String(n) : null), 500, 0), h('span', { class: 'lec-unit' }, 'ms'), h('span', { class: 'lec-fill' })),
    );

    if (isReveal) this.section('inspector.visibility', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.show')),
        selectField(['', 'uncounted', 'hidden'], attr('data-visibility'), (v) => set('data-visibility')(v), (v) => v === '' ? t('inspector.visibilityNormal') : v === 'uncounted' ? t('inspector.visibilityUncounted') : t('inspector.visibilityHidden'))),
      stack ? h('div', { class: 'lec-help' }, t('inspector.verticalStackHint')) : null,
    );

    const active = new Set(Array.from(section.classList));
    const classes = this.app.themeClasses.filter((c) => !c.tags.size || c.tags.has('section'));
    const customInput = h('input', { class: 'lec-field lec-class-input', placeholder: t('inspector.addClassPlaceholder'), 'aria-label': t('inspector.addClassAria') }) as HTMLInputElement;
    customInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' && customInput.value.trim()) { ed.toggleSlideClass(ref, customInput.value.trim()); customInput.value = ''; }
    });
    this.section('inspector.classes', null,
      h('div', { class: 'lec-chips' },
        ...Array.from(active).filter((c) => !classes.some((tc) => tc.name === c)).map((c) =>
          h('button', { class: 'lec-chip lec-active lec-custom', type: 'button', title: t('inspector.removeClass'), onclick: () => ed.toggleSlideClass(ref, c) }, `.${c}`)),
        ...classes.map((c) => h('button', { class: `lec-chip${active.has(c.name) ? ' lec-active' : ''}`, type: 'button', title: c.selector, onclick: () => ed.toggleSlideClass(ref, c.name) }, `.${c.name}`)),
        customInput,
      ),
    );

    this.section('inspector.advanced', null,
      h('div', { class: 'lec-row' }, h('label', {}, t('inspector.id')), textField(section.id, (v) => set('id')(v))),
      h('div', { class: 'lec-btn-row', style: 'margin-top:6px' },
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.panels.show('html') }, svgIcon(icons.code), t('inspector.editHtml')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.panels.show('notes') }, svgIcon(icons.notes), t('inspector.notes')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => ed.duplicateSlide(ref) }, svgIcon(icons.duplicate), t('common.duplicate')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.deleteCurrentSlide(ref) }, svgIcon(icons.trash), t('inspector.delete')),
      ),
    );
  }

  // ---------------------------------------------------------------- Deck tab

  private renderDeck(): void {
    const ed = this.app.editor;
    const info = ed.doc.info;
    const size = ed.stage.slideSize;
    const cfg = ed.stage.reveal?.getConfig() ?? {};
    const refs = ed.slideRefs();
    const plain = ed.stage.kind === 'plain';
    const sizeKey = `lectern:size:${this.app.workspace?.name ?? ''}/${this.app.deckPath}`;
    const logical = ed.stage.logicalSize;
    this.section('inspector.deck', null,
      h('dl', { class: 'lec-kv' },
        h('dt', {}, t('inspector.engine')), h('dd', {}, plain ? t('inspector.enginePlain') : 'reveal.js'),
        h('dt', {}, t('inspector.title')), h('dd', {}, info.title),
        h('dt', {}, ed.doc.isMultiFile ? t('inspector.files') : t('inspector.file')), h('dd', {}, ed.doc.isMultiFile ? ed.doc.sources.map((s) => s.path).join(', ') : this.app.deckPath),
        h('dt', {}, t('inspector.folder')), h('dd', {}, this.app.workspace?.name ?? '—'),
        h('dt', {}, t('inspector.slideSize')), h('dd', {}, plain
          ? selectField(['1280x720', '1920x1080', '1600x900', '1024x768', '1440x900'], `${logical.width}x${logical.height}`, (v) => { const [w, hh] = v.split('x').map(Number); ed.stage.setLogicalSize(w, hh); localStorage.setItem(sizeKey, v); this.app.navigator.render(); this.app.navigator.invalidate(null); }, (v) => v.replace('x', ' × '))
          : `${size.width} × ${size.height}`),
        h('dt', {}, t('inspector.slides')), h('dd', {}, `${refs.length}${refs.length !== ed.doc.length ? t('inspector.topLevelCount', { n: ed.doc.length }) : ''}`),
        plain ? null : h('dt', {}, t('inspector.centred')), plain ? null : h('dd', {}, cfg.center ? t('inspector.yes') : t('inspector.no')),
        h('dt', {}, t('inspector.math')), h('dd', {}, ed.stage.hasMath ? t('inspector.mathLoaded') : t('inspector.noTypesetter')),
        h('dt', {}, t('inspector.themeClasses')), h('dd', {}, String(this.app.themeClasses.length)),
      ),
      h('div', { class: 'lec-help', style: 'margin-top:8px' }, plain
        ? t('inspector.deckHelpPlain')
        : t('inspector.deckHelpReveal')),
    );
    this.section('inspector.actions', null,
      h('div', { class: 'lec-btn-row' },
        h('button', { class: 'lec-btn', type: 'button', onclick: () => void this.app.save() }, svgIcon(icons.save), t('common.save')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.present() }, svgIcon(icons.play), t('common.present')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => this.app.download() }, svgIcon(icons.download), t('inspector.downloadHtml')),
        h('button', { class: 'lec-btn', type: 'button', onclick: () => void this.app.reload() }, t('inspector.reload')),
      ),
    );
  }

  // ---------------------------------------------------------------- helpers

  private section(key: MessageKey, action: HTMLElement | null, ...children: (Node | null)[]): void {
    this.body.appendChild(h('div', { class: 'lec-section', 'data-i18n': key },
      h('div', { class: 'lec-section-title' }, h('span', {}, t(key)), action),
      ...children,
    ));
  }

  /** A section whose title is deck-derived (e.g. "div.col") rather than a message key. */
  private sectionRaw(title: string, action: HTMLElement | null, ...children: (Node | null)[]): void {
    this.body.appendChild(h('div', { class: 'lec-section' },
      h('div', { class: 'lec-section-title' }, h('span', {}, title), action),
      ...children,
    ));
  }
}

// ---------------------------------------------------------------- field widgets

function numberField(value: number, on: (n: number) => void, step = 1, min?: number, max?: number): HTMLInputElement {
  const input = h('input', { class: 'lec-field lec-num', type: 'number', step: String(step), value: isFinite(value) ? fmtNum(value, 2) : '', min: min !== undefined ? String(min) : null, max: max !== undefined ? String(max) : null }) as HTMLInputElement;
  input.addEventListener('change', () => on(parseFloat(input.value)));
  input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') input.blur(); });
  return input;
}

function textField(value: string, on: (v: string) => void): HTMLInputElement {
  const input = h('input', { class: 'lec-field', type: 'text', value }) as HTMLInputElement;
  input.addEventListener('change', () => on(input.value));
  input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') input.blur(); });
  return input;
}

function selectField(options: string[], value: string, on: (v: string) => void, labelFor?: (v: string) => string): HTMLSelectElement {
  const sel = h('select', { class: 'lec-field' }, ...options.map((o) => h('option', { value: o, selected: o === value }, labelFor ? labelFor(o) : o || t('inspector.default')))) as HTMLSelectElement;
  sel.addEventListener('change', () => on(sel.value));
  sel.addEventListener('keydown', (ev) => ev.stopPropagation());
  return sel;
}

function colorField(value: string | null | undefined, on: (v: string | null) => void, allowClear: boolean): HTMLElement {
  const hex = toHex(value);
  const picker = h('input', { type: 'color', value: hex ?? '#000000', title: t('inspector.pickColour') }) as HTMLInputElement;
  const text = h('input', { class: 'lec-field', type: 'text', value: hex ?? '', placeholder: allowClear ? t('inspector.none') : '' }) as HTMLInputElement;
  const wrap = h('div', { class: `lec-color${hex ? '' : ' lec-none'}` }, picker, text,
    allowClear ? h('button', { class: 'lec-btn', type: 'button', title: t('inspector.clear'), 'aria-label': t('inspector.clearColour'), style: 'height:26px;min-width:26px;padding:0', onclick: () => { text.value = ''; wrap.classList.add('lec-none'); on(null); } }, svgIcon(icons.close)) : null);
  picker.addEventListener('input', () => { text.value = picker.value; wrap.classList.remove('lec-none'); on(picker.value); });
  text.addEventListener('change', () => {
    const v = text.value.trim();
    if (!v) { wrap.classList.add('lec-none'); on(null); return; }
    const hx = toHex(v);
    if (hx) picker.value = hx;
    wrap.classList.remove('lec-none');
    on(v);
  });
  text.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') text.blur(); });
  return wrap;
}

function checkbox(checked: boolean, on: (v: boolean) => void, label = ''): HTMLElement {
  const input = h('input', { type: 'checkbox', checked }) as HTMLInputElement;
  input.addEventListener('change', () => on(input.checked));
  return h('label', { class: 'lec-check' }, input, label ? h('span', { class: 'lec-help', style: 'margin:0' }, label) : null);
}

function segmented(options: { value: string; label: string; icon?: IconName; title?: string }[], value: string | string[], on: (v: string) => void, multi = false): HTMLElement {
  const values = Array.isArray(value) ? value : [value];
  return h('div', { class: 'lec-seg' }, ...options.map((o) =>
    h('button', { class: values.includes(o.value) ? 'lec-active' : '', type: 'button', dataset: { action: `seg-${o.value}` }, title: o.title ?? o.label, onclick: () => on(o.value), 'aria-pressed': String(values.includes(o.value)), 'aria-label': o.label ? null : o.title ?? null },
      o.icon ? svgIcon(icons[o.icon]) : null, o.label || null)));
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = Array.from(el.classList).filter((c) => !['present', 'past', 'future', 'visible'].includes(c)).slice(0, 2).map((c) => `.${c}`).join('');
  return `${tag}${cls}`;
}

function normalizeFont(f: string): string {
  return f.replace(/["']/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
}
