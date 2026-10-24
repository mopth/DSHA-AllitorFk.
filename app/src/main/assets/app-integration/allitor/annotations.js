// Box-select annotations (c, own implementation): user draws a box over a preview and adds a note;
// the note goes back to the session (composer draft on the client, and/or the agent tool).
import { randomUUID } from 'node:crypto';

export function createAnnotations({ max = 64 } = {}) {
  const list = [];
  const num = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
  return {
    add({ previewId, path, rect, viewport, note }) {
      const text = String(note ?? '').trim().slice(0, 2000);
      if (!text) throw new Error('ANNOTATION_NOTE');
      if (!rect || typeof rect !== 'object') throw new Error('ANNOTATION_RECT');
      const r = { x: num(rect.x), y: num(rect.y), w: num(rect.w), h: num(rect.h) };
      if (r.w < 2 || r.h < 2 || r.w > 20000 || r.h > 20000) throw new Error('ANNOTATION_RECT');
      const a = { id: randomUUID(), previewId: String(previewId ?? '').slice(0, 32), path: String(path ?? '').slice(0, 300),
        rect: r, viewport: { w: num(viewport?.w), h: num(viewport?.h) }, note: text, at: Date.now(), deliveredTo: [] };
      list.push(a); while (list.length > max) list.shift();
      return a;
    },
    /** consumer = 'client' (composer) or 'agent' (MCP tool); each consumer gets each note once */
    take(consumer) {
      const out = list.filter(a => !a.deliveredTo.includes(consumer));
      for (const a of out) a.deliveredTo.push(consumer);
      return out.map(({ deliveredTo, ...a }) => a);
    },
    all() { return list.map(({ deliveredTo, ...a }) => a); },
  };
}

export function annotationText(a) {
  const { x, y, w, h } = a.rect;
  return `【框选批注】预览 ${a.path || '/'} 区域 (x=${x}, y=${y}, w=${w}, h=${h}；视口 ${a.viewport.w}×${a.viewport.h})：${a.note}`;
}
