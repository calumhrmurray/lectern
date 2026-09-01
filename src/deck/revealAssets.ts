/**
 * A minimal reveal.js distribution embedded in the editor bundle, so that the
 * examples, the demo and new decks work with no network and no server
 * (Lectern.html on file://). Paths mirror the npm package layout.
 */
import revealJs from '../../public/reveal/dist/reveal.js?raw';
import revealCss from '../../public/reveal/dist/reveal.css?raw';
import resetCss from '../../public/reveal/dist/reset.css?raw';
import notesJs from '../../public/reveal/plugin/notes/notes.js?raw';
import mathJs from '../../public/reveal/plugin/math/math.js?raw';
import zoomJs from '../../public/reveal/plugin/zoom/zoom.js?raw';
import license from '../../public/reveal/LICENSE?raw';
import katexJs from '../../public/reveal/katex/dist/katex.min.js?raw';
import katexCss from '../../public/reveal/katex/dist/katex.embedded.css?raw';
import katexAutoRender from '../../public/reveal/katex/dist/contrib/auto-render.min.js?raw';
import katexLicense from '../../public/reveal/katex/LICENSE?raw';

export const REVEAL_EMBEDDED: Record<string, string> = {
  'dist/reveal.js': revealJs,
  'dist/reveal.css': revealCss,
  'dist/reset.css': resetCss,
  'plugin/notes/notes.js': notesJs,
  'plugin/math/math.js': mathJs,
  'plugin/zoom/zoom.js': zoomJs,
  'LICENSE': license,
  // KaTeX, so a deck written from Lectern.html typesets its maths offline. The
  // stylesheet is the one with the fonts inlined (see scripts/copy-reveal.js);
  // it is written under the name the math plugin asks for.
  'katex/dist/katex.min.js': katexJs,
  'katex/dist/katex.min.css': katexCss,
  'katex/dist/contrib/auto-render.min.js': katexAutoRender,
  'katex/LICENSE': katexLicense,
};
