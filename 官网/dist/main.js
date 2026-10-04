import { mountContent } from './content.js';
import { mountDemo, stopRun } from './demo.js';
import { getPreferences, subscribePreferences, mountPreferenceControls, observeTranslations } from './preferences.js';
mountContent();
mountPreferenceControls(document.querySelector('#site-preferences'));
observeTranslations();
const website = document.querySelector('#website');
const studio = document.querySelector('#studio');
function route() {
  const isStudio = location.hash.startsWith('#/studio');
  website.hidden = isStudio;
  studio.hidden = !isStudio;
  document.body.classList.toggle('experiencing', isStudio);
  updateMetadata();
  if (isStudio && !studio.hasChildNodes()) mountDemo();
  if (isStudio) { window.scrollTo(0, 0); studio.querySelector('iframe').focus({preventScroll:true}); }
  else stopRun(false);
}
function updateMetadata() {
  const en=getPreferences().resolvedLanguage==='en',demo=location.hash.startsWith('#/studio');
  document.title=demo?(en?'Try Blocky · Blocky Studio':'在线体验 · Blocky Studio'):(en?'Blocky — Build your ideas, block by block':'Blocky — 让想法，一块块成真');
  document.querySelector('meta[name="description"]').content=en?'Blocky is a block-based AI creation studio. Understand, customize, and build your own agents. Explore starting blueprints for education and professional creation.':'Blocky，面向每一个创作者的积木式 AI 创作软件。从理解 AI，到亲手搭建自己的智能体。探索四类起始蓝图，在线体验积木画布与构建助手。';
}
subscribePreferences(updateMetadata);
window.addEventListener('hashchange', route);
route();
