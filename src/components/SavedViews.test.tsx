import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/oppdrag",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) =>
    createElement("a", { href, ...rest }, children),
}));

import SavedViews, {
  addSavedView,
  createSavedViewsStore,
  normalizeQuery,
  parseSavedViews,
  readSavedViews,
  removeSavedView,
  SAVED_VIEWS_LIMIT,
  savedViewHref,
  writeSavedViews,
  type SavedView,
} from "./SavedViews";

const KEY = "fsm:saved-views:test";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    raw: (key: string) => map.get(key) ?? null,
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("localStorage er blokkert");
  },
  setItem: () => {
    throw new Error("localStorage er blokkert");
  },
  removeItem: () => {
    throw new Error("localStorage er blokkert");
  },
};

const labels = {
  heading: "Lagrede visninger",
  save: "Lagre visning",
  nameLabel: "Navn på visningen",
  namePlaceholder: "F.eks. forfalte i Oslo",
  cancel: "Avbryt",
  nameRequired: "Visningen må ha et navn.",
  deleteView: "Slett visningen {name}",
};

describe("parseSavedViews", () => {
  it("gir tom liste for tom og korrupt lagring", () => {
    expect(parseSavedViews(null)).toEqual([]);
    expect(parseSavedViews("")).toEqual([]);
    expect(parseSavedViews("{ikke json")).toEqual([]);
    expect(parseSavedViews('{"navn":"x","query":"?q=x"}')).toEqual([]);
    expect(parseSavedViews("[1,2,3]")).toEqual([]);
  });

  it("dropper oppføringer som mangler navn eller query", () => {
    const raw = JSON.stringify([
      { navn: "Gyldig", query: "?q=x" },
      { navn: "", query: "?q=tomt-navn" },
      { navn: "Uten query" },
      { query: "?q=uten-navn" },
      null,
    ]);
    expect(parseSavedViews(raw)).toEqual([{ navn: "Gyldig", query: "?q=x" }]);
  });

  it("normaliserer query uten ledende spørsmålstegn", () => {
    const raw = JSON.stringify([{ navn: "Uten ?", query: "q=abc" }]);
    expect(parseSavedViews(raw)).toEqual([{ navn: "Uten ?", query: "?q=abc" }]);
    expect(normalizeQuery("  ")).toBe("");
    expect(normalizeQuery("?vis=apne")).toBe("?vis=apne");
  });
});

describe("addSavedView", () => {
  it("avviser tomt navn uten å endre listen", () => {
    const start: SavedView[] = [{ navn: "Før", query: "?q=a" }];
    expect(addSavedView(start, "   ", "?q=b")).toBe(start);
  });

  it("legger nyeste først", () => {
    const afterFirst = addSavedView([], "En", "?q=1");
    const afterSecond = addSavedView(afterFirst, "To", "?q=2");
    expect(afterSecond.map((view) => view.navn)).toEqual(["To", "En"]);
  });

  it("beholder maks åtte visninger", () => {
    let views: SavedView[] = [];
    for (let index = 0; index < SAVED_VIEWS_LIMIT + 3; index += 1) {
      views = addSavedView(views, `Visning ${index}`, `?q=${index}`);
    }
    expect(views).toHaveLength(SAVED_VIEWS_LIMIT);
    expect(views[0].navn).toBe(`Visning ${SAVED_VIEWS_LIMIT + 2}`);
    expect(views.some((view) => view.navn === "Visning 0")).toBe(false);
  });

  it("erstatter samme navn i stedet for å duplisere", () => {
    const views = addSavedView(
      addSavedView([], "Oslo", "?q=gammel"),
      "Oslo",
      "?q=ny",
    );
    expect(views).toHaveLength(1);
    expect(views[0].query).toBe("?q=ny");
  });
});

describe("lagring", () => {
  it("lagrer, lister og sletter en visning", () => {
    const storage = fakeStorage();

    expect(writeSavedViews(storage, KEY, addSavedView([], "Forfalte", "?vis=forfalte"))).toBe(true);
    expect(readSavedViews(storage, KEY)).toEqual([
      { navn: "Forfalte", query: "?vis=forfalte" },
    ]);

    const afterRemove = removeSavedView(readSavedViews(storage, KEY), "Forfalte");
    expect(writeSavedViews(storage, KEY, afterRemove)).toBe(true);
    expect(readSavedViews(storage, KEY)).toEqual([]);
  });

  it("tåler korrupt JSON i selve nøkkelen", () => {
    const storage = fakeStorage({ [KEY]: "{ødelagt" });
    expect(readSavedViews(storage, KEY)).toEqual([]);
  });

  it("krasjer ikke når localStorage er utilgjengelig", () => {
    expect(readSavedViews(throwingStorage, KEY)).toEqual([]);
    expect(writeSavedViews(throwingStorage, KEY, [{ navn: "x", query: "" }])).toBe(false);
    expect(readSavedViews(null, KEY)).toEqual([]);
  });
});

describe("savedViewHref", () => {
  it("beholder siden som ble lagret sammen med visningen", () => {
    expect(savedViewHref("/oppdrag", "?vis=alle&side=3")).toBe(
      "/oppdrag?vis=alle&side=3",
    );
  });

  it("arver ikke siden brukeren står på når visningen ikke har en", () => {
    expect(savedViewHref("/kunder", "?q=oslo")).toBe("/kunder?q=oslo");
    expect(savedViewHref("/oppdrag", "")).toBe("/oppdrag");
    expect(savedViewHref("/oppdrag", "vis=apne")).toBe("/oppdrag?vis=apne");
  });
});

describe("SavedViews", () => {
  it("rendrer ingenting på serveren, slik at hydreringen blir lik", () => {
    const html = renderToStaticMarkup(
      createElement(SavedViews, {
        storageKey: KEY,
        currentQuery: "?vis=alle",
        labels,
      }),
    );
    expect(html).toBe("");
  });
});

function fakeWindow(storage: {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}) {
  const listeners = new Set<(event: Event) => void>();
  return {
    localStorage: storage,
    addEventListener: (_type: string, callback: (event: Event) => void) => {
      listeners.add(callback);
    },
    removeEventListener: (_type: string, callback: (event: Event) => void) => {
      listeners.delete(callback);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) listener(event);
      return true;
    },
  };
}

describe("createSavedViewsStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("er tom på serveren og leser lagrede visninger i nettleseren", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", fakeWindow(storage));

    const store = createSavedViewsStore(KEY);
    expect(store.getServerSnapshot()).toEqual({ available: false, views: [] });
    expect(store.getSnapshot()).toEqual({ available: true, views: [] });

    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => {
      seen.push(store.getSnapshot().views.length);
    });

    expect(store.save("Forfalte", "?vis=forfalte")).toBe(true);
    expect(store.getSnapshot().views).toEqual([
      { navn: "Forfalte", query: "?vis=forfalte" },
    ]);

    store.remove("Forfalte");
    expect(store.getSnapshot().views).toEqual([]);
    expect(seen).toEqual([1, 0]);

    unsubscribe();
  });

  it("skriver ikke når navnet er tomt", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", fakeWindow(storage));

    const store = createSavedViewsStore(KEY);
    expect(store.save("   ", "?q=x")).toBe(false);
    expect(storage.raw(KEY)).toBeNull();
  });

  it("melder seg utilgjengelig når localStorage kaster", () => {
    vi.stubGlobal("window", fakeWindow(throwingStorage));

    const store = createSavedViewsStore(KEY);
    expect(store.getSnapshot()).toEqual({ available: false, views: [] });
    expect(store.save("Visning", "?q=x")).toBe(false);
  });
});