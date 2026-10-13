// Decoraciones del editor (sólo visual, no cambian el documento):
// - #etiqueta se muestra como .tag dentro del texto.
// - Los bloques con tarjeta inline (#tarjeta y ::) reciben la clase uc-card-block (ícono al costado).

import { createExtension } from "@blocknote/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isCardText } from "@/lib/notes/cards";
import { CARD_MARKER, normalizeTag, tagRegex } from "@/lib/notes/index-note";

export const notesDecorations = createExtension({
  key: "uc-notas-decoraciones",
  prosemirrorPlugins: [
    new Plugin({
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.isText && node.text) {
              for (const m of node.text.matchAll(tagRegex())) {
                if (normalizeTag(m[1]) === CARD_MARKER) continue;
                const start = pos + (m.index ?? 0);
                decos.push(Decoration.inline(start, start + m[0].length, { class: "tag uc-tag" }));
              }
              return false;
            }
            if (node.type.name === "blockContainer") {
              const own = node.firstChild?.textContent ?? "";
              if (isCardText(own)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "uc-card-block" }));
            }
            return true;
          });
          return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
        },
      },
    }),
  ],
});
