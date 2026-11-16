/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Exports all translation dictionaries from app-localization.ts to
 * messages/en.json, messages/de.json, and messages/ar.json.
 *
 * The English file uses the source key as both key and value (identity map).
 * German and Arabic files map each source key to its translated value.
 *
 * Run: node scripts/export-messages.js
 */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = process.cwd();
const i18nFile = path.join(root, 'src/lib/i18n/app-localization.ts');
const messagesDir = path.join(root, 'messages');

const sourceText = fs.readFileSync(i18nFile, 'utf8');
const sourceFile = ts.createSourceFile(i18nFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function extractObject(name) {
  const map = {};

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === name &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const k = ts.isStringLiteralLike(prop.name)
          ? prop.name.text
          : prop.name.getText(sourceFile);
        const v = ts.isStringLiteralLike(prop.initializer)
          ? prop.initializer.text
          : null;
        if (k && v !== null) map[k] = v;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return map;
}

// Merge in priority order (later wins)
function merge(...objects) {
  return Object.assign({}, ...objects);
}

const generatedDe = extractObject('GENERATED_DE_TEXT');
const refinedDe   = extractObject('REFINED_DE_TEXT');
const de          = extractObject('DE_TEXT');

const generatedAr = extractObject('GENERATED_AR_TEXT');
const refinedAr   = extractObject('REFINED_AR_TEXT');
const ar          = extractObject('AR_TEXT');

const sourceCorrections = extractObject('SOURCE_CORRECTIONS');

// Build the merged DE and AR maps (same key space = source English text)
const deMerged = merge(generatedDe, de, refinedDe);
const arMerged = merge(generatedAr, ar, refinedAr);

// English: identity map over every key that exists in DE (those are the translatable strings)
const allKeys = new Set([...Object.keys(deMerged), ...Object.keys(arMerged)]);
const enMap = {};
for (const key of allKeys) {
  // English text = the corrected English version of the key
  enMap[key] = sourceCorrections[key] ?? key;
}

if (!fs.existsSync(messagesDir)) {
  fs.mkdirSync(messagesDir, { recursive: true });
}

const sortedEn = Object.fromEntries(Object.entries(enMap).sort(([a], [b]) => a.localeCompare(b)));
const sortedDe = Object.fromEntries(Object.entries(deMerged).sort(([a], [b]) => a.localeCompare(b)));
const sortedAr = Object.fromEntries(Object.entries(arMerged).sort(([a], [b]) => a.localeCompare(b)));

fs.writeFileSync(path.join(messagesDir, 'en.json'), JSON.stringify(sortedEn, null, 2) + '\n');
fs.writeFileSync(path.join(messagesDir, 'de.json'), JSON.stringify(sortedDe, null, 2) + '\n');
fs.writeFileSync(path.join(messagesDir, 'ar.json'), JSON.stringify(sortedAr, null, 2) + '\n');

console.log(`Exported messages:`);
console.log(`  en.json  ${Object.keys(sortedEn).length} keys`);
console.log(`  de.json  ${Object.keys(sortedDe).length} keys`);
console.log(`  ar.json  ${Object.keys(sortedAr).length} keys`);
