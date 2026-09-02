import { describe, expect, test } from "bun:test";
import { Document } from "./document.ts";
import { createDocumentCache, type CacheDeps } from "./document-cache.ts";
import { mountRoot, vfsJoin, type VfsPath } from "./vfs-path.ts";

const root = mountRoot("workspace");
const MINUTE = 60_000;

type Harness = {
  cache: ReturnType<typeof createDocumentCache>;
  disk: Map<VfsPath, string>;
  /** Stand-in for the host journal, keyed by document key. */
  journal: Map<string, string>;
  visible: Set<string>;
  reads: VfsPath[];
};

function harness(options: Parameters<typeof createDocumentCache>[1] = {}): Harness {
  const disk = new Map<VfsPath, string>();
  const journal = new Map<string, string>();
  const visible = new Set<string>();
  const reads: VfsPath[] = [];

  const deps: CacheDeps = {
    async load(doc) {
      if (!doc.path) return false;
      reads.push(doc.path);
      const content = disk.get(doc.path);
      if (content === undefined) return false;
      // Mirrors the app: a document that went cold dirty comes back dirty, from
      // the journal rather than from the file.
      if (doc.revivesFromJournal) {
        const journalled = journal.get(doc.key);
        if (journalled === undefined) return false;
        doc.restoreDirty(journalled, 42);
        return true;
      }
      doc.restore(content, 42);
      return true;
    },
    isVisible: (id) => visible.has(id),
  };

  return { cache: createDocumentCache(deps, options), disk, journal, visible, reads };
}

function openFile(h: Harness, name: string, content: string): Document {
  const path = vfsJoin(root, name);
  h.disk.set(path, content);
  const doc = new Document({ path, name, content });
  h.cache.touch(doc);
  return doc;
}

describe("idle eviction", () => {
  test("a clean file goes cold after the timeout", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");

    // Just under thirty minutes: still loaded.
    expect(await h.cache.sweep(Date.now() + 29 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);

    expect(await h.cache.sweep(Date.now() + 31 * MINUTE)).toBe(1);
    expect(doc.isCold).toBe(true);
    expect(h.cache.entry(doc.id)?.state).toBe("cold");
  });

  test("touching a file resets its idle clock", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");

    h.cache.touch(doc);
    expect(await h.cache.sweep(Date.now() + 29 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);
  });

  test("zero minutes means never unload rather than unload immediately", async () => {
    const h = harness({ idleTimeoutMs: 0 });
    const doc = openFile(h, "a.ts", "hello");

    expect(await h.cache.sweep(Date.now() + 10_000 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);
  });
});

describe("what is never evicted", () => {
  test("a file with unsaved, unjournalled changes is pinned", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    doc.buffer.insert(0, "edited ");
    expect(doc.isDirty).toBe(true);
    expect(doc.isRecoverable).toBe(false);

    expect(await h.cache.sweep(Date.now() + 31 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);
    // And the direct path refuses too, not only the sweep.
    expect(h.cache.evict(doc)).toBe(false);
  });

  test("an untitled buffer is pinned — there is nothing to read back", async () => {
    const h = harness();
    const doc = new Document({ name: "untitled-1", content: "notes" });
    h.cache.touch(doc);

    expect(await h.cache.sweep(Date.now() + 31 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);
    expect(h.cache.evict(doc)).toBe(false);
  });

  test("a file on screen is never idle, however long it has been open", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    h.visible.add(doc.id);

    expect(await h.cache.sweep(Date.now() + 120 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);

    h.visible.delete(doc.id);
    expect(await h.cache.sweep(Date.now() + 120 * MINUTE)).toBe(1);
    expect(doc.isCold).toBe(true);
  });
});

describe("cold loading back", () => {
  test("reviving restores the contents", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello world");
    await h.cache.sweep(Date.now() + 31 * MINUTE);
    expect(doc.isCold).toBe(true);

    await h.cache.warm(doc);
    expect(doc.isCold).toBe(false);
    expect(doc.buffer.getText()).toBe("hello world");
    expect(doc.isDirty).toBe(false);
    expect(h.cache.entry(doc.id)?.state).toBe("active");
  });

  test("caret and scroll survive the round trip", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello world");
    doc.carets.set("pane-1", 6);
    doc.scrollTops.set("pane-1", 120);

    await h.cache.sweep(Date.now() + 31 * MINUTE);
    await h.cache.warm(doc);

    expect(doc.carets.get("pane-1")).toBe(6);
    expect(doc.scrollTops.get("pane-1")).toBe(120);
  });

  test("a caret past the end of a shrunken file is clamped", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello world");
    doc.carets.set("pane-1", 11);

    await h.cache.sweep(Date.now() + 31 * MINUTE);
    h.disk.set(vfsJoin(root, "a.ts"), "hi");
    await h.cache.warm(doc);

    expect(doc.carets.get("pane-1")).toBe(2);
  });

  test("warming a loaded file does not re-read it", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");

    await h.cache.warm(doc);
    expect(h.reads).toEqual([]);
  });

  test("two panes warming at once read the file once", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    await h.cache.sweep(Date.now() + 31 * MINUTE);

    await Promise.all([h.cache.warm(doc), h.cache.warm(doc), h.cache.warm(doc)]);
    expect(h.reads).toHaveLength(1);
  });

  test("a file deleted while cold reports rather than reviving empty", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    await h.cache.sweep(Date.now() + 31 * MINUTE);
    h.disk.delete(vfsJoin(root, "a.ts"));

    await expect(h.cache.warm(doc)).rejects.toThrow(/could not be reloaded/);
    expect(doc.isCold).toBe(true);
  });

  test("a cold document refuses to hand out its buffer", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    await h.cache.sweep(Date.now() + 31 * MINUTE);

    // The alternative — an empty buffer — renders as an empty file and can be
    // saved over the real contents, so this has to throw.
    expect(() => doc.buffer).toThrow(/cold/);
  });
});

