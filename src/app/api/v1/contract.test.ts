import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "./openapi.json/route";

/**
 * Kontraktsvakt for det offentlige v1-API-et.
 *
 * Testen sammenligner tre kilder som må fortelle samme historie:
 *   1. rutefilene under `src/app/api/v1` (det som faktisk kan kalles),
 *   2. OpenAPI-dokumentet som serveres på `/api/v1/openapi.json`, og
 *   3. den menneskelige dokumentasjonen i `docs/API.md`.
 *
 * `docs/api-contract-baseline.json` er den deterministiske snapshoten. Når en
 * rute eller kontrakt endres med vilje, regenererer du den med:
 *
 *   UPDATE_API_CONTRACT_BASELINE=1 npx vitest run src/app/api/v1/contract.test.ts
 *
 * Da feiler testen til noen har oppdatert både spec, dokumentasjon og baseline
 * – en ny rute kan ikke snike seg inn uten å bli dokumentert.
 */

const API_ROOT = join(process.cwd(), "src/app/api/v1");
const BASELINE_FILE = join(process.cwd(), "docs/api-contract-baseline.json");
const DOCS_FILE = join(process.cwd(), "docs/API.md");

const METHODS = ["GET", "POST", "PATCH", "DELETE", "PUT"] as const;
type Method = (typeof METHODS)[number];

type OperationBaseline = {
  parameters: string[];
  responses: string[];
};

type ContractBaseline = {
  paths: Record<string, Partial<Record<Method, OperationBaseline>>>;
};

type OpenApiParameter = {
  $ref?: string;
  name?: string;
  in?: string;
};

type OpenApiOperation = {
  parameters?: OpenApiParameter[];
  responses?: Record<string, unknown>;
};

type OpenApiPathItem = Partial<Record<Lowercase<Method>, OpenApiOperation>> & {
  parameters?: OpenApiParameter[];
};

const openApi = openApiDocument as unknown as {
  paths: Record<string, OpenApiPathItem>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
  };
};

function sortedObject<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function routeFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const absolute = join(directory, entry);
      if (statSync(absolute).isDirectory()) return routeFiles(absolute);
      return entry === "route.ts" ? [absolute] : [];
    })
    .sort();
}

function routePath(file: string): string {
  const segment = relative(API_ROOT, file)
    .split(sep)
    .slice(0, -1)
    .join("/");
  return `/${segment}`.replace(/\[(\w+)\]/g, "{$1}");
}

function routeMethods(file: string): Method[] {
  const source = readFileSync(file, "utf8");
  return METHODS.filter((method) =>
    new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(source),
  );
}

function discoveredRoutes(): ContractBaseline["paths"] {
  const paths: ContractBaseline["paths"] = {};
  for (const file of routeFiles(API_ROOT)) {
    // Speilruta er dokumentert i seg selv og inngår ikke i tabellen.
    if (routePath(file) === "/openapi.json") continue;
    const path = routePath(file);
    paths[path] ??= {};
    for (const method of routeMethods(file)) {
      paths[path][method] = { parameters: [], responses: [] };
    }
  }
  return paths;
}

function resolveParameter(parameter: OpenApiParameter): string | null {
  if (parameter.$ref) {
    const key = parameter.$ref.split("/").pop() ?? "";
    return openApi.components?.parameters?.[key]?.name ?? null;
  }
  return parameter.name ?? null;
}

function specOperations(): ContractBaseline["paths"] {
  const paths: ContractBaseline["paths"] = {};
  for (const [path, item] of Object.entries(openApi.paths)) {
    const sharedParameters = item.parameters ?? [];
    for (const method of METHODS) {
      const operation = item[method.toLowerCase() as Lowercase<Method>];
      if (!operation) continue;
      const parameters = [...sharedParameters, ...(operation.parameters ?? [])]
        .map(resolveParameter)
        .filter((name): name is string => Boolean(name))
        .sort();
      paths[path] ??= {};
      paths[path][method] = {
        parameters,
        responses: Object.keys(operation.responses ?? {}).sort(),
      };
    }
  }
  return paths;
}

function normalize(paths: ContractBaseline["paths"]): string {
  const normalized: ContractBaseline["paths"] = {};
  for (const [path, operations] of Object.entries(paths)) {
    normalized[path] = sortedObject(
      Object.entries(operations).map(([method, operation]) => [
        method,
        {
          parameters: [...(operation?.parameters ?? [])].sort(),
          responses: [...(operation?.responses ?? [])].sort(),
        },
      ]),
    ) as ContractBaseline["paths"][string];
  }
  return JSON.stringify(
    { paths: sortedObject(Object.entries(normalized)) },
    null,
    2,
  ).replace(/\n?$/, "\n");
}

