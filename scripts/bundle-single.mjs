// Bundles dist/ into one self-contained Lectern.html that works from file://
// (double-click). Inlines the JS as a module script and the CSS as a <style>.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
const js = assets.find((f) => f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
if (!js) throw new Error('no JS bundle in dist/assets');
const jsText = readFileSync(join(dist, 'assets', js), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '').replace(/<\/script/gi, '<\\/script');
html = html.replace(/<script type="module" crossorigin src="[^"]*"><\/script>/, () => `<script type="module">\n${jsText}\n</script>`);
if (css) {
  const cssText = readFileSync(join(dist, 'assets', css), 'utf8').replace(/<\/style/gi, '<\\/style');
  html = html.replace(/<link rel="stylesheet" crossorigin href="[^"]*">/, () => `<style>\n${cssText}\n</style>`);
}
if (/src="[^"]*assets\//.test(html) || /href="[^"]*assets\//.test(html)) throw new Error('asset references remain');
writeFileSync('Lectern.html', html);
writeFileSync(join(dist, 'Lectern.html'), html);
console.log(`Lectern.html: ${(html.length / 1024).toFixed(0)} kB — double-click to open`);
