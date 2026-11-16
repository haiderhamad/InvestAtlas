/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = process.cwd();
const i18nFile = path.join(root, 'src/lib/i18n/app-localization.ts');
const sourceText = fs.readFileSync(i18nFile, 'utf8');
const sourceFile = ts.createSourceFile(i18nFile, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function findObject(name) {
  let result = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === name &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      result = node.initializer;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

function objectKeys(name) {
  const objectNode = findObject(name);
  const keys = new Set();

  if (!objectNode) {
    return keys;
  }

  for (const property of objectNode.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    keys.add(ts.isStringLiteralLike(property.name) ? property.name.text : property.name.getText(sourceFile));
  }

  return keys;
}

function union(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

const deKeys = union(
  objectKeys('GENERATED_DE_TEXT'),
  objectKeys('DE_TEXT'),
  objectKeys('REFINED_DE_TEXT'),
  objectKeys('V124_DE_TEXT'),
);
const arKeys = union(
  objectKeys('GENERATED_AR_TEXT'),
  objectKeys('AR_TEXT'),
  objectKeys('REFINED_AR_TEXT'),
  objectKeys('V124_AR_TEXT'),
);

const sourceFiles = ['src/app', 'src/components', 'src/lib']
  .flatMap((directory) => fs.readdirSync(path.join(root, directory), { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
  .sort()
  .filter((file) => !file.includes('/api/') && !file.includes('/scratch/'));

const localizableAttributes = new Set(['placeholder', 'title', 'aria-label', 'alt']);
const localizableProperties = new Set([
  'label',
  'title',
  'subtitle',
  'description',
  'message',
  'heading',
  'emptyTitle',
  'emptyDescription',
  'helper',
  'placeholder',
  'text',
  'cta',
  'ariaLabel',
  'error',
  'success',
  'note',
  'tooltip',
  'caption',
  'badge',
  'eyebrow',
]);

function normalize(value) {
  return value.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function isIgnoredUiString(value, kind) {
  const normalized = normalize(value);

  if (!normalized || normalized.length < 2) return true;
  if (!/[A-Za-zÄÖÜäöüß]/.test(normalized)) return true;
  if (/^[-+]?\d/.test(normalized)) return true;
  if (normalized.includes('http') || normalized.includes('var(') || normalized.startsWith('#')) return true;
  if (/^([·•&;#<>\s\\u00b7()[\]\-–—:.,!%€$/]+)$/.test(normalized)) return true;
  if (/^(&[a-z]+;|\\u[0-9a-f]{4})/i.test(normalized)) return true;
  if (/^badge-/.test(normalized) || /^sk-/.test(normalized)) return true;
  if (/you@example\.com|john@example\.com|John Doe/.test(normalized)) return true;
  if (/^e\.g\. BTC$/.test(normalized)) return true;
  if (kind.startsWith('prop:name')) return true;
  // Fixed provider bridge error identifiers are translated by their UI caller.
  // They are machine-readable JSON codes, never displayed as user-facing copy.
  if (kind === 'prop:error' && /^(?:yahoo|eodhd)_[a-z_]+$/.test(normalized)) return true;
  if (/^[A-Z0-9_]+$/.test(normalized) && normalized.length < 12) return true;

  return /^(InvestAtlas|Apple|Google|Bitvavo|BullionVault|CoinGecko|CryptoCompare|Binance|Gate\.io|TradingView|Zoya|Musaffa|OpenAI|Gemini|OpenRouter|PDF|Excel|CSV|API|EMA|SMA|RSI|IBKR|Trade Republic|Scalable|GitHub|LinkedIn|English|Deutsch|العربية|Bitcoin)$/i.test(
    normalized,
  );
}

const strings = new Map();

function addString(value, file, source, kind) {
  const normalized = normalize(value);
  if (isIgnoredUiString(normalized, kind)) {
    return;
  }

  if (!strings.has(normalized)) {
    strings.set(normalized, []);
  }

  const refs = strings.get(normalized);
  if (refs.length < 3) {
    refs.push(`${path.relative(root, file)}:${source.line + 1}:${source.character + 1}`);
  }
}

for (const relativeFile of sourceFiles) {
  const file = path.join(root, relativeFile);
  const text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    relativeFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isJsxText(node)) {
      addString(node.getText(ast), file, ast.getLineAndCharacterOfPosition(node.getStart(ast)), 'jsx');
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isStringLiteralLike(node.expression) || node.expression.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral)
    ) {
      addString(node.expression.text, file, ast.getLineAndCharacterOfPosition(node.expression.getStart(ast)), 'jsx-expr');
    }

    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      localizableAttributes.has(node.name.getText(ast))
    ) {
      addString(
        node.initializer.text,
        file,
        ast.getLineAndCharacterOfPosition(node.initializer.getStart(ast)),
        `attr:${node.name.getText(ast)}`,
      );
    }

    if (ts.isCallExpression(node) && node.arguments.length && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const argument = node.arguments[0];
      if (ts.isStringLiteralLike(argument) || argument.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
        addString(argument.text, file, ast.getLineAndCharacterOfPosition(argument.getStart(ast)), 't');
      }
    }

    if (ts.isPropertyAssignment(node)) {
      const name =
        ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText(ast);
      if (
        localizableProperties.has(name) &&
        node.initializer &&
        (ts.isStringLiteralLike(node.initializer) || node.initializer.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral)
      ) {
        addString(
          node.initializer.text,
          file,
          ast.getLineAndCharacterOfPosition(node.initializer.getStart(ast)),
          `prop:${name}`,
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(ast);
}

const missing = [...strings.entries()]
  .map(([key, refs]) => ({
    key,
    refs,
    de: deKeys.has(key),
    ar: arKeys.has(key),
  }))
  .filter((entry) => !entry.de || !entry.ar)
  .sort((a, b) => a.key.localeCompare(b.key));

if (missing.length) {
  console.error(`Missing i18n coverage for ${missing.length} UI string(s):`);
  for (const entry of missing.slice(0, 100)) {
    const languages = [entry.de ? null : 'de', entry.ar ? null : 'ar'].filter(Boolean).join(', ');
    console.error(`- [${languages}] ${entry.key}`);
    console.error(`  ${entry.refs.join('\n  ')}`);
  }
  process.exit(1);
}

console.log(`i18n coverage OK: ${strings.size} UI string(s) covered for de and ar.`);
