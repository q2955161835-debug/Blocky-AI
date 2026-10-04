declare module '*preferences.js' {
  export type Preferences={language:'system'|'zh'|'en';theme:'system'|'light'|'dark';resolvedLanguage:'zh'|'en';resolvedTheme:'light'|'dark'};
  export function getPreferences(): Preferences;
  export function subscribePreferences(listener:(value:Preferences)=>void):()=>void;
  export function translate(text:string,language?:'zh'|'en'):string;
  export function localizeDefault(text:string,language?:'zh'|'en'):string;
  export function observeTranslations(root?:HTMLElement):()=>void;
  export function mountPreferenceControls(container:HTMLElement):()=>void;
}
