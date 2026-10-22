// The models as the player pages show them, from src/fw/models.mjs MODELS (the one list of the models and their names):
// GET /api/model's document (src/lab/playapi.mjs: the play server's model) and the model picker of web/play.html and
// web/index.html. It imports MODELS only, not src/fw/model.mjs, so the browser page can still list the models when its
// ?model= names none (model.mjs throws then).
import { MODELS } from './models.mjs';

// 'OM-5 (E144) v1.2'
export const modelLabel = (code) => `${MODELS[code].name} (${code}) v${MODELS[code].version}`;
// the picker's entries, in MODELS order
export const MODEL_LIST = Object.entries(MODELS).map(([c, m]) => ({ model: c, name: m.name, version: m.version, label: modelLabel(c) }));
// {model, name, version, bin, label, models: MODEL_LIST}
export function modelDoc(code) {
  const m = MODELS[code];
  return { model: code, name: m.name, version: m.version, bin: m.bin, label: modelLabel(code), models: MODEL_LIST };
}