function parseDocs(): {
  table: Map<string, Set<Method>>;
  headings: Map<string, Set<Method>>;
  sections: Map<string, string>;
} {
  const text = readFileSync(DOCS_FILE, "utf8");
  const table = new Map<string, Set<Method>>();
  const headings = new Map<string, Set<Method>>();
  const sections = new Map<string, string>();

  for (const line of text.split("\n")) {
    const row = line.match(
      /^\|\s*`(GET|POST|PATCH|DELETE|PUT)`\s*\|\s*`([^`]+)`\s*\|/,
    );
    if (!row) continue;
    const method = row[1] as Method;
    const path = row[2];
    table.set(path, new Set([...(table.get(path) ?? []), method]));
  }

  const headingPattern =
    /^###\s+`((?:GET|POST|PATCH|DELETE|PUT)(?:\/(?:GET|POST|PATCH|DELETE|PUT))*)\s+([^`]+)`/gm;
  const matches = [...text.matchAll(headingPattern)];
  for (const [index, match] of matches.entries()) {
    const methods = match[1].split("/") as Method[];
    const path = match[2].trim();
    headings.set(path, new Set([...(headings.get(path) ?? []), ...methods]));

    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    for (const method of methods) {
      sections.set(`${method} ${path}`, text.slice(start, end));
    }
  }

  return { table, headings, sections };
}

function compareSets(
  actual: Map<string, Set<Method>> | ContractBaseline["paths"],
  expected: ContractBaseline["paths"],
  label: string,
): void {
  const actualPaths =
    actual instanceof Map
      ? [...actual.keys()].sort()
      : Object.keys(actual).sort();
  const expectedPaths = Object.keys(expected).sort();
  expect(actualPaths, `${label}: rutelisten avviker`).toEqual(expectedPaths);

  for (const path of expectedPaths) {
    const methods =
      actual instanceof Map
        ? [...(actual.get(path) ?? [])].sort()
        : Object.keys(actual[path] ?? {}).sort();
    expect(methods, `${label} ${path}: metodene avviker`).toEqual(
      Object.keys(expected[path] ?? {}).sort(),
    );
  }
}

const baseline = JSON.parse(
  existsSync(BASELINE_FILE) ? readFileSync(BASELINE_FILE, "utf8") : '{"paths":{}}',
) as ContractBaseline;

describe("API-kontrakten", () => {
  it("har en deterministisk baseline for alle ruter", () => {
    if (process.env.UPDATE_API_CONTRACT_BASELINE === "1") {
      writeFileSync(BASELINE_FILE, normalize(specOperations()));
    }

    const routes = discoveredRoutes();
    const expected = baseline.paths;
    expect(Object.keys(routes).sort(), "rutefiler og baseline er ute av sync").toEqual(
      Object.keys(expected).sort(),
    );
    for (const [path, operations] of Object.entries(routes)) {
      expect(
        Object.keys(operations).sort(),
        `${path}: metodene i rutefilen og baseline er ute av sync`,
      ).toEqual(Object.keys(expected[path] ?? {}).sort());
    }
  });

  it("beskriver hver rutemetode i OpenAPI med samme parametere og statuskoder", () => {
    const spec = specOperations();
    expect(
      normalize(spec),
      "OpenAPI og baseline er ute av sync – oppdater specen",
    ).toBe(normalize(baseline.paths));

    for (const [path, operations] of Object.entries(spec)) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(
          operation?.responses?.length ?? 0,
          `${method} ${path}: minst én statuskode må dokumenteres`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("lister hver rutemetode i endepunktstabellen og i en seksjonsoverskrift", () => {
    const docs = parseDocs();
    compareSets(docs.table, baseline.paths, "docs/API.md-tabellen");
    compareSets(docs.headings, baseline.paths, "docs/API.md-overskriftene");
  });

  it("dokumenterer hver query-parameter i seksjonen for endepunktet", () => {
    const docs = parseDocs();
    for (const [path, operations] of Object.entries(baseline.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const queryParameters = (operation?.parameters ?? []).filter(
          (name) => !path.includes(`{${name}}`),
        );
        const section = docs.sections.get(`${method} ${path}`) ?? "";
        expect(section, `${method} ${path}: mangler seksjon`).not.toBe("");
        for (const parameter of queryParameters) {
          expect(
            new RegExp(`\\b${parameter}\\b`).test(section),
            `${method} ${path}: parameteren «${parameter}» er ikke dokumentert`,
          ).toBe(true);
        }
      }
    }
  });

  it("dokumenterer opprettelsesstatus 201 for POST-endepunkter", () => {
    const docs = parseDocs();
    for (const [path, operations] of Object.entries(baseline.paths)) {
      if (!operations.POST) continue;
      expect(
        (docs.sections.get(`POST ${path}`) ?? "").includes("201"),
        `POST ${path}: seksjonen mangler status 201`,
      ).toBe(true);
    }
  });
});