describe("journalled dirty documents", () => {
  /** What the app does on a debounce: record the edits, then mark them safe. */
  const journalIt = (h: Harness, doc: Document) => {
    h.journal.set(doc.key, doc.buffer.getText());
    doc.journalled = true;
  };

  test("a dirty file may go cold once its edits are journalled", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    doc.buffer.insert(0, "edited ");
    journalIt(h, doc);

    expect(doc.isRecoverable).toBe(true);
    expect(await h.cache.sweep(Date.now() + 31 * MINUTE)).toBe(1);
    expect(doc.isCold).toBe(true);
  });

  test("it revives with the edits, still dirty", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    doc.buffer.insert(0, "edited ");
    journalIt(h, doc);
    await h.cache.sweep(Date.now() + 31 * MINUTE);

    await h.cache.warm(doc);
    expect(doc.isCold).toBe(false);
    expect(doc.buffer.getText()).toBe("edited hello");
    // The whole point: the edits are back AND still unsaved.
    expect(doc.isDirty).toBe(true);
  });

  test("it revives from the journal, not from the file", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    doc.buffer.insert(0, "edited ");
    journalIt(h, doc);
    await h.cache.sweep(Date.now() + 31 * MINUTE);

    // The file still holds the old text. Reviving must not return it.
    expect(h.disk.get(vfsJoin(root, "a.ts"))).toBe("hello");
    await h.cache.warm(doc);
    expect(doc.buffer.getText()).not.toBe("hello");
  });

  test("a new edit un-journals the document until the next write lands", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    doc.buffer.insert(0, "edited ");
    journalIt(h, doc);

    // The app clears this on every keystroke; the buffer is briefly sole copy.
    doc.buffer.insert(0, "more ");
    doc.journalled = false;

    expect(doc.isRecoverable).toBe(false);
    expect(await h.cache.sweep(Date.now() + 31 * MINUTE)).toBe(0);
    expect(doc.isCold).toBe(false);
  });

  test("a lost journal entry refuses rather than serving the saved file", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    doc.buffer.insert(0, "edited ");
    journalIt(h, doc);
    await h.cache.sweep(Date.now() + 31 * MINUTE);

    h.journal.delete(doc.key);
    // Returning "hello" here would look like success and silently discard the
    // user's edits, which is worse than an error.
    await expect(h.cache.warm(doc)).rejects.toThrow(/could not be reloaded/);
  });

  test("an untitled buffer stays pinned even when journalled content exists", async () => {
    const h = harness();
    const doc = new Document({ name: "untitled-1", content: "notes" });
    h.cache.touch(doc);
    doc.buffer.insert(0, "more ");
    // Untitled and dirty but not marked journalled: nothing to read back from.
    expect(doc.isRecoverable).toBe(false);
    expect(await h.cache.sweep(Date.now() + 31 * MINUTE)).toBe(0);
  });
});

describe("the active cap", () => {
  test("drops the least recently used once over the limit", async () => {
    const h = harness({ maxActive: 2 });
    const a = openFile(h, "a.ts", "a");
    const b = openFile(h, "b.ts", "b");
    const c = openFile(h, "c.ts", "c");

    // Re-touch in a known order so "least recently used" is unambiguous.
    h.cache.touch(a);
    h.cache.touch(b);
    h.cache.touch(c);

    await h.cache.sweep();
    expect(h.cache.activeCount).toBe(2);
    expect(a.isCold).toBe(true);
    expect(b.isCold).toBe(false);
    expect(c.isCold).toBe(false);
  });

  test("the cap never overrides the dirty rule", async () => {
    const h = harness({ maxActive: 1 });
    const a = openFile(h, "a.ts", "a");
    const b = openFile(h, "b.ts", "b");
    a.buffer.insert(0, "edited ");

    await h.cache.sweep();
    expect(a.isCold).toBe(false);
    expect(b.isCold).toBe(true);
  });
});

describe("bookkeeping", () => {
  test("forget drops a closed document's entry", () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");
    expect(h.cache.entry(doc.id)).not.toBeNull();

    h.cache.forget(doc.id);
    expect(h.cache.entry(doc.id)).toBeNull();
  });

  test("configure applies a changed timeout to documents already tracked", async () => {
    const h = harness();
    const doc = openFile(h, "a.ts", "hello");

    h.cache.configure({ idleTimeoutMs: 5 * MINUTE });
    expect(await h.cache.sweep(Date.now() + 6 * MINUTE)).toBe(1);
    expect(doc.isCold).toBe(true);
  });
});
