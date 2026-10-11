import { english } from './translations.js';
import { uiEnglish } from './ui-translations.js';
import { demoEnglish } from './demo-translations.js';
import { artEnglish } from './art-translations.js';
import { experienceEnglish } from './experience-translations.js';
import { quizEnglish } from './quiz-translations.js';

const dictionary = { ...english, ...uiEnglish, ...demoEnglish, ...artEnglish, ...experienceEnglish, ...quizEnglish };
const reverse = new Map(Object.entries(dictionary).map(([zh,en]) => [en,zh]));
const key = 'blocky.site.preferences.v1';
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();
const controls = new Set();
function read() {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return {language:['zh','en'].includes(value.language)?value.language:'system',theme:['dark','light'].includes(value.theme)?value.theme:'system'};
  } catch { return {language:'system',theme:'system'}; }
}
let preference = read();
export function getPreferences() {
  return {...preference, resolvedLanguage:preference.language==='system'?(/^zh/i.test(navigator.language)?'zh':'en'):preference.language,
    resolvedTheme:preference.theme==='system'?(media.matches?'dark':'light'):preference.theme};
}
export function subscribePreferences(listener) { listeners.add(listener); return ()=>listeners.delete(listener); }
export function translate(text, language=getPreferences().resolvedLanguage) {
  if(language!=='en')return text;
  if(dictionary[text])return dictionary[text];
  if(text.startsWith('预设回答示例：'))return 'Preset response: '+translate(text.slice(7),language);
  const count=text.match(/^(画布大纲|画布|main)\s*·\s*(\d+)(?:\s*个积木)?$/);
  if(count)return `${translate(count[1],language)} · ${count[2]}${text.includes('个积木')?' blocks':''}`;
  const number=text.match(/^(\d+)\s*个积木$/);
  if(number)return `${number[1]} blocks`;
  if(text.startsWith('✓ '))return '✓ '+translate(text.slice(2),language);
  if(text.startsWith('▧ '))return '▧ '+translate(text.slice(2),language);
  const starting=text.match(/^从(.+)开始$/);
  if(starting)return 'Start with '+translate(starting[1],language);
  return text;
}
export function localizeDefault(text, language=getPreferences().resolvedLanguage) {
  return language==='en'?translate(text,language):(reverse.get(text)||text);
}
const textSources = new WeakMap(), attributeSources = new WeakMap();
let translatorRoot, observer, queued=false;
function excluded(element) {
  return element?.closest('script,style,textarea,input,[contenteditable="true"],[data-no-translate],[data-preferences],svg');
}
function renderText(node) {
  if(excluded(node.parentElement))return;
  const current=node.nodeValue;
  let source=textSources.get(node);
  if(!source||current!==source.last){source={base:current,last:current};textSources.set(node,source);}
  const trimmed=source.base.trim();
  const value=source.base.replace(trimmed,translate(trimmed));
  if(current!==value)node.nodeValue=value;
  source.last=value;
}
export function translateDocument(root=translatorRoot) {
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode())renderText(walker.currentNode);
  for(const element of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]')) {
    if(element.closest('[data-no-translate],[data-preferences]'))continue;
    let sources=attributeSources.get(element);
    if(!sources){sources={};attributeSources.set(element,sources);}
    for(const name of ['aria-label','title','placeholder','alt']) {
      if(!element.hasAttribute(name))continue;
      const current=element.getAttribute(name);
      let source=sources[name];
      if(!source||current!==source.last)source=sources[name]={base:current,last:current};
      const value=translate(source.base);
      if(current!==value)element.setAttribute(name,value);
      source.last=value;
    }
  }
}
export function observeTranslations(root=document.body) {
  translatorRoot=root;
  translateDocument(root);
  observer=new MutationObserver(()=>{
    if(queued)return;queued=true;
    queueMicrotask(()=>{queued=false;translateDocument(root);});
  });
  observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder','alt']});
  return ()=>observer.disconnect();
}
function notify() {
  const value=getPreferences();
  document.documentElement.lang=value.resolvedLanguage==='zh'?'zh-CN':'en';
  document.documentElement.dataset.theme=value.resolvedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',value.resolvedTheme==='dark'?'#101211':'#f7f8f2');
  for(const update of controls)update(value);
  translateDocument();
  for(const listener of listeners)listener(value);
}
function choose(name,value) {
  preference={...preference,[name]:value};
  try { localStorage.setItem(key,JSON.stringify(preference)); } catch {}
  notify();
}
export function mountPreferenceControls(container) {
  container.setAttribute('data-preferences','');
  container.classList.add('preference-controls');
  container.innerHTML=`<details class="preference-menu" data-kind="language"><summary><span class="preference-language"></span><span class="preference-chevron" aria-hidden="true">⌄</span></summary><div class="preference-options"><button type="button" data-value="system"></button><button type="button" data-value="zh" lang="zh-CN">简体中文</button><button type="button" data-value="en" lang="en">English</button></div></details><details class="preference-menu" data-kind="theme"><summary><svg class="preference-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg class="preference-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20.8 14A8.8 8.8 0 0 1 10 3.2 8.8 8.8 0 1 0 20.8 14Z"/></svg></summary><div class="preference-options"><button type="button" data-value="system"></button><button type="button" data-value="light"></button><button type="button" data-value="dark"></button></div></details>`;
  const menus=[...container.querySelectorAll('details')];
  const update=value=>{
    const en=value.resolvedLanguage==='en';
    container.querySelector('.preference-language').textContent=en?'EN':'中';
    for(const menu of menus) {
      const kind=menu.dataset.kind;
      menu.querySelector('summary').setAttribute('aria-label',kind==='language'?(en?'Language':'语言'):(en?'Appearance':'外观'));
      menu.querySelector('summary').title=kind==='language'?(en?'Language':'语言'):(en?'Appearance':'外观');
      for(const button of menu.querySelectorAll('button')) {
        button.setAttribute('aria-pressed',String(preference[kind]===button.dataset.value));
        if(button.dataset.value==='system')button.textContent=en?'Follow system':'跟随系统';
        if(kind==='theme'&&button.dataset.value!=='system')button.textContent=button.dataset.value==='light'?(en?'Light':'浅色'):(en?'Dark':'深色');
      }
    }
  };
  controls.add(update);update(getPreferences());
  container.addEventListener('click',event=>{
    const button=event.target.closest('button[data-value]');
    if(!button)return;
    const menu=button.closest('details');choose(menu.dataset.kind,button.dataset.value);menu.open=false;menu.querySelector('summary').focus({preventScroll:true});
  });
  for(const menu of menus)menu.addEventListener('toggle',()=>{if(menu.open)menus.filter(other=>other!==menu).forEach(other=>other.open=false);});
  const close=event=>{if(event.type==='keydown'&&event.key!=='Escape')return;if(event.type==='pointerdown'&&container.contains(event.target))return;for(const menu of menus)if(menu.open){menu.open=false;if(event.type==='keydown')menu.querySelector('summary').focus();}};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);
  return ()=>{controls.delete(update);document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);container.replaceChildren();};
}
media.addEventListener('change',notify);
window.addEventListener('languagechange',notify);
window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=read();notify();}});
notify();
