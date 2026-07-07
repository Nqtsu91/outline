import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

// Adapted from https://github.com/markdown-it/markdown-it-sup (MIT)
// Parses ^superscript^ into sup_open / text / sup_close tokens.

const UNESCAPE_RE = /\\([ \\!"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/g;

export default function markdownSuperscript(md: MarkdownIt) {
  function superscript(state: StateInline, silent: boolean) {
    const max = state.posMax;
    const start = state.pos;
    let found = false;

    if (state.src.charCodeAt(start) !== 0x5e /* ^ */) {
      return false;
    }
    if (silent) {
      return false;
    }
    if (start + 2 >= max) {
      return false;
    }

    state.pos = start + 1;

    while (state.pos < max) {
      if (state.src.charCodeAt(state.pos) === 0x5e /* ^ */) {
        found = true;
        break;
      }
      state.md.inline.skipToken(state);
    }

    if (!found || start + 1 === state.pos) {
      state.pos = start;
      return false;
    }

    const content = state.src.slice(start + 1, state.pos);

    // don't allow unescaped spaces/newlines inside
    if (content.match(/(^|[^\\])(\\\\)*\s/)) {
      state.pos = start;
      return false;
    }

    state.posMax = state.pos;
    state.pos = start + 1;

    let token = state.push("sup_open", "sup", 1);
    token.markup = "^";

    token = state.push("text", "", 0);
    token.content = content.replace(UNESCAPE_RE, "$1");

    token = state.push("sup_close", "sup", -1);
    token.markup = "^";

    state.pos = state.posMax + 1;
    state.posMax = max;
    return true;
  }

  md.inline.ruler.after("emphasis", "superscript", superscript);
}
