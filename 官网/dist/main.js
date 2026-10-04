import { mountContent } from './content.js';
import { mountDemo, stopRun } from './demo.js';
mountContent();
const website = document.querySelector('#website');
const studio = document.querySelector('#studio');
function route() {
  const isStudio = location.hash.startsWith('#/studio');
  website.hidden = isStudio;
  studio.hidden = !isStudio;
  document.title = isStudio ? '在线体验 · Blocky Studio' : 'Blocky — 让想法，一块块成真';
  if (isStudio && !studio.hasChildNodes()) mountDemo();
  if (isStudio) { window.scrollTo(0, 0); studio.querySelector('main').focus({preventScroll:true}); }
  else stopRun(false);
}
window.addEventListener('hashchange', route);
route();
