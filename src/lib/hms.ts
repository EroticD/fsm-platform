// i18n-ignore-file: HMS-malene er seed-data som installeres i databasen via
// migrasjonen `hms_seed_templates`. De redigeres som maler i appen og er
// bevisst norske (HMS/SJA er norske fagbegreper), så malinnholdet er nb-only.
// UI-rammen rundt HMS-biblioteket er oversatt via `hms.*`-nøklene.
import type { HmsFormType } from "@prisma/client";

/**
 * Standard HMS-skjemaer.
 *
 * Innholdet er basert på skjemaene i /HMS-skjemaer, tilpasset feltmotoren i
 * FSM. Skjemaene er maler: de kan redigeres og tilpasses virksomheten.
 *
 * Feltene har stabile id-er slik at eksisterende rapporter beholder svarene
 * sine når standardmalene oppdateres.
 */

export const HMS_FORM_TYPES = [
  "GENERAL",
  "SJA",
  "HOT_WORK",
  "INTERNAL_CONTROL",
  "DEVIATION",
  "SAFETY_ROUND",
  "WRITTEN_INSTRUCTION",
] as const satisfies readonly HmsFormType[];

/** Rekkefølgen gruppene vises i HMS-biblioteket. */
export const HMS_FORM_GROUPS: Array<{
  type: HmsFormType;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    type: "SJA",
    labelKey: "hms.groups.sja",
    descriptionKey: "hms.groups.sjaDescription",
  },
  {
    type: "HOT_WORK",
    labelKey: "hms.groups.hotWork",
    descriptionKey: "hms.groups.hotWorkDescription",
  },
  {
    type: "INTERNAL_CONTROL",
    labelKey: "hms.groups.internalControl",
    descriptionKey: "hms.groups.internalControlDescription",
  },
  {
    type: "DEVIATION",
    labelKey: "hms.groups.deviation",
    descriptionKey: "hms.groups.deviationDescription",
  },
  {
    type: "SAFETY_ROUND",
    labelKey: "hms.groups.safetyRound",
    descriptionKey: "hms.groups.safetyRoundDescription",
  },
  {
    type: "WRITTEN_INSTRUCTION",
    labelKey: "hms.groups.writtenInstruction",
    descriptionKey: "hms.groups.writtenInstructionDescription",
  },
  {
    type: "GENERAL",
    labelKey: "hms.groups.general",
    descriptionKey: "hms.groups.generalDescription",
  },
];

export function isHmsFormType(value: unknown): value is HmsFormType {
  return typeof value === "string" && (HMS_FORM_TYPES as readonly string[]).includes(value);
}

export type HmsField = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  commentOptions?: string[];
};

export type HmsTemplateDefinition = {
  id: string;
  title: string;
  reportName: string;
  description: string;
  hmsType: HmsFormType;
  fields: HmsField[];
};

const text = (id: string, label: string, required = false): HmsField => ({
  id,
  type: "TEXT",
  label,
  required,
});
const area = (id: string, label: string, required = false): HmsField => ({
  id,
  type: "TEXTAREA",
  label,
  required,
});
const check = (id: string, label: string): HmsField => ({
  id,
  type: "CHECKBOX",
  label,
});
const number = (id: string, label: string): HmsField => ({
  id,
  type: "NUMBER",
  label,
});
const date = (id: string, label: string): HmsField => ({
  id,
  type: "DATE",
  label,
});
const select = (
  id: string,
  label: string,
  options: string[],
): HmsField => ({ id, type: "SELECT", label, options });

const sjaRiskRows = (): HmsField[] =>
  Array.from({ length: 5 }, (_, index) => {
    const n = index + 1;
    return [
      text(`sja_risk_${n}_moment`, `Risikoområde ${n} – arbeidsmoment`),
      area(`sja_risk_${n}_fare`, `Risikoområde ${n} – fare og mulig hendelse`),
      number(`sja_risk_${n}_s`, `Risikoområde ${n} – sannsynlighet (1–4)`),
      number(`sja_risk_${n}_k`, `Risikoområde ${n} – konsekvens (1–4)`),
      area(`sja_risk_${n}_tiltak`, `Risikoområde ${n} – tiltak og barrierer`),
      text(`sja_risk_${n}_ansvarlig`, `Risikoområde ${n} – ansvarlig`),
      text(`sja_risk_${n}_frist`, `Risikoområde ${n} – frist/status`),
    ];
  }).flat();

