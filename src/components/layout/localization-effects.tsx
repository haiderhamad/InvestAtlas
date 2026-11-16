'use client';

import { useEffect } from 'react';
import { translateAppText, getEnglishKey } from '@/lib/i18n/app-localization';
import {
  applyLanguagePreference,
  type LanguagePreference,
} from '@/lib/preferences/app-preferences';

const TEXT_NODE_ORIGINALS = new WeakMap<Text, string>();
const ELEMENT_ATTR_ORIGINALS = new WeakMap<Element, Partial<Record<'placeholder' | 'title' | 'aria-label', string>>>();
const LOCALIZABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label'] as const;
const UNTRANSLATED_SELECTOR = 'script, style, noscript, code, pre, textarea, [translate="no"]';

function isKnownTranslation(original: string, current: string): boolean {
  return (['en', 'de', 'ar'] as const).some((locale) => translateAppText(original, locale) === current);
}

function shouldSkipNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;

  return Boolean(parent.closest(UNTRANSLATED_SELECTOR));
}

function localizeTextNode(node: Text, language: LanguagePreference) {
  if (shouldSkipNode(node)) return;

  const currentText = node.textContent ?? '';
  let originalText = TEXT_NODE_ORIGINALS.get(node);
  
  if (originalText === undefined) {
    originalText = getEnglishKey(currentText, language);
    TEXT_NODE_ORIGINALS.set(node, originalText);
  } else {
    const translatedOriginal = translateAppText(originalText, language);
    if (currentText !== translatedOriginal && !isKnownTranslation(originalText, currentText)) {
      originalText = getEnglishKey(currentText, language);
      TEXT_NODE_ORIGINALS.set(node, originalText);
    }
  }

  const translated = translateAppText(originalText, language);
  if (translated !== currentText) {
    node.textContent = translated;
  }
}

function localizeElementAttributes(element: Element, language: LanguagePreference) {
  if (element.closest(UNTRANSLATED_SELECTOR)) return;
  const originals = ELEMENT_ATTR_ORIGINALS.get(element) ?? {};

  for (const attribute of LOCALIZABLE_ATTRIBUTES) {
    const currentValue = element.getAttribute(attribute);
    if (!currentValue) continue;

    if (!originals[attribute]) {
      originals[attribute] = getEnglishKey(currentValue, language);
    } else {
      const translatedOriginal = translateAppText(originals[attribute] ?? currentValue, language);
      if (currentValue !== translatedOriginal && !isKnownTranslation(originals[attribute]!, currentValue)) {
        originals[attribute] = getEnglishKey(currentValue, language);
      }
    }

    const translated = translateAppText(originals[attribute] ?? currentValue, language);
    if (translated !== currentValue) {
      element.setAttribute(attribute, translated);
    }
  }

  if (Object.keys(originals).length > 0) {
    ELEMENT_ATTR_ORIGINALS.set(element, originals);
  }
}

function localizeSubtree(root: Node, language: LanguagePreference) {
  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root as Text, language);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = root as Element;
  localizeElementAttributes(element, language);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current: Node | null = walker.currentNode;

  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      localizeTextNode(current as Text, language);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      localizeElementAttributes(current as Element, language);
    }

    current = walker.nextNode();
  }
}

export default function LocalizationEffects({ language }: { language: LanguagePreference }) {
  useEffect(() => {
    applyLanguagePreference(language);
    if (typeof document === 'undefined') return;

    localizeSubtree(document.body, language);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            localizeSubtree(node, language);
          });
        } else if (mutation.type === 'characterData') {
          if (mutation.target.nodeType === Node.TEXT_NODE) {
            localizeTextNode(mutation.target as Text, language);
          }
        } else if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          localizeElementAttributes(mutation.target, language);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
      attributeFilter: [...LOCALIZABLE_ATTRIBUTES],
    });

    return () => observer.disconnect();
  }, [language]);

  return null;
}
