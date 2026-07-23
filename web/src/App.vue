<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useLocaleStore } from '@/stores/locale'

const locale = useLocaleStore()
const originalText = new WeakMap<Text, string>()
const lastText = new WeakMap<Text, string>()
const originalAttrs = new WeakMap<HTMLElement, Record<string, string>>()
const translatableAttrs = ['placeholder', 'title', 'aria-label']
let observer: MutationObserver | undefined
let applying = false
let previousLocale = locale.locale

function translateDocument() {
  if (typeof document === 'undefined') return
  applying = true
  const localeChanged = previousLocale !== locale.locale
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const text = node as Text
    const current = text.textContent ?? ''
    const previous = lastText.get(text)
    if (!originalText.has(text) || (!localeChanged && previous !== undefined && current !== previous)) originalText.set(text, current)
    const source = originalText.get(text) ?? current
    const key = source.trim()
    if (!key || key.length > 180 || !locale.has(key)) continue
    const translated = locale.t(key)
    const next = locale.locale === 'zh' && translated !== key ? source.replace(key, translated) : source
    if (text.textContent !== next) text.textContent = next
    lastText.set(text, next)
  }
  document.querySelectorAll<HTMLElement>('*').forEach(element => {
    const attrs = originalAttrs.get(element) ?? {}
    let changed = false
    translatableAttrs.forEach(attribute => {
      const value = element.getAttribute(attribute)
      if (value === null) return
      if (!locale.has(value) && attrs[attribute] === undefined) return
      if (attrs[attribute] === undefined || (!localeChanged && attrs[attribute] !== value && value !== locale.t(attrs[attribute]))) {
        attrs[attribute] = value
        changed = true
      }
      const translated = locale.t(attrs[attribute])
      const next = locale.locale === 'zh' && translated !== attrs[attribute] ? translated : attrs[attribute]
      if (value !== next) element.setAttribute(attribute, next)
    })
    if (changed) originalAttrs.set(element, attrs)
  })
  previousLocale = locale.locale
  applying = false
}

onMounted(async () => {
  await nextTick()
  translateDocument()
  observer = new MutationObserver(() => { if (!applying) translateDocument() })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: translatableAttrs })
})
watch(() => locale.locale, () => nextTick(translateDocument))
onBeforeUnmount(() => observer?.disconnect())
</script>

<template><RouterView /></template>
