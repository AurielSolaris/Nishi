import { describe, expect, test } from "bun:test";
import { Workspace } from "./workspace.ts";
import { mountRoot, vfsJoin } from "./vfs-path.ts";
import { Settings } from "./settings.ts";

describe("Workspace documents", () => {
  test("opens a document into the active pane and focuses it", () => {
    const ws = new Workspace();
    const doc = ws.open({ name: "a.ts", content: "x" });

    expect(ws.activeDocument).toBe(doc);
    expect(ws.activePane.tabs).toEqual([doc.id]);
    expect(ws.paneCount).toBe(1);
  });

  test("finds an already-open document by path", () => {
    const ws = new Workspace();
    const root = mountRoot("workspace");
    const a = vfsJoin(root, "a.ts");
    const b = vfsJoin(root, "b.ts");
    const doc = ws.open({ path: a, name: "a.ts" });

    expect(ws.documentForPath(a)).toBe(doc);
    expect(ws.documentForPath(b)).toBeNull();
  });

  test("closing activates the left-hand neighbour", () => {
    const ws = new Workspace();
    const a = ws.open({ name: "a" });
    const b = ws.open({ name: "b" });
    const c = ws.open({ name: "c" });

    ws.activateTab(ws.activePane.id, b.id);
    ws.closeTab(ws.activePane.id, b.id);

    expect(ws.activeDocument?.id).toBe(a.id);
    expect(ws.activePane.tabs).toEqual([a.id, c.id]);
  });

  test("closing the last tab leaves the pane empty, not gone", () => {
    const ws = new Workspace();
    const a = ws.open({ name: "a" });
    ws.closeTab(ws.activePane.id, a.id);

    expect(ws.paneCount).toBe(1);
    expect(ws.activeDocument).toBeNull();
    expect(ws.document(a.id)).toBeNull();
  });

  test("tracks dirty documents", () => {
    const ws = new Workspace();
    const a = ws.open({ name: "a", content: "one" });
    expect(ws.dirtyDocuments).toHaveLength(0);

    a.buffer.insert(0, "x");
    expect(ws.dirtyDocuments).toHaveLength(1);

    a.markSaved();
    expect(ws.dirtyDocuments).toHaveLength(0);
  });
});

describe("Workspace panes", () => {
  test("splitting carries the active document into the new pane", () => {
    const ws = new Workspace();
    const doc = ws.open({ name: "a" });
    const pane = ws.split();

    expect(ws.paneCount).toBe(2);
    expect(pane.tabs).toEqual([doc.id]);
    expect(ws.activePane.id).toBe(pane.id);
  });

  test("both panes share one document, so edits are shared", () => {
    const ws = new Workspace();
    const doc = ws.open({ name: "a", content: "hello" });
    ws.split();

    const [left, right] = ws.state.panes;
    const leftDoc = ws.document(left!.activeDocId!);
    const rightDoc = ws.document(right!.activeDocId!);

    expect(leftDoc).toBe(rightDoc);
    doc.buffer.insert(5, " world");
    expect(rightDoc!.buffer.getText()).toBe("hello world");
  });

  test("closing a tab in one pane keeps the document alive in the other", () => {
    const ws = new Workspace();
    const doc = ws.open({ name: "a" });
    ws.split();
    const [left, right] = ws.state.panes;

    ws.closeTab(right!.id, doc.id);
    expect(ws.document(doc.id)).not.toBeNull();

    ws.closeTab(left!.id, doc.id);
    expect(ws.document(doc.id)).toBeNull();
  });

  test("emptying a split pane collapses it", () => {
    const ws = new Workspace();
    const doc = ws.open({ name: "a" });
    ws.split();
    expect(ws.paneCount).toBe(2);

    ws.closeTab(ws.activePane.id, doc.id);
    expect(ws.paneCount).toBe(1);
  });

  test("the last pane cannot be closed", () => {
    const ws = new Workspace();
    ws.open({ name: "a" });
    ws.closePane(ws.activePane.id);
    expect(ws.paneCount).toBe(1);
  });

  test("focus cycles through panes", () => {
    const ws = new Workspace();
    ws.open({ name: "a" });
    ws.split();
    const [first, second] = ws.state.panes;

    ws.activatePane(first!.id);
    ws.focusNextPane();
    expect(ws.activePane.id).toBe(second!.id);
    ws.focusNextPane();
    expect(ws.activePane.id).toBe(first!.id);
  });

  test("split views keep independent carets", () => {
    const ws = new Workspace();
    const doc = ws.open({ name: "a", content: "0123456789" });
    ws.split();
    const [left, right] = ws.state.panes;

    doc.carets.set(left!.id, 2);
    doc.carets.set(right!.id, 8);

    expect(doc.carets.get(left!.id)).toBe(2);
    expect(doc.carets.get(right!.id)).toBe(8);
  });

  test("subscribers are notified and can unsubscribe", () => {
    const ws = new Workspace();
    let calls = 0;
    const stop = ws.subscribe(() => calls++);
    expect(calls).toBe(1); // fires immediately

    ws.open({ name: "a" });
    expect(calls).toBe(2);

    stop();
    ws.open({ name: "b" });
    expect(calls).toBe(2);
  });
});

describe("Settings", () => {
  test("starts from schema defaults", () => {
    const s = new Settings();
    expect(s.get<number>("editor.tabSize")).toBe(2);
    expect(s.get<boolean>("editor.wordWrap")).toBe(false);
  });

  test("coerces and clamps stored values", () => {
    const s = new Settings({ "editor.fontSize": 999, "editor.tabSize": "4" });
    expect(s.get<number>("editor.fontSize")).toBe(32); // max
    expect(s.get<number>("editor.tabSize")).toBe(4);
  });

  test("ignores unknown keys and bad enums", () => {
    const s = new Settings({ "nope.nothing": 1, "workbench.splitDirection": "diagonal" });
    expect(s.all["nope.nothing"]).toBeUndefined();
    expect(s.get<string>("workbench.splitDirection")).toBe("vertical");
  });

  test("persists only non-default values", () => {
    const s = new Settings();
    expect(s.toJSON()).toEqual({});

    s.set("editor.tabSize", 4);
    expect(s.toJSON()).toEqual({ "editor.tabSize": 4 });

    s.reset("editor.tabSize");
    expect(s.toJSON()).toEqual({});
  });

  test("notifies subscribers only on real changes", () => {
    const s = new Settings();
    let calls = 0;
    s.subscribe(() => calls++);
    expect(calls).toBe(1);

    s.set("editor.tabSize", 4);
    expect(calls).toBe(2);

    s.set("editor.tabSize", 4); // same value
    expect(calls).toBe(2);
  });
});
