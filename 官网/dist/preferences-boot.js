(function () {
  var preference = {};
  try { var stored = JSON.parse(localStorage.getItem('blocky.site.preferences.v1') || '{}'); if(stored && typeof stored==='object')preference=stored; } catch (_) {}
  var language = /^(zh|en)$/.test(preference.language) ? preference.language : (/^zh/i.test(navigator.language) ? 'zh' : 'en');
  var theme = /^(dark|light)$/.test(preference.theme) ? preference.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.theme = theme;
}());
