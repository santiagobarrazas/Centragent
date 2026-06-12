// Caret pixel coordinates inside a <textarea>, via the "mirror div" technique:
// clone the textarea's box into a hidden div, place a marker span at the caret,
// and read its offset. Returns coords relative to the textarea's padding box.
// The caller must subtract textarea.scrollTop / scrollLeft.

const COPIED_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize"
] as const;

export type CaretCoords = { top: number; left: number; height: number };

export function getCaretCoordinates(
  element: HTMLTextAreaElement,
  position: number
): CaretCoords {
  const div = document.createElement("div");
  div.setAttribute("aria-hidden", "true");
  document.body.appendChild(div);

  const style = div.style;
  const computed = window.getComputedStyle(element);
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";
  for (const prop of COPIED_PROPS) {
    const kebab = prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    style.setProperty(kebab, computed.getPropertyValue(kebab));
  }

  div.textContent = element.value.slice(0, position);
  const span = document.createElement("span");
  span.textContent = element.value.slice(position) || ".";
  div.appendChild(span);

  const coords: CaretCoords = {
    top: span.offsetTop + Number.parseInt(computed.borderTopWidth || "0", 10),
    left: span.offsetLeft + Number.parseInt(computed.borderLeftWidth || "0", 10),
    height: Number.parseInt(computed.lineHeight || "18", 10)
  };

  document.body.removeChild(div);
  return coords;
}
