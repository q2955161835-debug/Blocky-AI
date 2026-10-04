import { mountContent } from './content.js';
import { mountDemo, stopRun } from './demo.js';
import { getPreferences, subscribePreferences, mountPreferenceControls, observeTranslations } from './preferences.js';
import {mountWorldPage} from './world-pages.js';
import {mountActiveNavigation} from './active-navigation.js';
import {mountContentMotion} from './content-motion.js';
import {mountBrandMotion} from './brand-motion.js';
mountContent();
mountContentMotion();
mountPreferenceControls(document.querySelector('#site-preferences'));
observeTranslations();
let art;
import('./art3d.js').then(module=>{art=module.startArt({subscribePreferences});world?.attachArt(art);art?.refresh();}).catch(()=>{document.body.classList.add('art-unavailable');window.dispatchEvent(new Event('blocky-art-unavailable'));});
const website = document.querySelector('#website');
const studio = document.querySelector('#studio');
const worldPage=document.querySelector('#world-page');
let world,worldType;
function route() {
  const isStudio = location.hash.startsWith('#/studio');
  const type=location.hash.match(/^#\/(education|professional)$/)?.[1];
  website.hidden = isStudio||!!type;
  studio.hidden = !isStudio;
  worldPage.hidden=!type;
  document.body.classList.toggle('experiencing', isStudio);
  document.body.classList.toggle('world-mode',!!type);
  document.body.dataset.world=type||'';
  if(worldType!==type){world?.dispose();world=null;worldType=type;if(type){world=mountWorldPage(worldPage,type);window.scrollTo({top:0,behavior:'instant'});world.attachArt(art);}else if(!isStudio){requestAnimationFrame(()=>{const anchor=location.hash.startsWith('#/')?null:document.getElementById(location.hash.slice(1));if(anchor)anchor.scrollIntoView();else if(!location.hash||location.hash==='#')window.scrollTo({top:0,behavior:'instant'});});}}
  updateMetadata();
  art?.refresh();
  if (isStudio && !studio.hasChildNodes()) mountDemo();
  if (isStudio) { window.scrollTo(0, 0); studio.querySelector('iframe').focus({preventScroll:true}); }
  else stopRun(false);
}
function updateMetadata() {
  const en=getPreferences().resolvedLanguage==='en',demo=location.hash.startsWith('#/studio');
  const scene=location.hash.match(/^#\/(education|professional)$/)?.[1];
  document.title=scene?(scene==='education'?(en?'The Blocky campus · Blocky':'积木校园 · Blocky'):(en?'The creator district · Blocky':'创作园区 · Blocky')):demo?(en?'Try Blocky · Blocky Studio':'在线体验 · Blocky Studio'):(en?'Blocky — Build your ideas, block by block':'Blocky — 让想法，一块块成真');
  document.querySelector('meta[name="description"]').content=en?'Blocky is a block-based AI creation studio. Understand, customize, and build your own agents. Explore starting blueprints for education and professional creation.':'Blocky，面向每一个创作者的积木式 AI 创作软件。从理解 AI，到亲手搭建自己的智能体。探索四类起始蓝图，在线体验积木画布与构建助手。';
}
subscribePreferences(updateMetadata);
window.addEventListener('hashchange', route);
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();const main=world?worldPage.querySelector('main'):document.querySelector('#main');main.setAttribute('tabindex','-1');main.focus({preventScroll:true});});
route();
mountBrandMotion();
mountActiveNavigation();
