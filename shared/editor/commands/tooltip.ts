import type { Attrs } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { Selection, TextSelection } from "prosemirror-state";
import { getMarkRange } from "../queries/getMarkRange";

/**
 * Adds a tooltip mark with the given attributes over the current text selection.
 */
export const addTooltip =
  (attrs: Attrs): Command =>
  (state, dispatch) => {
    if (!(state.selection instanceof TextSelection) || state.selection.empty) {
      return false;
    }

    dispatch?.(
      state.tr
        .setSelection(TextSelection.create(state.doc, state.tr.selection.to))
        .addMark(
          state.selection.from,
          state.selection.to,
          state.schema.marks.tooltip.create(attrs)
        )
    );

    return true;
  };

/**
 * Updates the tooltip mark covering the current selection with new attributes.
 */
export const updateTooltip =
  (attrs: Attrs): Command =>
  (state, dispatch) => {
    if (!(state.selection instanceof TextSelection)) {
      return false;
    }

    const range = getMarkRange(
      state.selection.$from,
      state.schema.marks.tooltip
    );

    if (range && range.mark) {
      const nextSelection =
        Selection.findFrom(state.doc.resolve(range.to), 1, true) ??
        TextSelection.create(state.tr.doc, 0);
      dispatch?.(
        state.tr
          .setSelection(nextSelection)
          .removeMark(range.from, range.to, state.schema.marks.tooltip)
          .addMark(
            range.from,
            range.to,
            state.schema.marks.tooltip.create(attrs)
          )
      );
      return true;
    }
    return false;
  };

/**
 * Removes the tooltip mark covering the current selection.
 */
export const removeTooltip = (): Command => (state, dispatch) => {
  if (!(state.selection instanceof TextSelection)) {
    return false;
  }
  const range = getMarkRange(state.selection.$from, state.schema.marks.tooltip);
  if (range && range.mark) {
    const nextSelection =
      Selection.findFrom(state.doc.resolve(range.to), 1, true) ??
      TextSelection.create(state.tr.doc, 0);
    dispatch?.(
      state.tr
        .setSelection(nextSelection)
        .removeMark(range.from, range.to, range.mark)
    );
    return true;
  }
  return false;
};
