import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

// Adapted from https://github.com/markdown-it/markdown-it-sub (MIT)
// Parses ~subscript~ into sub_open / text / sub_close tokens. A single tilde
// is used so it does not collide with strikethrough, which uses a double tilde.

const UNESCAPE_RE = /\\([ \\!"#$%&'()*+,./:;<=>?@[\]^_`{|}~-])/g;

export default function markdownSubscript(md: MarkdownIt) {
  function subscript(state: StateInline, silent: boolean) {
    const max = state.posMax;
    const start = state.pos;
    let found = false;

    if (state.src.charCodeAt(start) !== 0x7e /* ~ */) {
      return false;
    }
    if (silent) {
      return false;
    }
    if (start + 2 >= max) {
      return false;
    }

    // A double tilde is strikethrough, not subscript.
    if (state.src.charCodeAt(start + 1) === 0x7e /* ~ */) {
      return false;
    }

    state.pos = start + 1;

    while (state.pos < max) {
      if (state.src.charCodeAt(state.pos) === 0x7e /* ~ */) {
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

    let token = state.push("sub_open", "sub", 1);
    token.markup = "~";

    token = state.push("text", "", 0);
    token.content = content.replace(UNESCAPE_RE, "$1");

    token = state.push("sub_close", "sub", -1);
    token.markup = "~";

    state.pos = state.posMax + 1;
    state.posMax = max;
    return true;
  }

  md.inline.ruler.after("emphasis", "subscript", subscript);
}
