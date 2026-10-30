// i18n-ignore-file: OpenAPI-titler og -beskrivelser er utviklerdokumentasjon,
// ikke UI-tekst. Selve API-et returnerer stabile koder og messageKey.
import { NextResponse } from "next/server";

/**
 * Maskinlesbar kontrakt for REST-API-et.
 *
 * Spesifikasjonen er offentlig og krever ingen nøkkel, slik at integrasjoner
 * kan generere klienter før de har fått tilgang. Selve API-et under
 * `/api/v1` krever `Authorization: Bearer fsm_...`.
 */
export const dynamic = "force-static";

const nullableString = { type: ["string", "null"] } as const;
const nullableDateTime = {
  type: ["string", "null"],
  format: "date-time",
} as const;

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FSM-plattformen REST API",
    version: "1.0.0",
    summary: "Oppdrag, visiter, kunder, rapporter og dokumenter for FSM-plattformen.",
    description:
      "Alle dataendepunkter under /api/v1 krever en API-nøkkel sendt som " +
      "`Authorization: Bearer fsm_...`. Responser bruker konvolutten " +
      "`{ data, meta? }`; feil bruker `{ error: { code, message, details? } }`. " +
      "Visiter har stabile feilkoder i `details.code` på formen " +
      "`visits.errors.*`. API-et har ingen nettlesersesjon og godtar aldri " +
      "informasjonskapsler.",
    license: { name: "BUSL-1.1", identifier: "BUSL-1.1" },
  },
  servers: [
    {
      url: "/api/v1",
      description: "Samme vert som FSM-installasjonen.",
    },
  ],
  tags: [
    { name: "Auth", description: "Identitet og rettigheter for nøkkelen." },
    { name: "Work orders", description: "Oppdrag og planlegging." },
    {
      name: "Visits",
      description: "Planlagte visiter, flytting, tildeling og status.",
    },
    { name: "Customers", description: "Kunder og kundekort." },
    { name: "Reports", description: "Signerte servicerapporter." },
    { name: "Documents", description: "Dokumentbiblioteket." },
  ],
  security: [{ bearerAuth: [] }],
  paths: {
    "/me": {
      get: {
        tags: ["Auth"],
        operationId: "getMe",
        summary: "Hvem nøkkelen handler som",
        description:
          "Returnerer brukeren som eier nøkkelen, avdelingen og de effektive " +
          "rettighetene. Nøkkelen arver rettighetene til brukeren.",
        responses: {
          "200": {
            description: "Identitet og rettigheter.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: { data: { $ref: "#/components/schemas/Me" } },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/work-orders": {
      get: {
        tags: ["Work orders"],
        operationId: "listWorkOrders",
        summary: "List oppdrag",
        description:
          "Oppdrag brukeren har tilgang til, avgrenset til egen avdeling med " +
          "mindre brukeren er administrator. Myk-slettede oppdrag vises ikke.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "status",
            in: "query",
            description: "Filtrer på oppdragsstatus.",
            schema: {
              type: "string",
              enum: [
                "PLANNED",
                "IN_PROGRESS",
                "WAITING",
                "COMPLETED",
                "CANCELLED",
                "OPEN",
                "PENDING",
              ],
            },
          },
          {
            name: "customerId",
            in: "query",
            description: "Filtrer på kunde.",
            schema: { type: "string" },
          },
          {
            name: "technicianId",
            in: "query",
            description: "Filtrer på tildelt montør.",
            schema: { type: "string" },
          },
          {
            name: "q",
            in: "query",
            description: "Fritekstsøk i tittel og kundenavn.",
            schema: { type: "string" },
          },
          {
            name: "scheduledFrom",
            in: "query",
            description: "Fra og med planlagt dato (ISO 8601, YYYY-MM-DD).",
            schema: { type: "string", format: "date" },
          },
          {
            name: "scheduledTo",
            in: "query",
            description: "Til og med planlagt dato (ISO 8601, YYYY-MM-DD).",
            schema: { type: "string", format: "date" },
          },
          {
            name: "updatedSince",
            in: "query",
            description: "Bare oppdrag endret etter dette tidspunktet.",
            schema: { type: "string", format: "date-time" },
          },
        ],
        responses: {
          "200": {
            description: "Side med oppdrag.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WorkOrderList" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Work orders"],
        operationId: "createWorkOrder",
        summary: "Opprett oppdrag",
        description:
          "Oppretter et oppdrag. Krever `workorders.create`. Svarer med " +
          "`Location` til det nye oppdraget.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WorkOrderCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Oppdraget er opprettet.",
            headers: {
              Location: {
                description: "Relativ adresse til det nye oppdraget.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["id"],
                      properties: { id: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": { $ref: "#/components/responses/Conflict" },
          "413": { $ref: "#/components/responses/PayloadTooLarge" },
          "422": { $ref: "#/components/responses/ValidationError" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/work-orders/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Work orders"],
        operationId: "getWorkOrder",
        summary: "Hent oppdrag",
        description:
          "Detaljert oppdrag innenfor brukerens avdeling. Ukjente eller " +
          "utilgjengelige oppdrag gir 404, slik at omfanget ikke lekker.",
        responses: {
          "200": {
            description: "Oppdraget.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/WorkOrderDetail" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      patch: {
        tags: ["Work orders"],
        operationId: "updateWorkOrder",
        summary: "Endre status eller dato",
        description:
          "Oppdaterer status og/eller planlagte datoer. Krever " +
          "`workorders.update`. Minst ett kjent felt må sendes. Låste " +
          "oppdrag og bevaringsplikt gir 409.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WorkOrderPatch" },
            },
          },
        },
        responses: {
          "200": {
            description: "Oppdatert oppdrag.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/WorkOrderSummary" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "413": { $ref: "#/components/responses/PayloadTooLarge" },
          "422": { $ref: "#/components/responses/ValidationError" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/work-orders/{id}/visits": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Visits"],
        operationId: "listWorkOrderVisits",
        summary: "List visiter på et oppdrag",
        description:
          "Visiter på oppdraget, sortert på starttidspunkt. Krever " +
          "`workorders.view` og at oppdraget ligger i brukerens omfang. " +
          "Listen er paginert med maks 100 rader per side.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description: "Side med visiter.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/VisitList" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Visits"],
        operationId: "createWorkOrderVisit",
        summary: "Opprett visitt",
        description:
          "Oppretter en visitt på oppdraget. Krever `workorders.edit`. " +
          "`startsAt` og `endsAt` er ISO 8601 med klokkeslett, og slutten må " +
          "ligge etter starten. Overlapp, ugyldige montører, bevaringsplikt og " +
          "låst oppdrag avvises med `details.code` fra `visits.errors.*`. " +
          "Svarer med `Location` til den nye visitten.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VisitCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Visitten er opprettet.",
            headers: {
              Location: {
                description: "Relativ adresse til den nye visitten.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["id"],
                      properties: { id: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/VisitConflict" },
          "413": { $ref: "#/components/responses/PayloadTooLarge" },
          "422": { $ref: "#/components/responses/VisitValidationError" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/visits/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Visits"],
        operationId: "getVisit",
        summary: "Hent visitt",
        description:
          "Visitt med montører og et kort oppdragssammendrag. Krever " +
          "`workorders.view`. Ukjente visiter og visiter utenfor brukerens " +
          "omfang gir 404.",
        responses: {
          "200": {
            description: "Visitten.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/VisitDetail" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      patch: {
        tags: ["Visits"],
        operationId: "updateVisit",
        summary: "Flytt, tildel eller endre visitt",
        description:
          "Endrer én operasjon om gangen. `startsAt` og `endsAt` må sendes " +
          "sammen for flytting (`workorders.assign`); `status` går gjennom " +
          "tilstandsmaskinen (`workorders.update`); `technicianIds` erstatter " +
          "montørlisten (`workorders.assign`); `notes`, `allDay` og `sequence` " +
          "kan kombineres (`workorders.edit`). Blandede operasjoner gir 400. " +
          "Konflikter og feltfeil har `details.code` fra `visits.errors.*`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/VisitPatch" },
            },
          },
        },
        responses: {
          "200": {
            description: "Oppdatert visitt.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/VisitDetail" },
                  },
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/VisitConflict" },
          "413": { $ref: "#/components/responses/PayloadTooLarge" },
          "422": { $ref: "#/components/responses/VisitValidationError" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      delete: {
        tags: ["Visits"],
        operationId: "deleteVisit",
        summary: "Slett visitt",
        description:
          "Sletter visitten permanent. Selve oppdraget og revisjonsloggen " +
          "består. Krever `workorders.edit`, og er sperret av bevaringsplikt " +
          "eller låst oppdrag. Svarer 204 uten body.",
        responses: {
          "204": { description: "Visitten er slettet." },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/VisitConflict" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/customers": {
      get: {
        tags: ["Customers"],
        operationId: "listCustomers",
        summary: "List kunder",
        description:
          "Aktive kunder brukeren har `customers.view` for. Søk dekker navn, " +
          "organisasjonsnummer, kundenummer og sted.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "q",
            in: "query",
            description: "Fritekstsøk i navn, org.nr., kundenummer og sted.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Side med kunder.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CustomerList" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/customers/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Customers"],
        operationId: "getCustomer",
        summary: "Hent kunde",
        description:
          "Kundekort med kontakter, enheter, avtaler og portalbrukere. " +
          "Hemmeligheter som passord og tokens returneres aldri.",
        responses: {
          "200": {
            description: "Kunden.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/CustomerDetail" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/reports": {
      get: {
        tags: ["Reports"],
        operationId: "listReports",
        summary: "List rapporter",
        description:
          "Signerte rapporter innenfor brukerens rapportomfang. Myk-slettede " +
          "rapporter vises ikke.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "customerId",
            in: "query",
            description: "Filtrer på kunde.",
            schema: { type: "string" },
          },
          {
            name: "workOrderId",
            in: "query",
            description: "Filtrer på oppdrag.",
            schema: { type: "string" },
          },
          {
            name: "locked",
            in: "query",
            description: "Filtrer på om rapporten er låst.",
            schema: { type: "boolean" },
          },
          {
            name: "acknowledged",
            in: "query",
            description: "Filtrer på kundekvittering.",
            schema: { type: "boolean" },
          },
          {
            name: "q",
            in: "query",
            description: "Fritekstsøk i rapportnavn, nummer og tittel.",
            schema: { type: "string" },
          },
          {
            name: "from",
            in: "query",
            description: "Fra og med fullføringsdato (YYYY-MM-DD).",
            schema: { type: "string", format: "date" },
          },
          {
            name: "to",
            in: "query",
            description: "Til og med fullføringsdato (YYYY-MM-DD).",
            schema: { type: "string", format: "date" },
          },
        ],
        responses: {
          "200": {
            description: "Side med rapporter.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReportList" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/reports/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Reports"],
        operationId: "getReport",
        summary: "Hent rapport",
        description:
          "Rapportdetaljer med svarene fra skjemaet, enheter, signaturer og " +
          "kundekvittering. Signaturbilder vises bare som trygge " +
          "`/uploads/...`-adresser.",
        responses: {
          "200": {
            description: "Rapporten.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/ReportDetail" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/reports/{id}/pdf": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Reports"],
        operationId: "downloadReportPdf",
        summary: "Last ned rapport som PDF",
        description:
          "Returnerer den ferdige PDF-en. Krever samme rapporttilgang som " +
          "detaljendepunktet. Responsen er `no-store`.",
        responses: {
          "200": {
            description: "PDF-filen.",
            headers: {
              "Content-Disposition": {
                description: "Vedlegg med filnavn.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/pdf": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/documents": {
      get: {
        tags: ["Documents"],
        operationId: "listDocuments",
        summary: "List dokumenter",
        description:
          "Metadata for dokumentbiblioteket. Selve filinnholdet inngår ikke.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "folderId",
            in: "query",
            description: "Filtrer på mappe.",
            schema: { type: "string" },
          },
          {
            name: "tag",
            in: "query",
            description: "Filtrer på dokumenttag.",
            schema: { type: "string" },
          },
          {
            name: "q",
            in: "query",
            description: "Fritekstsøk i tittel og filnavn.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Side med dokumenter.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DocumentList" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/documents/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Documents"],
        operationId: "getDocument",
        summary: "Hent dokumentmetadata",
        description:
          "Metadata, mappesti og versjonsoversikt. Endepunktet returnerer " +
          "ikke filbytes eller interne lagringsstier.",
        responses: {
          "200": {
            description: "Dokumentet.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/DocumentDetail" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "fsm_ API key",
        description:
          "API-nøkkel opprettet i Innstillinger → API-nøkler. Nøkkelen vises " +
          "bare én gang. Den arver rettighetene til brukeren som opprettet den.",
      },
    },
    parameters: {
      Page: {
        name: "page",
        in: "query",
        description: "Sidenummer, starter på 1.",
        schema: { type: "integer", minimum: 1, default: 1 },
      },
      Limit: {
        name: "limit",
        in: "query",
        description: "Antall rader per side. Maks 100.",
        schema: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
      Id: {
        name: "id",
        in: "path",
        required: true,
        description: "Objektets id (cuid).",
        schema: { type: "string" },
      },
    },
    responses: {
      BadRequest: {
        description: "Ugyldig JSON eller forespørsel.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Unauthorized: {
        description: "Manglende, ugyldig, utløpt eller tilbakekalt nøkkel.",
        headers: {
          "WWW-Authenticate": {
            description: "Bearer-utfordring.",
            schema: { type: "string" },
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Forbidden: {
        description: "Nøkkelens bruker mangler nødvendig rettighet.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      NotFound: {
        description: "Objektet finnes ikke eller er utenfor brukerens omfang.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      Conflict: {
        description: "Konflikt med eksisterende data eller låst tilstand.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      ValidationError: {
        description: "Feltvalidering feilet.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      PayloadTooLarge: {
        description: "JSON-body er større enn grensen.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
      VisitConflict: {
        description:
          "Visitten kan ikke endres: overlappende montør, låst oppdrag, " +
          "bevaringsplikt eller avsluttet visitt.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            examples: {
              overlap: {
                summary: "Montøren er allerede booket i tidsrommet.",
                value: {
                  error: {
                    code: "conflict",
                    message: "Visitten kan ikke endres.",
                    details: {
                      code: "visits.errors.overlap",
                      conflicts: [
                        {
                          visitId: "cm_visit",
                          workOrderId: "cm_workorder",
                          startsAt: "2026-11-03T09:00:00.000Z",
                          endsAt: "2026-11-03T11:00:00.000Z",
                          technicianIds: ["cm_user"],
                        },
                      ],
                    },
                  },
                },
              },
              legalHold: {
                summary: "Oppdraget har bevaringsplikt.",
                value: {
                  error: {
                    code: "conflict",
                    message: "Visitten kan ikke endres.",
                    details: { code: "visits.errors.legalHold" },
                  },
                },
              },
              visitLocked: {
                summary: "Visitten er fullført eller kansellert.",
                value: {
                  error: {
                    code: "conflict",
                    message: "Visitten kan ikke endres.",
                    details: { code: "visits.errors.visitLocked" },
                  },
                },
              },
            },
          },
        },
      },
      VisitValidationError: {
        description: "Feltvalidering eller en ulovlig visittoperasjon feilet.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            examples: {
              invalidTimeRange: {
                summary: "Slutten ligger før starten.",
                value: {
                  error: {
                    code: "validation_error",
                    message: "Feltene er ikke gyldige.",
                    details: {
                      field: "endsAt",
                      code: "visits.errors.invalidTimeRange",
                    },
                  },
                },
              },
              statusTransition: {
                summary: "Statusovergangen er ikke lovlig.",
                value: {
                  error: {
                    code: "validation_error",
                    message: "Feltene er ikke gyldige.",
                    details: {
                      code: "visits.errors.statusTransition",
                      from: "DONE",
                      to: "ON_SITE",
                    },
                  },
                },
              },
              invalidTechnician: {
                summary: "Montøren er ikke aktiv i oppdragets avdeling.",
                value: {
                  error: {
                    code: "validation_error",
                    message: "Feltene er ikke gyldige.",
                    details: {
                      code: "visits.errors.invalidTechnician",
                      technicianIds: ["cm_user"],
                    },
                  },
                },
              },
            },
          },
        },
      },
      RateLimited: {
        description: "Mer enn 120 forespørsler per minutt for nøkkelen.",
        headers: {
          "Retry-After": {
            description: "Sekunder til neste forsøk kan prøves.",
            schema: { type: "integer" },
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            enum: [
              "unauthorized",
              "forbidden",
              "not_found",
              "validation_error",
              "conflict",
              "rate_limited",
              "server_error",
            ],
          },
          message: { type: "string" },
          details: {
            description: "Maskinlesbar tilleggsinformasjon når den finnes.",
            oneOf: [
              { type: "object", additionalProperties: true },
              { type: "array", items: { type: "object" } },
              { type: "string" },
            ],
          },
        },
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: { error: { $ref: "#/components/schemas/Error" } },
      },
      Meta: {
        type: "object",
        required: ["page", "limit", "total", "totalPages"],
        properties: {
          page: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          total: { type: "integer", minimum: 0 },
          totalPages: { type: "integer", minimum: 0 },
        },
      },
      Ref: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
      PersonRef: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string" },
          name: nullableString,
          email: nullableString,
        },
      },
      Me: {
        type: "object",
        required: ["id", "name", "email", "role", "department", "permissions"],
        properties: {
          id: { type: "string" },
          name: nullableString,
          email: nullableString,
          role: { type: "string" },
          department: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          permissions: { type: "array", items: { type: "string" } },
          customerId: nullableString,
        },
      },
      WorkOrderSummary: {
        type: "object",
        required: [
          "id",
          "title",
          "status",
          "customer",
          "technicians",
          "department",
          "reportCount",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          orderNumber: nullableString,
          status: {
            type: "string",
            enum: [
              "PLANNED",
              "IN_PROGRESS",
              "WAITING",
              "COMPLETED",
              "CANCELLED",
              "OPEN",
              "PENDING",
            ],
          },
          scheduledFor: {
            type: ["string", "null"],
            format: "date",
          },
          scheduledTo: {
            type: ["string", "null"],
            format: "date",
          },
          customer: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          technicians: {
            type: "array",
            items: { $ref: "#/components/schemas/PersonRef" },
          },
          department: { $ref: "#/components/schemas/Ref" },
          reportCount: { type: "integer", minimum: 0 },
          visits: {
            type: "array",
            description:
              "Opptil 20 visiter, sortert på rekkefølge og starttidspunkt.",
            items: { $ref: "#/components/schemas/VisitSummary" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      WorkOrderDetail: {
        allOf: [
          { $ref: "#/components/schemas/WorkOrderSummary" },
          {
            type: "object",
            properties: {
              description: nullableString,
              address: nullableString,
              postalCode: nullableString,
              city: nullableString,
              contact: {
                oneOf: [
                  {
                    type: "object",
                    required: ["id", "name"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      email: nullableString,
                      phone: nullableString,
                    },
                  },
                  { type: "null" },
                ],
              },
              tags: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    color: nullableString,
                  },
                },
              },
              templates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                  },
                },
              },
              reports: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: nullableString,
                    reportNumber: nullableString,
                    isLocked: { type: "boolean" },
                    completedAt: { type: "string", format: "date-time" },
                  },
                },
              },
              comments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    body: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
              attachments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    fileName: { type: "string" },
                    mimeType: nullableString,
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        ],
      },
      WorkOrderList: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/WorkOrderSummary" },
          },
          meta: { $ref: "#/components/schemas/Meta" },
        },
      },
      WorkOrderCreate: {
        type: "object",
        required: ["title", "scheduledFor"],
        properties: {
          title: { type: "string", maxLength: 200 },
          description: { type: "string" },
          orderNumber: { type: "string" },
          customerId: { type: "string" },
          contactId: { type: "string" },
          departmentId: { type: "string" },
          address: { type: "string" },
          postalCode: { type: "string" },
          city: { type: "string" },
          scheduledFor: { type: "string", format: "date" },
          scheduledTo: { type: "string", format: "date" },
          technicianIds: { type: "array", items: { type: "string" } },
          templateIds: { type: "array", items: { type: "string" } },
          tagNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
      WorkOrderPatch: {
        type: "object",
        description:
          "Minst ett av feltene må sendes. `status` kan kombineres med nye datoer.",
        properties: {
          status: {
            type: "string",
            enum: [
              "PLANNED",
              "IN_PROGRESS",
              "WAITING",
              "COMPLETED",
              "CANCELLED",
              "OPEN",
              "PENDING",
            ],
          },
          scheduledFor: {
            type: "string",
            format: "date",
          },
          scheduledTo: {
            type: ["string", "null"],
            format: "date",
          },
          reason: {
            type: "string",
            description: "Påkrevd for enkelte statusoverganger.",
          },
        },
        additionalProperties: false,
      },
      VisitSummary: {
        type: "object",
        required: [
          "id",
          "workOrderId",
          "sequence",
          "startsAt",
          "endsAt",
          "allDay",
          "status",
          "technicians",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          workOrderId: { type: "string" },
          sequence: { type: "integer", minimum: 0 },
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time" },
          allDay: { type: "boolean" },
          status: {
            type: "string",
            enum: [
              "PLANNED",
              "ASSIGNED",
              "EN_ROUTE",
              "ON_SITE",
              "DONE",
              "CANCELLED",
            ],
          },
          notes: nullableString,
          technicians: {
            type: "array",
            items: { $ref: "#/components/schemas/PersonRef" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      VisitDetail: {
        allOf: [
          { $ref: "#/components/schemas/VisitSummary" },
          {
            type: "object",
            required: ["workOrder"],
            properties: {
              workOrder: {
                type: "object",
                required: ["id", "title", "status", "department"],
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  orderNumber: nullableString,
                  status: { type: "string" },
                  scheduledFor: {
                    type: ["string", "null"],
                    format: "date",
                  },
                  scheduledTo: {
                    type: ["string", "null"],
                    format: "date",
                  },
                  customer: {
                    oneOf: [
                      { $ref: "#/components/schemas/Ref" },
                      { type: "null" },
                    ],
                  },
                  department: { $ref: "#/components/schemas/Ref" },
                },
              },
            },
          },
        ],
      },
      VisitList: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/VisitSummary" },
          },
          meta: { $ref: "#/components/schemas/Meta" },
        },
      },
      VisitCreate: {
        type: "object",
        required: ["startsAt", "endsAt"],
        properties: {
          startsAt: {
            type: "string",
            format: "date-time",
            description: "ISO 8601 med klokkeslett.",
          },
          endsAt: {
            type: "string",
            format: "date-time",
            description: "ISO 8601 med klokkeslett, etter startsAt.",
          },
          allDay: { type: "boolean", default: false },
          technicianIds: { type: "array", items: { type: "string" } },
          notes: nullableString,
          sequence: { type: "integer", minimum: 0, default: 0 },
        },
        additionalProperties: false,
      },
      VisitPatch: {
        type: "object",
        description:
          "Nøyaktig én operasjon per forespørsel: flytting, status, " +
          "montørliste eller metadata. `startsAt` og `endsAt` må sendes " +
          "sammen. `notes`, `allDay` og `sequence` kan kombineres.",
        properties: {
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time" },
          status: {
            type: "string",
            enum: [
              "PLANNED",
              "ASSIGNED",
              "EN_ROUTE",
              "ON_SITE",
              "DONE",
              "CANCELLED",
            ],
          },
          technicianIds: { type: "array", items: { type: "string" } },
          notes: nullableString,
          allDay: { type: "boolean" },
          sequence: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
      CustomerSummary: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          customerNumber: nullableString,
          orgNumber: nullableString,
          city: nullableString,
          phone: nullableString,
          email: nullableString,
          departmentId: nullableString,
          responsibleTechnician: {
            oneOf: [
              { $ref: "#/components/schemas/PersonRef" },
              { type: "null" },
            ],
          },
        },
      },
      CustomerList: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/CustomerSummary" },
          },
          meta: { $ref: "#/components/schemas/Meta" },
        },
      },
      CustomerDetail: {
        allOf: [
          { $ref: "#/components/schemas/CustomerSummary" },
          {
            type: "object",
            properties: {
              address: nullableString,
              postalCode: nullableString,
              notes: nullableString,
              brandColor: nullableString,
              logoUrl: nullableString,
              responsibleTechnicianId: nullableString,
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
              department: {
                oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
              },
              contacts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    email: nullableString,
                    phone: nullableString,
                    role: nullableString,
                  },
                },
              },
              products: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    model: { type: "string" },
                    serialNumber: nullableString,
                    location: nullableString,
                  },
                },
              },
              contracts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    intervalMonths: { type: "integer" },
                    startDate: { type: "string", format: "date" },
                    nextServiceDate: {
                      type: ["string", "null"],
                      format: "date",
                    },
                    isActive: { type: "boolean" },
                    department: {
                      oneOf: [
                        { $ref: "#/components/schemas/Ref" },
                        { type: "null" },
                      ],
                    },
                    template: {
                      oneOf: [
                        { $ref: "#/components/schemas/Ref" },
                        { type: "null" },
                      ],
                    },
                  },
                },
              },
              users: {
                type: "array",
                description: "Kundeportalbrukere uten passord eller tokens.",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    name: nullableString,
                    email: nullableString,
                    isActive: { type: "boolean" },
                    contactId: nullableString,
                    contact: {
                      oneOf: [
                        { $ref: "#/components/schemas/Ref" },
                        { type: "null" },
                      ],
                    },
                  },
                },
              },
              counts: {
                type: "object",
                properties: {
                  contacts: { type: "integer" },
                  products: { type: "integer" },
                  contracts: { type: "integer" },
                  workOrders: { type: "integer" },
                  attachments: { type: "integer" },
                  portalUsers: { type: "integer" },
                },
              },
            },
          },
        ],
      },
      ReportSummary: {
        type: "object",
        required: [
          "id",
          "completedAt",
          "isLocked",
          "workOrder",
          "unitsCount",
        ],
        properties: {
          id: { type: "string" },
          name: nullableString,
          reportNumber: nullableString,
          completedAt: { type: "string", format: "date-time" },
          isLocked: { type: "boolean" },
          customerAcknowledgedAt: nullableDateTime,
          workOrder: {
            type: "object",
            required: ["id", "title", "customer"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              customer: {
                oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
              },
            },
          },
          unitsCount: { type: "integer", minimum: 0 },
          technicianName: nullableString,
        },
      },
      ReportList: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/ReportSummary" },
          },
          meta: { $ref: "#/components/schemas/Meta" },
        },
      },
      ReportDetail: {
        type: "object",
        required: [
          "id",
          "completedAt",
          "isLocked",
          "workOrder",
          "answers",
          "units",
          "signatures",
        ],
        properties: {
          id: { type: "string" },
          name: nullableString,
          reportNumber: nullableString,
          templateTitle: nullableString,
          templateCategory: nullableString,
          hmsType: nullableString,
          requiresUnits: { type: "boolean" },
          status: nullableString,
          comments: nullableString,
          completedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          isLocked: { type: "boolean" },
          lockedAt: nullableDateTime,
          lockedByName: nullableString,
          revision: { type: "integer" },
          legalHold: { type: "boolean" },
          workOrder: {
            type: "object",
            required: ["id", "title", "customer"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              orderNumber: nullableString,
              status: { type: "string" },
              customerId: nullableString,
              departmentId: { type: "string" },
              customer: {
                oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
              },
              department: { $ref: "#/components/schemas/Ref" },
            },
          },
          answers: {
            type: "object",
            description:
              "Skjemasvar uten interne maldata. Nøklene følger malens felt.",
            additionalProperties: true,
          },
          units: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: nullableString,
                serialNumber: nullableString,
                location: nullableString,
                status: nullableString,
                comment: nullableString,
                answers: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
          signatures: {
            type: "object",
            required: ["technician", "customer"],
            properties: {
              technician: { $ref: "#/components/schemas/Signature" },
              customer: { $ref: "#/components/schemas/Signature" },
            },
          },
          customerAcknowledgedAt: nullableDateTime,
          customerAcknowledgedBy: nullableString,
          customerAcknowledgedComment: nullableString,
        },
      },
      Signature: {
        type: "object",
        required: ["signed", "name", "url"],
        properties: {
          signed: { type: "boolean" },
          name: nullableString,
          url: nullableString,
        },
      },
      DocumentSummary: {
        type: "object",
        required: [
          "id",
          "title",
          "fileName",
          "mimeType",
          "fileSize",
          "tags",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          fileName: { type: "string" },
          mimeType: { type: "string" },
          fileSize: { type: "integer", minimum: 0 },
          folder: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          tags: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                color: nullableString,
              },
            },
          },
          uploadedBy: nullableString,
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      DocumentList: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/DocumentSummary" },
          },
          meta: { $ref: "#/components/schemas/Meta" },
        },
      },
      DocumentDetail: {
        allOf: [
          { $ref: "#/components/schemas/DocumentSummary" },
          {
            type: "object",
            properties: {
              description: nullableString,
              createdAt: { type: "string", format: "date-time" },
              folderPath: nullableString,
              versionsCount: { type: "integer", minimum: 0 },
              versions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    fileName: { type: "string" },
                    fileSize: { type: "integer" },
                    mimeType: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                    createdBy: nullableString,
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
} as const;

export function GET() {
  return NextResponse.json(openApiDocument, {
    headers: {
      // Kontrakten endres bare ved deploy, og er trygg å bufre offentlig.
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
