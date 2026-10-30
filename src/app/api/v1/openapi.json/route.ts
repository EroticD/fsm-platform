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
    summary:
      "Oppdrag, visiter, kunder, avtaler, SLA, utstyr, vedlikehold, rapporter og dokumenter for FSM-plattformen.",
    description:
      "Alle dataendepunkter under /api/v1 krever en API-nøkkel sendt som " +
      "`Authorization: Bearer fsm_...`. Responser bruker konvolutten " +
      "`{ data, meta? }`; feil bruker `{ error: { code, message, messageKey, details? } }`. " +
      "Visiter har stabile feilkoder i `details.code` på formen " +
      "`visits.errors.*`. Utstyr og vedlikehold bruker `equipment.errors.*` " +
      "og `maintenance.errors.*`. API-et har ingen nettlesersesjon og godtar " +
      "aldri informasjonskapsler.",
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
    {
      name: "Contracts",
      description:
        "Serviceavtaler, avtalelinjer, prislister (referanse) og PDF.",
    },
    { name: "SLA", description: "SLA-policyer og klokker på oppdrag." },
    { name: "Equipment", description: "Utstyr, hierarki, målinger og QR." },
    {
      name: "Maintenance",
      description: "Forebyggende vedlikeholdsplaner og forekomster.",
    },
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
    "/contracts": {
      get: {
        tags: ["Contracts"],
        operationId: "listContracts",
        summary: "List serviceavtaler",
        description:
          "Avdelingssperret liste. Administrator ser alle avtaler; andre ser " +
          "avtaler i egen avdeling. Filtrer på status, kunde, fritekst eller " +
          "avtaler som utløper innen `expiringDays` dager.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "DRAFT",
                "ACTIVE",
                "PAUSED",
                "EXPIRED",
                "TERMINATED",
              ],
            },
          },
          {
            name: "customerId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "expiringDays",
            in: "query",
            description: "Aktive avtaler med sluttdato innen N dager.",
            schema: { type: "integer", minimum: 1, maximum: 3650 },
          },
          {
            name: "q",
            in: "query",
            description: "Fritekst i tittel, avtalenummer eller kundenavn.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Side med avtaler.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ContractList" },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Contracts"],
        operationId: "createContract",
        summary: "Opprett serviceavtale",
        description:
          "Krever `contracts.manage`. Prislister er referansedata; tjenesten " +
          "har ingen faktureringssemantikk.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContractCreate" },
            },
          },
        },
        responses: {
          "201": {
            description: "Avtalen er opprettet.",
            headers: {
              Location: {
                description: "Relativ adresse til avtalen.",
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
          "422": { $ref: "#/components/responses/ValidationError" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/contracts/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Contracts"],
        operationId: "getContract",
        summary: "Hent serviceavtale",
        responses: {
          "200": {
            description: "Avtalen med linjer, prisliste og siste oppdrag.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/ContractDetail" },
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
        tags: ["Contracts"],
        operationId: "updateContract",
        summary: "Oppdater serviceavtale",
        description:
          "Delvis oppdatering. Utelatte felter beholder verdien sin. Krever " +
          "`contracts.manage`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ContractUpdate" },
            },
          },
        },
        responses: {
          "200": {
            description: "Avtalen er oppdatert.",
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
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/ValidationError" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/contracts/{id}/pdf": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Contracts"],
        operationId: "downloadContractPdf",
        summary: "Last ned serviceavtale som PDF",
        parameters: [
          {
            name: "locale",
            in: "query",
            description: "PDF-språk: nb, en, pl eller de. Standard nb.",
            schema: {
              type: "string",
              enum: ["nb", "en", "pl", "de"],
            },
          },
        ],
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
    "/sla-policies": {
      get: {
        tags: ["SLA"],
        operationId: "listSlaPolicies",
        summary: "List aktive SLA-policyer",
        description:
          "Administrator ser alle; andre ser globale policyer og policyer i " +
          "egen avdeling.",
        responses: {
          "200": {
            description: "Aktive policyer.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/SlaPolicy" },
                    },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
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
    "/equipment": {
      get: {
        tags: ["Equipment"],
        operationId: "listEquipment",
        summary: "List utstyr",
        description:
          "Søk i hele utstyrsregisteret. `categoryId` tar med hele " +
          "kategoritreet under valgt kategori. Alle filtre kombineres med AND.",
        parameters: [
          {
            name: "q",
            in: "query",
            description: "Søk i modell, serienummer, plassering og kundenavn.",
            schema: { type: "string", maxLength: 120 },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["ACTIVE", "OUT_OF_SERVICE", "RETIRED"],
            },
          },
          {
            name: "categoryId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "customerId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "parentId",
            in: "query",
            description: "Tom verdi gir bare rot-enheter.",
            schema: { type: "string" },
          },
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description: "Side med utstyr.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "meta"],
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/EquipmentSummary" },
                    },
                    meta: { $ref: "#/components/schemas/Meta" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Equipment"],
        operationId: "createEquipment",
        summary: "Registrer utstyr",
        description:
          "Krever `equipment.manage`. Kategori og overordnet enhet må finnes, " +
          "og overordnet enhet må tilhøre samme kunde.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerId", "model"],
                properties: {
                  customerId: { type: "string" },
                  model: { type: "string", maxLength: 200 },
                  serialNumber: { type: "string" },
                  location: { type: "string" },
                  categoryId: nullableString,
                  parentId: nullableString,
                  installDate: {
                    type: ["string", "null"],
                    format: "date",
                  },
                  warrantyUntil: {
                    type: ["string", "null"],
                    format: "date",
                  },
                  status: {
                    type: "string",
                    enum: ["ACTIVE", "OUT_OF_SERVICE", "RETIRED"],
                  },
                  criticality: { type: "integer", minimum: 1, maximum: 3 },
                  meterUnit: nullableString,
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Utstyret er opprettet.",
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
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "422": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/equipment/{id}": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Equipment"],
        operationId: "getEquipment",
        summary: "Hent utstyr",
        description:
          "Identitet, kunde, kategori, hierarki, målinger, planer, dokumenter " +
          "og avgrenset historikk.",
        responses: {
          "200": {
            description: "Utstyret.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: { $ref: "#/components/schemas/EquipmentDetail" },
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
        tags: ["Equipment"],
        operationId: "updateEquipment",
        summary: "Endre utstyr",
        description:
          "Krever `equipment.manage`. `categoryId`, `parentId` og datofeltene " +
          "kan settes til null. Flytting som lager en syklus gir 409 med " +
          "`details.code = equipment.errors.hierarchyCycle`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  model: { type: "string", maxLength: 200 },
                  serialNumber: { type: "string" },
                  location: { type: "string" },
                  categoryId: nullableString,
                  parentId: nullableString,
                  installDate: {
                    type: ["string", "null"],
                    format: "date",
                  },
                  warrantyUntil: {
                    type: ["string", "null"],
                    format: "date",
                  },
                  status: {
                    type: "string",
                    enum: ["ACTIVE", "OUT_OF_SERVICE", "RETIRED"],
                  },
                  criticality: { type: "integer", minimum: 1, maximum: 3 },
                  meterUnit: nullableString,
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Utstyret er oppdatert.",
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
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/equipment/{id}/meters": {
      parameters: [{ $ref: "#/components/parameters/Id" }],
      get: {
        tags: ["Equipment"],
        operationId: "listMeterReadings",
        summary: "List målinger",
        description: "Målinger for én enhet, nyeste først.",
        parameters: [
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description: "Side med målinger.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "meta"],
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/MeterReading" },
                    },
                    meta: { $ref: "#/components/schemas/Meta" },
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
      post: {
        tags: ["Equipment"],
        operationId: "createMeterReading",
        summary: "Registrer måling",
        description:
          "Krever `equipment.manage`. En måling som passerer en aktiv " +
          "målerplan lager nøyaktig ett vedlikeholdsoppdrag. Utfasede enheter " +
          "avvises med `equipment.errors.retired`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["value", "readAt"],
                properties: {
                  value: { type: "number", minimum: 0 },
                  readAt: {
                    type: "string",
                    description: "Dato (YYYY-MM-DD) eller ISO-tidspunkt.",
                  },
                  source: {
                    type: "string",
                    enum: ["MANUAL", "VISIT", "IMPORT"],
                    default: "MANUAL",
                  },
                  note: nullableString,
                  visitId: nullableString,
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Målingen er registrert.",
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
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/maintenance-plans": {
      get: {
        tags: ["Maintenance"],
        operationId: "listMaintenancePlans",
        summary: "List vedlikeholdsplaner",
        description:
          "Kalender- og målerbaserte planer med siste forekomster. Kan " +
          "filtreres på produkt, kunde, utløser og aktiv-status.",
        parameters: [
          {
            name: "productId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "customerId",
            in: "query",
            schema: { type: "string" },
          },
          {
            name: "trigger",
            in: "query",
            schema: { type: "string", enum: ["CALENDAR", "METER"] },
          },
          {
            name: "active",
            in: "query",
            schema: { type: "boolean" },
          },
          { $ref: "#/components/parameters/Page" },
          { $ref: "#/components/parameters/Limit" },
        ],
        responses: {
          "200": {
            description: "Side med planer.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "meta"],
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/MaintenancePlan" },
                    },
                    meta: { $ref: "#/components/schemas/Meta" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      post: {
        tags: ["Maintenance"],
        operationId: "createMaintenancePlan",
        summary: "Opprett vedlikeholdsplan",
        description:
          "CALENDAR krever `intervalMonths` og `nextDueDate`. METER krever " +
          "`productId` og `meterInterval`. Nye planer bruker siste måling som " +
          "utgangspunkt, slik at historiske målinger ikke utløser oppdrag.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "trigger"],
                properties: {
                  title: { type: "string", maxLength: 200 },
                  trigger: {
                    type: "string",
                    enum: ["CALENDAR", "METER"],
                  },
                  productId: nullableString,
                  customerId: nullableString,
                  departmentId: nullableString,
                  templateId: nullableString,
                  intervalMonths: {
                    type: ["integer", "null"],
                    minimum: 1,
                    maximum: 120,
                  },
                  meterInterval: {
                    type: ["number", "null"],
                    exclusiveMinimum: 0,
                  },
                  leadDays: {
                    type: "integer",
                    minimum: 0,
                    maximum: 365,
                    default: 14,
                  },
                  nextDueDate: {
                    type: ["string", "null"],
                    format: "date",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Planen er opprettet.",
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
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "409": { $ref: "#/components/responses/Conflict" },
          "422": { $ref: "#/components/responses/BadRequest" },
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
                    messageKey: "errors.api.visits.conflict",
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
                    messageKey: "errors.api.visits.conflict",
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
                    messageKey: "errors.api.visits.conflict",
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
                    messageKey: "errors.api.visits.validation",
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
                    messageKey: "errors.api.visits.validation",
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
                    messageKey: "errors.api.visits.validation",
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
        required: ["code", "message", "messageKey"],
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
          messageKey: {
            type: "string",
            description:
              "Stabil i18n-nøkkel klienten kan oversette, f.eks. `errors.api.forbidden`.",
          },
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
      ContractSummary: {
        type: "object",
        required: [
          "id",
          "title",
          "status",
          "startDate",
          "intervalMonths",
          "customer",
          "department",
          "lineCount",
          "workOrderCount",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          contractNumber: nullableString,
          status: {
            type: "string",
            enum: [
              "DRAFT",
              "ACTIVE",
              "PAUSED",
              "EXPIRED",
              "TERMINATED",
            ],
          },
          startDate: { type: "string", format: "date" },
          endDate: { type: ["string", "null"], format: "date" },
          nextServiceDate: { type: "string", format: "date" },
          intervalMonths: { type: "integer" },
          renewalMode: { type: "string", enum: ["AUTO", "MANUAL"] },
          noticeDays: { type: "integer", minimum: 0 },
          customer: { $ref: "#/components/schemas/Ref" },
          department: { $ref: "#/components/schemas/Ref" },
          slaPolicy: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          priceList: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          lineCount: { type: "integer", minimum: 0 },
          workOrderCount: { type: "integer", minimum: 0 },
        },
      },
      ContractList: {
        type: "object",
        required: ["data", "meta"],
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/ContractSummary" },
          },
          meta: { $ref: "#/components/schemas/Meta" },
        },
      },
      ContractLine: {
        type: "object",
        required: ["id", "scope"],
        properties: {
          id: { type: "string" },
          product: {
            oneOf: [
              {
                type: "object",
                required: ["id", "model"],
                properties: {
                  id: { type: "string" },
                  model: { type: "string" },
                  serialNumber: nullableString,
                  location: nullableString,
                },
              },
              { type: "null" },
            ],
          },
          scope: { type: "string" },
          visitsPerYear: { type: ["integer", "null"], minimum: 0 },
          responseMinutes: { type: ["integer", "null"], minimum: 0 },
          resolutionMinutes: { type: ["integer", "null"], minimum: 0 },
        },
      },
      PriceListItem: {
        type: "object",
        required: ["id", "code", "label", "unit", "amount"],
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          label: { type: "string" },
          unit: { type: "string" },
          amount: {
            type: "string",
            description:
              "Visningsbeløp med to desimaler. Brukes ikke til fakturering.",
          },
        },
      },
      ContractDetail: {
        allOf: [
          { $ref: "#/components/schemas/ContractSummary" },
          {
            type: "object",
            properties: {
              indexationPercent: {
                type: ["number", "null"],
                description: "Referanseverdi. Ingen beregning eller fakturering.",
              },
              isActive: { type: "boolean" },
              contact: {
                oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
              },
              template: {
                oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
              },
              priceList: {
                oneOf: [
                  {
                    type: "object",
                    required: ["id", "name", "items"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      items: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/PriceListItem",
                        },
                      },
                    },
                  },
                  { type: "null" },
                ],
              },
              lines: {
                type: "array",
                items: { $ref: "#/components/schemas/ContractLine" },
              },
              workOrders: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    status: { type: "string" },
                    scheduledFor: {
                      type: ["string", "null"],
                      format: "date",
                    },
                  },
                },
              },
            },
          },
        ],
      },
      ContractCreate: {
        type: "object",
        required: ["customerId", "title", "startDate", "intervalMonths"],
        properties: {
          customerId: { type: "string" },
          title: { type: "string" },
          contractNumber: nullableString,
          startDate: { type: "string", format: "date" },
          endDate: { type: ["string", "null"], format: "date" },
          intervalMonths: {
            type: "integer",
            enum: [3, 6, 12, 24],
          },
          departmentId: nullableString,
          contactId: nullableString,
          templateId: nullableString,
          slaPolicyId: nullableString,
          priceListId: nullableString,
          status: {
            type: "string",
            enum: ["DRAFT", "ACTIVE"],
            default: "ACTIVE",
          },
          renewalMode: {
            type: "string",
            enum: ["AUTO", "MANUAL"],
            default: "MANUAL",
          },
          noticeDays: { type: "integer", minimum: 0, default: 30 },
          indexationPercent: {
            type: ["number", "null"],
            minimum: -100,
            maximum: 100,
          },
          lines: {
            type: "array",
            maxItems: 200,
            items: {
              type: "object",
              properties: {
                productId: nullableString,
                scope: { type: "string" },
                visitsPerYear: { type: ["integer", "null"], minimum: 0 },
                responseMinutes: {
                  type: ["integer", "null"],
                  minimum: 0,
                },
                resolutionMinutes: {
                  type: ["integer", "null"],
                  minimum: 0,
                },
              },
            },
          },
        },
      },
      ContractUpdate: {
        type: "object",
        minProperties: 1,
        properties: {
          title: { type: "string" },
          contractNumber: nullableString,
          startDate: { type: "string", format: "date" },
          endDate: { type: ["string", "null"], format: "date" },
          intervalMonths: { type: "integer", enum: [3, 6, 12, 24] },
          departmentId: nullableString,
          contactId: nullableString,
          templateId: nullableString,
          slaPolicyId: nullableString,
          priceListId: nullableString,
          status: {
            type: "string",
            enum: [
              "DRAFT",
              "ACTIVE",
              "PAUSED",
              "EXPIRED",
              "TERMINATED",
            ],
          },
          renewalMode: { type: "string", enum: ["AUTO", "MANUAL"] },
          noticeDays: { type: "integer", minimum: 0 },
          indexationPercent: {
            type: ["number", "null"],
            minimum: -100,
            maximum: 100,
          },
        },
      },
      SlaPolicy: {
        type: "object",
        required: [
          "id",
          "name",
          "responseMinutes",
          "resolutionMinutes",
          "businessHoursOnly",
        ],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          departmentId: nullableString,
          department: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          responseMinutes: { type: "integer", minimum: 1 },
          resolutionMinutes: { type: "integer", minimum: 1 },
          businessHoursOnly: { type: "boolean" },
        },
      },
      SlaClock: {
        type: ["object", "null"],
        required: [
          "id",
          "policyId",
          "policyName",
          "state",
          "startedAt",
          "respondBy",
          "resolveBy",
        ],
        properties: {
          id: { type: "string" },
          policyId: { type: "string" },
          policyName: { type: "string" },
          state: {
            type: "string",
            enum: [
              "ON_TRACK",
              "AT_RISK",
              "BREACHED",
              "MET",
              "CANCELLED",
            ],
          },
          startedAt: { type: "string", format: "date-time" },
          respondBy: { type: "string", format: "date-time" },
          resolveBy: { type: "string", format: "date-time" },
          respondedAt: nullableDateTime,
          resolvedAt: nullableDateTime,
          breachedAt: nullableDateTime,
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
          sla: {
            description:
              "Nyeste SLA-klokke på oppdraget, eller null når ingen policy gjelder.",
            oneOf: [
              { $ref: "#/components/schemas/SlaClock" },
              { type: "null" },
            ],
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
      EquipmentSummary: {
        type: "object",
        required: [
          "id",
          "model",
          "status",
          "criticality",
          "customer",
          "counts",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string" },
          model: { type: "string" },
          serialNumber: nullableString,
          location: nullableString,
          status: {
            type: "string",
            enum: ["ACTIVE", "OUT_OF_SERVICE", "RETIRED"],
          },
          criticality: { type: "integer", minimum: 1, maximum: 3 },
          meterUnit: nullableString,
          installDate: { type: ["string", "null"], format: "date" },
          warrantyUntil: { type: ["string", "null"], format: "date" },
          qrToken: nullableString,
          customer: { $ref: "#/components/schemas/Ref" },
          category: {
            oneOf: [{ $ref: "#/components/schemas/Ref" }, { type: "null" }],
          },
          parent: {
            oneOf: [
              {
                type: "object",
                required: ["id", "model"],
                properties: {
                  id: { type: "string" },
                  model: { type: "string" },
                },
              },
              { type: "null" },
            ],
          },
          counts: {
            type: "object",
            properties: {
              children: { type: "integer", minimum: 0 },
              meterReadings: { type: "integer", minimum: 0 },
              maintenancePlans: { type: "integer", minimum: 0 },
              reports: { type: "integer", minimum: 0 },
              workOrders: { type: "integer", minimum: 0 },
            },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      EquipmentDetail: {
        allOf: [
          { $ref: "#/components/schemas/EquipmentSummary" },
          {
            type: "object",
            properties: {
              warrantyNotifiedAt: nullableDateTime,
              ancestors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    model: { type: "string" },
                  },
                },
              },
              children: {
                type: "array",
                items: { $ref: "#/components/schemas/EquipmentSummary" },
              },
              meterReadings: {
                type: "array",
                items: { $ref: "#/components/schemas/MeterReading" },
              },
              maintenancePlans: {
                type: "array",
                items: { $ref: "#/components/schemas/MaintenancePlan" },
              },
              documents: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    fileName: { type: "string" },
                    mimeType: { type: "string" },
                    size: { type: "integer", minimum: 0 },
                    url: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
              recentWorkOrders: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    status: { type: "string" },
                    scheduledFor: {
                      type: ["string", "null"],
                      format: "date",
                    },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
              recentReports: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    status: { type: "string" },
                    reportId: { type: "string" },
                    workOrderId: { type: "string" },
                    workOrderTitle: { type: "string" },
                    template: nullableString,
                  },
                },
              },
            },
          },
        ],
      },
      MeterReading: {
        type: "object",
        required: ["id", "value", "readAt", "source"],
        properties: {
          id: { type: "string" },
          productId: { type: "string" },
          value: {
            type: "string",
            description: "Desimalverdi serialisert som streng.",
          },
          readAt: { type: "string", format: "date-time" },
          source: {
            type: "string",
            enum: ["MANUAL", "VISIT", "IMPORT"],
          },
          note: nullableString,
          user: {
            oneOf: [{ $ref: "#/components/schemas/PersonRef" }, { type: "null" }],
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      MaintenancePlanOccurrence: {
        type: "object",
        required: ["id", "dueDate", "status"],
        properties: {
          id: { type: "string" },
          dueDate: { type: "string", format: "date" },
          status: {
            type: "string",
            enum: ["PENDING", "GENERATED", "SKIPPED"],
          },
          workOrderId: nullableString,
          meterValue: {
            type: ["string", "null"],
            description: "Desimalverdi serialisert som streng.",
          },
        },
      },
      MaintenancePlan: {
        type: "object",
        required: [
          "id",
          "title",
          "trigger",
          "leadDays",
          "isActive",
          "customer",
          "department",
          "occurrences",
        ],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          trigger: { type: "string", enum: ["CALENDAR", "METER"] },
          intervalMonths: { type: ["integer", "null"] },
          meterInterval: { type: ["string", "null"] },
          leadDays: { type: "integer", minimum: 0, maximum: 365 },
          nextDueDate: { type: ["string", "null"], format: "date" },
          isActive: { type: "boolean" },
          product: {
            oneOf: [
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  model: { type: "string" },
                  serialNumber: nullableString,
                },
              },
              { type: "null" },
            ],
          },
          customer: { $ref: "#/components/schemas/Ref" },
          department: { $ref: "#/components/schemas/Ref" },
          template: {
            oneOf: [
              {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                },
              },
              { type: "null" },
            ],
          },
          occurrences: {
            type: "array",
            items: { $ref: "#/components/schemas/MaintenancePlanOccurrence" },
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
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