const riskAssessmentRows = (): HmsField[] =>
  Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    return [
      text(`ra_risk_${n}_fare`, `Risiko ${n} – fare/problem`),
      area(`ra_risk_${n}_konsekvens`, `Risiko ${n} – mulig konsekvens`),
      number(`ra_risk_${n}_s`, `Risiko ${n} – sannsynlighet (1–4)`),
      number(`ra_risk_${n}_k`, `Risiko ${n} – konsekvens (1–4)`),
      select(`ra_risk_${n}_usikkerhet`, `Risiko ${n} – usikkerhet`, [
        "Lav",
        "Middels",
        "Høy",
      ]),
      area(`ra_risk_${n}_eksisterende`, `Risiko ${n} – eksisterende tiltak`),
      area(`ra_risk_${n}_nye`, `Risiko ${n} – nye/forbedrede tiltak`),
      text(`ra_risk_${n}_ansvarlig`, `Risiko ${n} – ansvarlig`),
      text(`ra_risk_${n}_frist`, `Risiko ${n} – frist`),
      select(`ra_risk_${n}_status`, `Risiko ${n} – status`, [
        "Åpen",
        "Pågår",
        "Lukket",
      ]),
    ];
  }).flat();

const deviationActionRows = (): HmsField[] =>
  Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    return [
      text(`dev_action_${n}_tiltak`, `Tiltak ${n}`),
      text(`dev_action_${n}_ansvarlig`, `Tiltak ${n} – ansvarlig`),
      date(`dev_action_${n}_frist`, `Tiltak ${n} – frist`),
      select(`dev_action_${n}_status`, `Tiltak ${n} – status`, [
        "Ikke startet",
        "Pågår",
        "Fullført",
      ]),
      date(`dev_action_${n}_lukket`, `Tiltak ${n} – dato lukket`),
    ];
  }).flat();

const safetyRoundFindings = (): HmsField[] =>
  Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    return [
      area(`vr_funn_${n}`, `Funn ${n} – beskrivelse`),
      select(`vr_funn_${n}_alvor`, `Funn ${n} – alvorlighet`, [
        "Lav",
        "Middels",
        "Høy",
      ]),
      text(`vr_funn_${n}_tiltak`, `Funn ${n} – tiltak`),
      text(`vr_funn_${n}_ansvarlig`, `Funn ${n} – ansvarlig`),
      date(`vr_funn_${n}_frist`, `Funn ${n} – frist`),
      select(`vr_funn_${n}_status`, `Funn ${n} – status`, [
        "Åpen",
        "Pågår",
        "Lukket",
      ]),
    ];
  }).flat();

const instructionHazardRows = (): HmsField[] =>
  Array.from({ length: 4 }, (_, index) => {
    const n = index + 1;
    return [
      text(`si_fare_${n}`, `Fare ${n}`),
      text(`si_konsekvens_${n}`, `Fare ${n} – mulig konsekvens`),
      area(`si_tiltak_${n}`, `Fare ${n} – tiltak`),
    ];
  }).flat();

const instructionStepRows = (): HmsField[] =>
  Array.from({ length: 8 }, (_, index) => {
    const n = index + 1;
    return [
      text(`si_trinn_${n}`, `Trinn ${n} – hva skal gjøres`),
      area(`si_trinn_${n}_sikkerhet`, `Trinn ${n} – sikkerhetstiltak`),
      text(`si_trinn_${n}_ansvarlig`, `Trinn ${n} – ansvarlig`),
    ];
  }).flat();

const signatureFields = (prefix: string, labels: string[]): HmsField[] =>
  labels.map((label, index) => text(`${prefix}_sig_${index + 1}`, label));

