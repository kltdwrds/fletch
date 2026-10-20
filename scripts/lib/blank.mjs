// Source-text blanking shared by the boundary check and the test-hygiene check, adapted from the
// monorepo's scripts/check-boundaries.mjs. Blanking replaces characters with spaces and keeps every
// newline, so offsets and line numbers stay where they were. It is a heuristic, not a parser: a
// nested template, a regex after `)` or JSX text can open a false comment, which is why callers that
// must not miss anything also read the raw text.

/** After one of these characters, or these words, or at the start, a `/` starts a regular expression, not a division. */
const BEFORE_REGEX = '(,=:[!&|?{};+-*%<>~^';
const REGEX_WORDS = new Set(['return', 'typeof', 'await', 'case', 'do', 'else', 'in', 'of', 'yield', 'void', 'delete', 'new', 'instanceof']);
const WORD = /[\w$]/;

/** The index just past a quoted string or template literal opening at `i`; a quote string ends at its line's end at the latest. */
function pastString(text, i) {
  const q = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== q && (q === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** The index just past a regular expression literal opening at `i`: its closing `/` outside a class, or its line's end. */
function pastRegex(text, i) {
  let j = i + 1;
  let inClass = false;
  while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
    if (text[j] === '\\') j += 1;
    else if (text[j] === '[') inClass = true;
    else if (text[j] === ']') inClass = false;
    j += 1;
  }
  return j + 1;
}

/**
 * `text` with every comment blanked, and with `literals` also the contents of every string, template
 * literal and regular expression (their delimiters kept). Strings and regexes are skipped whole, so a
 * `//` or `/*` inside one is never a comment.
 */
function blank(text, literals) {
  const out = text.split('');
  const wipe = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let prevChar = '';
  let prevWord = '';
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2);
      const to = end === -1 ? text.length : next === '/' ? end : end + 2;
      wipe(i, to);
      i = to;
    } else if (c === "'" || c === '"' || c === '`' || (c === '/' && (prevChar === '' || BEFORE_REGEX.includes(prevChar) || REGEX_WORDS.has(prevWord)))) {
      const to = c === '/' ? pastRegex(text, i) : pastString(text, i);
      if (literals) wipe(i + 1, to - 1);
      i = to;
      prevChar = 'a';
      prevWord = '';
    } else if (WORD.test(c)) {
      let j = i;
      while (j < text.length && WORD.test(text[j])) j += 1;
      prevWord = text.slice(i, j);
      prevChar = 'a';
      i = j;
    } else {
      if (!/\s/.test(c)) {
        prevChar = c;
        prevWord = '';
      }
      i += 1;
    }
  }
  return out.join('');
}

/** `text` with every comment blanked to spaces; strings, templates and regexes kept. */
export const blankComments = (text) => blank(text, false);

/** `text` with every comment and the contents of every string, template and regex blanked: the code alone. */
export const blankCommentsAndLiterals = (text) => blank(text, true);

/** The 1-based line of offset `index` in `text`. */
export const lineAt = (text, index) => text.slice(0, index).split('\n').length;
