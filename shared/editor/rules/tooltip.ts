import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

// Parses tooltip annotations written as [[visible text|hover title]] into
// tooltip_open / text / tooltip_close tokens. The double-bracket + pipe syntax
// is distinctive enough to avoid colliding with links or other inline markup.

export default function markdownTooltip(md: MarkdownIt) {
  function tooltip(state: StateInline, silent: boolean) {
    const max = state.posMax;
    const start = state.pos;

    // Must start with "[["
    if (
      state.src.charCodeAt(start) !== 0x5b /* [ */ ||
      state.src.charCodeAt(start + 1) !== 0x5b /* [ */
    ) {
      return false;
    }

    // Find the closing "]]"
    let pos = start + 2;
    let found = -1;
    while (pos < max - 1) {
      if (
        state.src.charCodeAt(pos) === 0x5d /* ] */ &&
        state.src.charCodeAt(pos + 1) === 0x5d /* ] */
      ) {
        found = pos;
        break;
      }
      pos++;
    }

    if (found === -1) {
      return false;
    }

    const inner = state.src.slice(start + 2, found);

    // Require a pipe separating visible text from the hover title
    const sep = inner.lastIndexOf("|");
    if (sep === -1) {
      return false;
    }

    const text = inner.slice(0, sep);
    const title = inner.slice(sep + 1);

    if (!text || !title) {
      return false;
    }

    if (!silent) {
      let token = state.push("tooltip_open", "abbr", 1);
      token.markup = "[[";
      token.attrs = [["title", title]];

      token = state.push("text", "", 0);
      token.content = text;

      token = state.push("tooltip_close", "abbr", -1);
      token.markup = "]]";
    }

    state.pos = found + 2;
    return true;
  }

  md.inline.ruler.before("link", "tooltip", tooltip);
}
