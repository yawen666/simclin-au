(function () {
  const toggle = document.querySelector('[data-language-toggle]')
  let language = 'en'

  function applyLanguage(next) {
    language = next
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
    document.querySelectorAll('[data-en][data-zh]').forEach((element) => {
      element.textContent = element.dataset[next]
    })
    if (toggle) toggle.textContent = next === 'en' ? '中文' : 'English'
  }

  toggle?.addEventListener('click', () => applyLanguage(language === 'en' ? 'zh' : 'en'))
  applyLanguage('en')
})()