/** Standardmalene som installeres i nye og eksisterende databaser. */
export const HMS_TEMPLATE_DEFINITIONS: HmsTemplateDefinition[] = [
  {
    id: "hms_sja_v1",
    title: "Sikker Jobb Analyse (SJA)",
    reportName: "Sikker Jobb Analyse (SJA)",
    description:
      "Gjennomgang av en konkret, risikofylt arbeidsoppgave før oppstart. Brukes når arbeidet er uvanlig, risikofylt eller endrer seg.",
    hmsType: "SJA",
    fields: [
      text("sja_company", "Virksomhet"),
      text("sja_project", "Prosjekt / arbeidssted", true),
      text("sja_number", "SJA-nummer"),
      date("sja_date", "Dato"),
      text("sja_time", "Klokkeslett"),
      text("sja_duration", "Planlagt varighet"),
      text("sja_prepared_by", "Utarbeidet av"),
      text("sja_approved_by", "Godkjent av (navn/rolle)"),
      area("sja_task", "Hva skal gjøres?", true),
      area("sja_place", "Hvor skal det gjøres?"),
      area("sja_when", "Når og hvor lenge?"),
      area("sja_who", "Hvem skal utføre arbeidet?"),
      area("sja_equipment", "Utstyr, maskiner og kjemikalier"),
      area("sja_permits", "Hvilke tillatelser kreves?"),
      area("sja_affected", "Hvem andre kan bli påvirket?"),
      area("sja_participants", "Deltakere og roller"),
      ...[
        "Arbeid i høyden / fallfare",
        "Fallende gjenstander",
        "Tunge løft eller ubekvem arbeidsstilling",
        "Klemfare / bevegelige deler",
        "Elektrisk fare / spenning",
        "Varmt arbeid, gnister eller brannfare",
        "Kjemikalier, støv, røyk eller gass",
        "Trangt rom / dårlig ventilasjon",
        "Støy, vibrasjon eller stråling",
        "Trafikk, transport eller løfteoperasjoner",
        "Vær, underlag, glatt føre eller mørke",
        "Alenearbeid",
        "Samtidig arbeid / andre virksomheter",
        "Førstehjelp, beredskap og rømning",
        "Andre forhold",
      ].map((label, index) => check(`sja_hazard_${index + 1}`, label)),
      ...sjaRiskRows(),
      select("sja_decision", "Beslutning før oppstart", [
        "Arbeidet kan starte som planlagt",
        "Arbeidet kan starte når tiltakene er gjennomført",
        "Arbeidet kan ikke starte – ny SJA kreves",
      ]),
      area("sja_reason", "Begrunnelse for beslutningen"),
      area("sja_changes", "Endringer underveis"),
      ...signatureFields("sja", [
        "Signatur – arbeidsleder / bas",
        "Signatur – verneombud",
        "Signatur – utførende representant",
        "Signatur – godkjent av leder",
      ]),
    ],
  },
  {
    id: "hms_hot_work_v1",
    title: "Tillatelse til varmt arbeid",
    reportName: "Tillatelse til varmt arbeid",
    description:
      "Operativ kontroll før sveising, sliping, lodding, skjærbrenning og annet arbeid med varme eller gnister.",
    hmsType: "HOT_WORK",
    fields: [
      text("hw_number", "Tillatelse nr."),
      text("hw_from", "Gyldig fra (dato/kl.)", true),
      text("hw_to", "Gyldig til (dato/kl.)", true),
      text("hw_area", "Arbeidssted / område", true),
      area("hw_description", "Arbeidsbeskrivelse", true),
      text("hw_company", "Utførende virksomhet"),
      text("hw_persons", "Utførende person(er)"),
      text("hw_training", "Dokumentert opplæring / sertifikat"),
      date("hw_training_expiry", "Utløpsdato for opplæring"),
      text("hw_leader", "Arbeidsleder"),
      text("hw_firewatch", "Brannvakt"),
      text("hw_issuer", "Utsteder / godkjenner"),
      ...[
        ["hw_a_risk", "Risikovurdering eller SJA er gjennomført"],
        ["hw_a_permission", "Skriftlig tillatelse er innhentet der det kreves"],
        ["hw_a_training", "Utførende har dokumentert opplæring"],
        ["hw_a_notified", "Brannvernansvarlig og berørte er varslet"],
        ["hw_a_alarm", "Brannalarm/sprinkler er avklart"],
        ["hw_a_escape", "Rømningsveier er frie og kjente"],
        ["hw_a_extinguisher", "Slokkeutstyr er kontrollert og tilgjengelig"],
        ["hw_a_emergency", "Nødnummer 110 og intern varslingsrutine er kjent"],
        ["hw_a_weather", "Værforhold er vurdert"],
        ["hw_a_other", "Andre nødvendige tillatelser er innhentet"],
        ["hw_a_ready", "Forutsetningene er oppfylt før oppstart"],
      ].map(([id, label]) => check(id, label)),
      ...[
        ["hw_b_combustible", "Brennbart materiale er fjernet eller dekket"],
        ["hw_b_hidden", "Skjult brennbart materiale er kontrollert"],
        ["hw_b_openings", "Åpninger og gjennomføringer er tettet"],
        ["hw_b_below", "Brennbart under arbeidsstedet er sikret"],
        ["hw_b_gas", "Gassflasker er sikret og plassert riktig"],
        ["hw_b_equipment", "Slanger, koblinger og utstyr er kontrollert"],
        ["hw_b_barrier", "Området er avsperret og merket"],
        ["hw_b_screen", "Avskjerming mot varme, UV og sprut er etablert"],
        ["hw_b_ventilation", "Ventilasjon eller avsug er etablert"],
        ["hw_b_extinguishers", "Minst to håndslokkere er klare"],
        ["hw_b_firewatch", "Brannvakt er utpekt og til stede"],
        ["hw_b_firewatch_equipment", "Brannvakten har slokkeutstyr og kommunikasjon"],
      ].map(([id, label]) => check(id, label)),
      ...[
        ["hw_c_confined_oxygen", "Trangt rom – oksygen 19,5–23,5 %"],
        ["hw_c_confined_gas", "Trangt rom – gass under 10 % LEL"],
        ["hw_c_confined_hazard", "Trangt rom – helsefarlige gasser vurdert"],
        ["hw_c_confined_vent", "Trangt rom – ventilasjon og måling etablert"],
        ["hw_c_confined_watch", "Trangt rom – vakt og redningsutstyr klart"],
        ["hw_c_tank_empty", "Beholder/tank er tømt og rengjort"],
        ["hw_c_tank_isolated", "Beholder er isolert, trykkløs og LOTO-sikret"],
        ["hw_c_tank_measure", "Gassmåling er gjennomført og dokumentert"],
        ["hw_c_height_fall", "Høyde – fallsikring/stillas/lift er kontrollert"],
        ["hw_c_height_area", "Høyde – området under er avsperret"],
        ["hw_c_electric_dead", "Elektrisk – anlegget er spenningsløst og LOTO-sikret"],
        ["hw_c_electric_test", "Elektrisk – spenningsprøve er utført"],
      ].map(([id, label]) => check(id, label)),
      ...[
        ["hw_d_flame", "Flammesikre arbeidsklær"],
        ["hw_d_shoes", "Vernesko"],
        ["hw_d_gloves", "Vernehansker"],
        ["hw_d_eyes", "Øyevern / sveiseskjerm"],
        ["hw_d_hearing", "Hørselvern"],
        ["hw_d_respiration", "Åndedrettsvern"],
      ].map(([id, label]) => check(id, label)),
      text("hw_e_start_time", "Kontroll før start – klokkeslett"),
      text("hw_e_start_by", "Kontroll før start – utført av"),
      text("hw_e_firewatch_time", "Brannvakt på plass – klokkeslett"),
      text("hw_e_end_time", "Arbeidet avsluttet – klokkeslett"),
      text("hw_e_after_time", "Etterkontroll etter 1 time – klokkeslett"),
      text("hw_e_after_by", "Etterkontroll – utført av"),
      text("hw_e_returned", "Tillatelsen avsluttet og returnert"),
      ...[
        ["hw_f_off", "Alt utstyr er slått av og gassflasker stengt"],
        ["hw_f_checked", "Arbeidsstedet er kontrollert for glør og røyk"],
        ["hw_f_firewatch", "Brannvakt er avsluttet etter minst 1 time"],
        ["hw_f_cleared", "Området er ryddet og avsperring fjernet"],
        ["hw_f_archived", "Tillatelsen er signert og arkivert"],
      ].map(([id, label]) => check(id, label)),
      area("hw_notes", "Merknader / avvik"),
      ...signatureFields("hw", [
        "Signatur – utførende",
        "Signatur – brannvakt",
        "Signatur – arbeidsleder",
        "Signatur – utsteder / godkjenner",
      ]),
    ],
  },
  {
    id: "hms_risk_assessment_v1",
    title: "Risikovurdering og handlingsplan",
    reportName: "Risikovurdering og handlingsplan",
    description:
      "Systematisk kartlegging og vurdering av risiko i en arbeidsprosess, med tiltak og oppfølging.",
    hmsType: "INTERNAL_CONTROL",
    fields: [
      text("ra_company", "Virksomhet / avdeling"),
      text("ra_process", "Arbeidsprosess / område", true),
      text("ra_leader", "Ansvarlig leder"),
      text("ra_participants", "Deltakere (navn/rolle)"),
      text("ra_safety_rep", "Verneombud"),
      date("ra_date", "Dato for kartlegging"),
      date("ra_reviewed", "Sist revidert"),
      text("ra_version", "Versjon"),
      area("ra_tasks", "Hvilke arbeidsoppgaver inngår?"),
      area("ra_place", "Hvor utføres arbeidet?"),
      area("ra_people", "Hvem utfører arbeidet?"),
      area("ra_equipment", "Utstyr, maskiner og kjemikalier"),
      area("ra_history", "Uønskede hendelser som har skjedd tidligere"),
      area("ra_existing", "Eksisterende tiltak og barrierer"),
      ...riskAssessmentRows(),
      area("ra_criteria", "Virksomhetens akseptkriterier"),
      area("ra_actions_done", "Er alle tiltakene gjennomført?"),
      area("ra_effect", "Har tiltakene hatt ønsket effekt?"),
      area("ra_new_hazards", "Har tiltakene skapt nye farer?"),
      area("ra_next_review", "Når skal risikovurderingen gjennomgås på nytt?"),
      ...signatureFields("ra", [
        "Signatur – ansvarlig leder",
        "Signatur – verneombud",
        "Signatur – deltakerrepresentant",
      ]),
    ],
  },
  {
    id: "hms_deviation_v1",
    title: "Avviksmelding",
    reportName: "Avviksmelding",
    description:
      "Registrering, undersøkelse og lukking av HMS-avvik, ulykker og nestenulykker.",
    hmsType: "DEVIATION",
    fields: [
      text("dev_number", "Avviksnummer"),
      text("dev_occurred", "Dato og klokkeslett for hendelsen"),
      text("dev_reported_by", "Meldt av"),
      date("dev_reported_date", "Dato meldt"),
      text("dev_area", "Avdeling / arbeidssted"),
      text("dev_leader", "Ansvarlig leder"),
      text("dev_safety_notified", "Verneombud varslet (dato)"),
      ...[
        ["dev_type_injury", "Ulykke med personskade"],
        ["dev_type_near", "Nestenulykke"],
        ["dev_type_rule", "Brudd på rutine, prosedyre eller regelverk"],
        ["dev_type_material", "Materiell skade"],
        ["dev_type_fire", "Brann eller eksplosjon"],
        ["dev_type_environment", "Miljøutslipp"],
        ["dev_type_threat", "Trakassering, vold eller trusler"],
        ["dev_type_other", "Annet avvik"],
      ].map(([id, label]) => check(id, label)),
      area("dev_what", "Hva skjedde?", true),
      area("dev_where", "Hvor skjedde det?"),
      area("dev_involved", "Hvem var involvert?"),
      area("dev_witnesses", "Hvem var vitne?"),
      area("dev_equipment", "Utstyr / kjemikalie involvert"),
      area("dev_consequences", "Umiddelbare konsekvenser"),
      ...[
        ["dev_action_secured", "Arbeidsstedet er sikret og avsperret"],
        ["dev_action_firstaid", "Førstehjelp er gitt / helsehjelp tilkalt"],
        ["dev_action_emergency", "Nødetatene er varslet"],
        ["dev_action_people", "Berørte er ivaretatt"],
        ["dev_action_equipment", "Utstyr er stoppet og sikret"],
        ["dev_action_leader", "Leder og verneombud er varslet"],
        ["dev_action_more", "Andre tiltak er gjennomført"],
      ].map(([id, label]) => check(id, label)),
      ...[
        ["dev_notify_labour", "Arbeidstilsynet"],
        ["dev_notify_nav", "NAV – yrkesskade"],
        ["dev_notify_fire", "Brannvesen / politi"],
        ["dev_notify_owner", "Bygningseier / oppdragsgiver"],
        ["dev_notify_health", "Bedriftshelsetjeneste"],
        ["dev_notify_insurance", "Forsikringsselskap"],
      ].map(([id, label]) => check(id, label)),
      area("dev_why_1", "Hvorfor skjedde det? (1)"),
      area("dev_why_2", "Hvorfor det? (2)"),
      area("dev_why_3", "Hvorfor det? (3)"),
      area("dev_why_4", "Hvorfor det? (4)"),
      area("dev_why_5", "Hvorfor det? (5)"),
      area("dev_root_cause", "Bakenforliggende årsak"),
      ...[
        ["dev_cause_technical", "Teknisk feil / sviktende utstyr"],
        ["dev_cause_routine", "Manglende eller uklar rutine"],
        ["dev_cause_followed", "Rutinen ble ikke fulgt"],
        ["dev_cause_training", "Manglende opplæring eller kompetanse"],
        ["dev_cause_ppe", "Manglende verneutstyr"],
        ["dev_cause_pressure", "Organisering, tidspress eller bemanning"],
        ["dev_cause_communication", "Kommunikasjon eller samhandling"],
        ["dev_cause_external", "Ytre forhold"],
      ].map(([id, label]) => check(id, label)),
      number("dev_risk_s", "Risiko etter hendelsen – sannsynlighet (1–4)"),
      number("dev_risk_k", "Risiko etter hendelsen – konsekvens (1–4)"),
      area("dev_risk_note", "Vurdering av risiko etter hendelsen"),
      ...deviationActionRows(),
      area("dev_actions_verified", "Er tiltakene gjennomført og verifisert?"),
      area("dev_routines_updated", "Er rutiner eller instrukser oppdatert?"),
      area("dev_training_done", "Er opplæring gjennomført?"),
      area("dev_experience_shared", "Er erfaringen delt med relevante ansatte?"),
      date("dev_closed_date", "Dato lukket"),
      text("dev_closed_by", "Lukket av"),
      ...signatureFields("dev", [
        "Signatur – ansvarlig leder",
        "Signatur – verneombud",
        "Signatur – melder",
      ]),
    ],
  },
  {
    id: "hms_safety_round_v1",
    title: "Vernerunde – sjekkliste",
    reportName: "Vernerunde",
    description:
      "Systematisk befaring av arbeidsplassen for å avdekke farer, mangler og forbedringsområder.",
    hmsType: "SAFETY_ROUND",
    fields: [
      text("vr_company", "Virksomhet / avdeling"),
      text("vr_area", "Område som befares", true),
      date("vr_date", "Dato"),
      text("vr_participants", "Deltakere (navn/rolle)"),
      text("vr_safety_rep", "Verneombud"),
      text("vr_leader", "Ansvarlig leder"),
      ...([
        ["vr_order_1", "Gulv, gangveier og arbeidsflater er frie"],
        ["vr_order_2", "Avfall og emballasje er ryddet"],
        ["vr_order_3", "Søl, fett og væske er fjernet eller sikret"],
        ["vr_order_4", "Lager og materialer er stabilt plassert"],
        ["vr_fire_1", "Rømningsveier er frie og merket"],
        ["vr_fire_2", "Nødutganger kan åpnes uten nøkkel"],
        ["vr_fire_3", "Brannslokkere er kontrollert og tilgjengelige"],
        ["vr_fire_4", "Slokke- og førstehjelpsutstyr er komplett"],
        ["vr_el_1", "Kabler og ledninger er uten skader"],
        ["vr_el_2", "Stikkontakter og skjøteledninger brukes forskriftsmessig"],
        ["vr_el_3", "Defekt elektrisk utstyr er tatt ut av bruk"],
        ["vr_el_4", "Elektriske anlegg er sikret mot berøring og fukt"],
        ["vr_machine_1", "Utstyr er kontrollert og vedlikeholdt"],
        ["vr_machine_2", "Verneinnretninger er på plass og fungerer"],
        ["vr_machine_3", "Nødstopp er merket og fungerer"],
        ["vr_machine_4", "Bruksanvisning og skriftlig instruks er tilgjengelig"],
        ["vr_ergo_1", "Arbeidshøyde og arbeidsflater er tilpasset"],
        ["vr_ergo_2", "Tunge løft er redusert med hjelpemidler"],
        ["vr_ergo_3", "Ensformig og gjentatt arbeid er begrenset"],
        ["vr_ergo_4", "Pauser og variasjon er lagt til rette"],
        ["vr_chem_1", "Kjemikalier er merket og sikkerhetsdatablad er tilgjengelig"],
        ["vr_chem_2", "Kjemikalier er lagret sikkert og adskilt"],
        ["vr_chem_3", "Ventilasjon og avsug fungerer"],
        ["vr_chem_4", "Personlig verneutstyr er tilpasset og tilgjengelig"],
        ["vr_climate_1", "Støynivået er vurdert"],
        ["vr_climate_2", "Vibrasjonsutsatt verktøy brukes med pauser"],
        ["vr_climate_3", "Belysningen er tilstrekkelig"],
        ["vr_climate_4", "Temperatur, trekk og luftkvalitet er tilfredsstillende"],
        ["vr_ppe_1", "Nødvendig verneutstyr er tilgjengelig og i god stand"],
        ["vr_ppe_2", "Verneutstyret brukes riktig"],
        ["vr_ppe_3", "Verneutstyr er tilpasset den enkelte"],
        ["vr_psych_1", "Arbeidsmengde og tempo er håndterbart"],
        ["vr_psych_2", "Ansatte har medvirkning i eget arbeid"],
        ["vr_psych_3", "Det er tydelige roller og ansvar"],
        ["vr_psych_4", "Det er lav terskel for å melde avvik"],
        ["vr_out_1", "Adkomst, parkering og gangveier er sikre"],
        ["vr_out_2", "Trafikk og transport er skiltet og sikret"],
        ["vr_out_3", "Utendørs utstyr er sikret mot vær og vind"],
        ["vr_out_4", "Lys og sikt er tilstrekkelig ved mørke"],
      ] as Array<[string, string]>).map(([id, label]) => check(id, label)),
      ...safetyRoundFindings(),
      area("vr_summary", "Hovedinntrykk av arbeidsplassen"),
      area("vr_immediate", "Tiltak som må gjennomføres straks"),
      area("vr_planned", "Tiltak som krever planlegging"),
      date("vr_next", "Dato for neste vernerunde"),
      ...signatureFields("vr", [
        "Signatur – verneombud",
        "Signatur – ansvarlig leder",
        "Signatur – deltakerrepresentant",
      ]),
    ],
  },
  {
    id: "hms_written_instruction_v1",
    title: "Skriftlig instruks",
    reportName: "Skriftlig arbeidsinstruks",
    description:
      "Mal for skriftlig instruks ved arbeid som kan innebære særlig fare for liv eller helse.",
    hmsType: "WRITTEN_INSTRUCTION",
    fields: [
      text("si_company", "Virksomhet"),
      text("si_department", "Avdeling / enhet"),
      text("si_title", "Instruksens tittel", true),
      text("si_number", "Instruksnummer"),
      text("si_version", "Versjon"),
      text("si_prepared_by", "Utarbeidet av"),
      date("si_date", "Dato"),
      text("si_approved_by", "Godkjent av"),
      text("si_next_revision", "Neste revisjon"),
      area("si_scope_work", "Hvilket arbeid gjelder instruksen?"),
      area("si_scope_place", "Hvor skal arbeidet utføres?"),
      area("si_scope_who", "Hvem gjelder instruksen for?"),
      area("si_scope_included", "Hvilke oppgaver omfattes?"),
      area("si_scope_excluded", "Hvilke oppgaver omfattes ikke?"),
      area("si_resp_employer", "Arbeidsgiver / leder – ansvar og kompetansekrav"),
      area("si_resp_leader", "Arbeidsleder / bas – ansvar og kompetansekrav"),
      area("si_resp_executor", "Utførende – ansvar og kompetansekrav"),
      ...instructionHazardRows(),
      ...[
        ["si_pre_risk", "Risikovurdering / SJA er gjennomført"],
        ["si_pre_permits", "Nødvendige tillatelser er innhentet"],
        ["si_pre_area", "Arbeidsstedet er sikret og avsperret"],
        ["si_pre_equipment", "Utstyr er kontrollert og fungerer"],
        ["si_pre_ppe", "Verneutstyr er tilgjengelig og kontrollert"],
        ["si_pre_notified", "Berørte personer er varslet"],
        ["si_pre_emergency", "Beredskap og varslingsrutine er kjent"],
        ["si_pre_weather", "Vær- og lysforhold er vurdert"],
      ].map(([id, label]) => check(id, label)),
      ...instructionStepRows(),
      area(
        "si_barriers",
        "Sikkerhetstiltak og barrierer (avsperring, LOTO, ventilasjon, gassmåling, brannvakt, fallsikring, nødstopp, kommunikasjon)",
      ),
      ...[
        ["si_ppe_helmet", "Hjelm"],
        ["si_ppe_eyes", "Vernebriller / ansiktsskjerm"],
        ["si_ppe_hearing", "Hørselvern"],
        ["si_ppe_gloves", "Vernehansker"],
        ["si_ppe_shoes", "Vernesko"],
        ["si_ppe_flame", "Flammesikre klær"],
        ["si_ppe_respiration", "Åndedrettsvern"],
        ["si_ppe_fall", "Fallsikring"],
        ["si_ppe_other", "Annet verneutstyr"],
      ].map(([id, label]) => check(id, label)),
      ...[
        ["si_close_order", "Arbeidet er avsluttet i riktig rekkefølge"],
        ["si_close_off", "Utstyr er slått av, trykkløst og sikret"],
        ["si_close_cleared", "Arbeidsstedet er ryddet"],
        ["si_close_checked", "Området er kontrollert for fare"],
        ["si_close_barrier", "Avsperring er fjernet"],
        ["si_close_deviation", "Avvik er meldt"],
        ["si_close_documented", "Utført arbeid er dokumentert"],
      ].map(([id, label]) => check(id, label)),
      area("si_emergency_injury", "Beredskap – personskade"),
      area("si_emergency_fire", "Beredskap – brann / eksplosjon"),
      area("si_emergency_gas", "Beredskap – gasslekkasje"),
      area("si_emergency_electric", "Beredskap – strømulykke"),
      area("si_references", "Referanser (risikovurdering, SJA, datablad, regelverk)"),
      area("si_change_log", "Revisjon og endringslogg"),
      ...signatureFields("si", [
        "Signatur – utarbeidet av",
        "Signatur – verneombud",
        "Signatur – godkjent av arbeidsgiver",
      ]),
    ],
  },
];
