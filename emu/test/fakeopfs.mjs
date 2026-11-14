// An Origin Private File System in memory, for the node tests of web/opfs.mjs (test_web.mjs, and test/workershim.mjs
// when its env names one): directories and files with the calls web/opfs.mjs makes (getDirectoryHandle,
// getFileHandle, removeEntry, keys, createSyncAccessHandle, getFile), a missing entry a NotFoundError as a browser's.
// installFakeOpfs(root) puts navigator.storage.getDirectory and FileSystemFileHandle on globalThis and returns a
// function that puts back what was there.
class NotFound extends Error { get name() { return 'NotFoundError'; } }

export class FakeFile {
  constructor(bytes = new Uint8Array(0)) { this.bytes = bytes; }
  async createSyncAccessHandle() {
    const f = this;
    return {
      truncate(n) { f.bytes = f.bytes.slice(0, n); },
      write(b, { at = 0 } = {}) { const out = new Uint8Array(Math.max(f.bytes.length, at + b.length)); out.set(f.bytes); out.set(b, at); f.bytes = out; return b.length; },
      flush() {}, close() {},
    };
  }
  async getFile() { return new Blob([this.bytes]); }
}

export class FakeDir {
  constructor() { this.entries = new Map(); }
  _get(name, create, Kind) {
    let e = this.entries.get(name);
    if (e === undefined) {
      if (!create) throw new NotFound(`${name}: not found`);
      this.entries.set(name, e = new Kind());
    }
    if (!(e instanceof Kind)) throw new TypeError(`${name}: not a ${Kind.name}`);
    return e;
  }
  async getDirectoryHandle(name, { create = false } = {}) { return this._get(name, create, FakeDir); }
  async getFileHandle(name, { create = false } = {}) { return this._get(name, create, FakeFile); }
  async removeEntry(name) { if (!this.entries.delete(name)) throw new NotFound(`${name}: not found`); }
  async *keys() { yield* [...this.entries.keys()]; }
  // test helpers: {'dir/file': text} in, and the same out
  seed(files) {
    for (const [p, text] of Object.entries(files)) {
      const [d, f] = p.split('/');
      const dir = this.entries.get(d) ?? new FakeDir();
      this.entries.set(d, dir);
      dir.entries.set(f, new FakeFile(new TextEncoder().encode(text)));
    }
    return this;
  }
  dump() {
    const out = {};
    for (const [d, dir] of this.entries) for (const [f, file] of dir.entries ?? []) out[`${d}/${f}`] = new TextDecoder().decode(file.bytes);
    return out;
  }
}

export function installFakeOpfs(root = new FakeDir()) {
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), fh = Object.getOwnPropertyDescriptor(globalThis, 'FileSystemFileHandle');
  Object.defineProperty(globalThis, 'navigator', { value: { storage: { getDirectory: async () => root } }, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'FileSystemFileHandle', { value: FakeFile, configurable: true, writable: true });
  return () => {
    for (const [k, d] of [['navigator', nav], ['FileSystemFileHandle', fh]]) {
      if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
    }
  };
}
