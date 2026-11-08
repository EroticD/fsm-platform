import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type {
  AbsenceKind,
  AbsenceSummary,
  SkillSummary,
  UserAvailabilityWindow,
  UserSkillSummary,
  WorkforceStaffSummary,
} from "@/server/workforce";
import type { CapacityPlanView } from "@/server/dispatch";
import type { WorkforceDepartment } from "@/server/workforce-admin";

type Action = (formData: FormData) => Promise<void>;

type Props = {
  skills: SkillSummary[];
  staff: WorkforceStaffSummary[];
  departments: WorkforceDepartment[];
  selectedStaffId: string | null;
  userSkills: UserSkillSummary[];
  availability: UserAvailabilityWindow[];
  absences: AbsenceSummary[];
  capacityPlans: CapacityPlanView[];
  capacityDepartmentId: string;
  capacityFrom: string;
  capacityTo: string;
  canReadSkills: boolean;
  canManageUsers: boolean;
  canManageDispatch: boolean;
  error?: string;
  ok?: string;
  createSkill: Action;
  updateSkill: Action;
  deleteSkill: Action;
  setUserSkills: Action;
  saveAvailability: Action;
  createAbsence: Action;
  updateAbsence: Action;
  deleteAbsence: Action;
  saveCapacityPlan: Action;
  deleteCapacityPlan: Action;
};

const CARD = "office-card space-y-4 p-4 sm:p-5";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85";
const DANGER =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-[#e7b5ae] bg-surface px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fdf4f2]";
const HINT = "text-xs leading-5 text-[var(--muted,#62685f)]";

const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

const ABSENCE_KIND_KEYS: Record<
  AbsenceKind,
  "ferie" | "sykdom" | "kurs" | "annet"
> = {
  FERIE: "ferie",
  SYKDOM: "sykdom",
  KURS: "kurs",
  ANNET: "annet",
};

const osloDateTimeFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function datetimeInput(value: Date): string {
  return osloDateTimeFormatter.format(value).replace(" ", "T").slice(0, 16);
}

function minuteToTime(minute: number): string {
  const safe = Math.max(0, Math.min(1440, minute));
  const hour = Math.floor(safe / 60);
  const rest = safe % 60;
  if (safe === 1440) return "23:59";
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default async function WorkforceSettingsTab({
  skills,
  staff,
  departments,
  selectedStaffId,
  userSkills,
  availability,
  absences,
  capacityPlans,
  capacityDepartmentId,
  capacityFrom,
  capacityTo,
  canReadSkills,
  canManageUsers,
  canManageDispatch,
  error,
  ok,
  createSkill,
  updateSkill,
  deleteSkill,
  setUserSkills,
  saveAvailability,
  createAbsence,
  updateAbsence,
  deleteAbsence,
  saveCapacityPlan,
  deleteCapacityPlan,
}: Props) {
  const t = await getTranslations("common");

  const selectedStaff = staff.find((person) => person.id === selectedStaffId);
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const userSkillById = new Map(
    userSkills.map((entry) => [entry.skillId, entry]),
  );
  const windowsPerDay = Math.min(
    7,
    Math.max(
      3,
      ...WEEKDAYS.map(
        (_, weekday) =>
          availability.filter((window) => window.weekday === weekday).length,
      ),
    ),
  );
  const windowsFor = (weekday: number) =>
    availability
      .filter((window) => window.weekday === weekday)
      .sort((left, right) => left.startMinute - right.startMinute);

  return (
    <div className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t("settings.workforce.error")}
        </div>
      ) : null}
      {ok ? (
        <div className="rounded-xl border border-[#bcd39a] bg-[var(--success-surface,#eef7d6)] p-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("settings.workforce.saved")}
        </div>
      ) : null}

      {canReadSkills && (
        <section aria-labelledby="workforce-skills-title" className={CARD}>
          <div>
            <h2
              id="workforce-skills-title"
              className="flex items-center gap-2 text-base font-black text-[var(--ink,#101310)]"
            >
              <Icon name="shield" className="h-4 w-4" />
              {t("settings.workforce.skills.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.workforce.skills.hint")}
            </p>
          </div>

          {skills.length === 0 ? (
            <p className="text-sm italic text-[var(--muted,#62685f)]">
              {t("settings.workforce.skills.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {skills.map((skill) => (
                <li
                  key={skill.id}
                  className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                >
                  <details>
                    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-bold text-[var(--ink,#101310)]">
                          {skill.label}
                        </span>
                        <span className="block text-xs text-[var(--muted,#62685f)]">
                          {skill.key}
                          {skill.category ? ` · ${skill.category}` : ""} ·{" "}
                          {t("settings.workforce.skills.usage", {
                            users: skill.userCount,
                            orders: skill.workOrderCount,
                          })}
                        </span>
                      </span>
                      <span className="text-xs font-bold text-[var(--muted,#62685f)]">
                        {canManageUsers
                          ? t("settings.workforce.edit")
                          : t("settings.workforce.readOnly")}
                      </span>
                    </summary>
                    {canManageUsers && (
                      <div className="mt-3 flex flex-col gap-2 border-t border-[var(--line,#dedcd1)] pt-3 sm:flex-row sm:items-end">
                        <form
                          action={updateSkill}
                          className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3"
                        >
                          <input type="hidden" name="id" value={skill.id} />
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.skills.key")}
                            </span>
                            <input
                              name="key"
                              defaultValue={skill.key}
                              required
                              maxLength={64}
                              className={INPUT}
                            />
                          </label>
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.skills.label")}
                            </span>
                            <input
                              name="label"
                              defaultValue={skill.label}
                              required
                              maxLength={80}
                              className={INPUT}
                            />
                          </label>
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.skills.category")}
                            </span>
                            <input
                              name="category"
                              defaultValue={skill.category ?? ""}
                              maxLength={80}
                              className={INPUT}
                            />
                          </label>
                          <div className="sm:col-span-3">
                            <button type="submit" className={BUTTON}>
                              <Icon name="check" className="h-4 w-4" />
                              {t("settings.workforce.skills.save")}
                            </button>
                          </div>
                        </form>
                        <form action={deleteSkill}>
                          <input type="hidden" name="id" value={skill.id} />
                          <button type="submit" className={DANGER}>
                            {t("settings.workforce.skills.delete")}
                          </button>
                        </form>
                      </div>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}

          {canManageUsers && (
            <form
              action={createSkill}
              className="grid grid-cols-1 gap-3 border-t border-[var(--line,#dedcd1)] pt-4 sm:grid-cols-3"
            >
              <label className="block">
                <span className={LABEL}>
                  {t("settings.workforce.skills.key")}
                </span>
                <input
                  name="key"
                  required
                  maxLength={64}
                  placeholder={t("settings.workforce.skills.keyPlaceholder")}
                  className={INPUT}
                />
              </label>
              <label className="block">
                <span className={LABEL}>
                  {t("settings.workforce.skills.label")}
                </span>
                <input
                  name="label"
                  required
                  maxLength={80}
                  className={INPUT}
                />
              </label>
              <label className="block">
                <span className={LABEL}>
                  {t("settings.workforce.skills.category")}
                </span>
                <input name="category" maxLength={80} className={INPUT} />
              </label>
              <div className="sm:col-span-3">
                <button type="submit" className={BUTTON}>
                  <Icon name="plus" className="h-4 w-4" />
                  {t("settings.workforce.skills.create")}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {canReadSkills && (
        <section aria-labelledby="workforce-staff-title" className={CARD}>
          <div>
            <h2
              id="workforce-staff-title"
              className="flex items-center gap-2 text-base font-black text-[var(--ink,#101310)]"
            >
              <Icon name="users" className="h-4 w-4" />
              {t("settings.workforce.staff.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.workforce.staff.hint")}
            </p>
          </div>

          {staff.length === 0 ? (
            <p className="text-sm italic text-[var(--muted,#62685f)]">
              {t("settings.workforce.staff.noStaff")}
            </p>
          ) : (
            <>
              <form
                action="/innstillinger"
                method="get"
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <input type="hidden" name="tab" value="kompetanse" />
                <input
                  type="hidden"
                  name="department"
                  value={capacityDepartmentId}
                />
                <label className="block flex-1">
                  <span className={LABEL}>
                    {t("settings.workforce.staff.select")}
                  </span>
                  <select
                    name="staff"
                    defaultValue={selectedStaffId ?? ""}
                    className={INPUT}
                  >
                    {staff.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name ?? person.email ?? person.id}
                        {person.departmentName
                          ? ` – ${person.departmentName}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className={BUTTON}>
                  <Icon name="check" className="h-4 w-4" />
                  {t("settings.workforce.staff.show")}
                </button>
              </form>

              {selectedStaff && (
                <p className={HINT}>
                  {t("settings.workforce.staff.departmentFallback", {
                    department:
                      selectedStaff.departmentName ??
                      t("settings.workforce.staff.noDepartment"),
                  })}
                </p>
              )}

              {!canManageUsers ? (
                <p className="text-sm italic text-[var(--muted,#62685f)]">
                  {t("settings.workforce.readOnlyHint")}
                </p>
              ) : (
                selectedStaffId && (
                  <div className="space-y-4 border-t border-[var(--line,#dedcd1)] pt-4">
                    <form action={setUserSkills} className="space-y-3">
                      <input
                        type="hidden"
                        name="userId"
                        value={selectedStaffId}
                      />
                      <div>
                        <h3 className="text-sm font-black text-[var(--ink,#101310)]">
                          {t("settings.workforce.userSkills.title")}
                        </h3>
                        <p className={HINT}>
                          {t("settings.workforce.userSkills.hint")}
                        </p>
                      </div>
                      {skills.length === 0 ? (
                        <p className="text-sm italic text-[var(--muted,#62685f)]">
                          {t("settings.workforce.userSkills.noSkills")}
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
                            <thead>
                              <tr className="border-b border-[var(--line,#dedcd1)] text-2xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                                <th scope="col" className="px-2 py-2">
                                  {t(
                                    "settings.workforce.userSkills.skill",
                                  )}
                                </th>
                                <th scope="col" className="px-2 py-2">
                                  {t(
                                    "settings.workforce.userSkills.level",
                                  )}
                                </th>
                                <th scope="col" className="px-2 py-2">
                                  {t(
                                    "settings.workforce.userSkills.validUntil",
                                  )}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {skills.map((skill) => {
                                const assigned = userSkillById.get(skill.id);
                                return (
                                  <tr
                                    key={skill.id}
                                    className="border-b border-[var(--line,#dedcd1)] last:border-0"
                                  >
                                    <td className="px-2 py-2">
                                      <label className="flex min-h-11 items-center gap-2 font-bold">
                                        <input
                                          type="checkbox"
                                          name="skillIds"
                                          value={skill.id}
                                          defaultChecked={Boolean(assigned)}
                                          className="h-4 w-4 rounded accent-[var(--ink,#101310)]"
                                        />
                                        {skill.label}
                                      </label>
                                    </td>
                                    <td className="px-2 py-2">
                                      <input
                                        type="number"
                                        name={`level-${skill.id}`}
                                        min={1}
                                        max={5}
                                        step={1}
                                        defaultValue={assigned?.level ?? ""}
                                        aria-label={t(
                                          "settings.workforce.userSkills.levelFor",
                                          { skill: skill.label },
                                        )}
                                        className={INPUT}
                                      />
                                    </td>
                                    <td className="px-2 py-2">
                                      <input
                                        type="date"
                                        name={`validUntil-${skill.id}`}
                                        defaultValue={
                                          assigned?.validUntil
                                            ? assigned.validUntil
                                                .toISOString()
                                                .slice(0, 10)
                                            : ""
                                        }
                                        aria-label={t(
                                          "settings.workforce.userSkills.validUntilFor",
                                          { skill: skill.label },
                                        )}
                                        className={INPUT}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <button type="submit" className={BUTTON}>
                        <Icon name="check" className="h-4 w-4" />
                        {t("settings.workforce.userSkills.save")}
                      </button>
                    </form>

                    <form
                      action={saveAvailability}
                      className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4"
                    >
                      <input
                        type="hidden"
                        name="userId"
                        value={selectedStaffId}
                      />
                      <div>
                        <h3 className="text-sm font-black text-[var(--ink,#101310)]">
                          {t("settings.workforce.availability.title")}
                        </h3>
                        <p className={HINT}>
                          {t("settings.workforce.availability.hint")}
                        </p>
                      </div>
                      <div className="space-y-2">
                        {WEEKDAYS.map((day, weekday) => {
                          const windows = windowsFor(weekday);
                          return (
                            <fieldset
                              key={day}
                              className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                            >
                              <legend className="px-1 text-xs font-black uppercase tracking-wide text-[var(--ink,#101310)]">
                                {t(`settings.workforce.weekdays.${day}`)}
                              </legend>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                {Array.from(
                                  { length: windowsPerDay },
                                  (_, index) => {
                                    const window = windows[index];
                                    return (
                                      <div
                                        key={`${day}-${index}`}
                                        className="grid grid-cols-2 gap-2"
                                      >
                                        <input
                                          type="hidden"
                                          name="weekday"
                                          value={weekday}
                                        />
                                        <label className="block">
                                          <span className={LABEL}>
                                            {t(
                                              "settings.workforce.availability.from",
                                            )}
                                          </span>
                                          <input
                                            type="time"
                                            name="start"
                                            step={900}
                                            defaultValue={
                                              window
                                                ? minuteToTime(
                                                    window.startMinute,
                                                  )
                                                : ""
                                            }
                                            aria-label={t(
                                              "settings.workforce.availability.fromFor",
                                              {
                                                day: t(
                                                  `settings.workforce.weekdays.${day}`,
                                                ),
                                              },
                                            )}
                                            className={INPUT}
                                          />
                                        </label>
                                        <label className="block">
                                          <span className={LABEL}>
                                            {t(
                                              "settings.workforce.availability.to",
                                            )}
                                          </span>
                                          <input
                                            type="time"
                                            name="end"
                                            step={900}
                                            defaultValue={
                                              window
                                                ? minuteToTime(window.endMinute)
                                                : ""
                                            }
                                            aria-label={t(
                                              "settings.workforce.availability.toFor",
                                              {
                                                day: t(
                                                  `settings.workforce.weekdays.${day}`,
                                                ),
                                              },
                                            )}
                                            className={INPUT}
                                          />
                                        </label>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            </fieldset>
                          );
                        })}
                      </div>
                      <button type="submit" className={BUTTON}>
                        <Icon name="check" className="h-4 w-4" />
                        {t("settings.workforce.availability.save")}
                      </button>
                    </form>

                    <div className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
                      <div>
                        <h3 className="text-sm font-black text-[var(--ink,#101310)]">
                          {t("settings.workforce.absences.title")}
                        </h3>
                        <p className={HINT}>
                          {t("settings.workforce.absences.hint")}
                        </p>
                      </div>

                      {absences.length === 0 ? (
                        <p className="text-sm italic text-[var(--muted,#62685f)]">
                          {t("settings.workforce.absences.empty")}
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {absences.map((absence) => (
                            <li
                              key={absence.id}
                              className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                            >
                              <form
                                action={updateAbsence}
                                className="space-y-2"
                              >
                                <input
                                  type="hidden"
                                  name="id"
                                  value={absence.id}
                                />
                                <input
                                  type="hidden"
                                  name="returnStaff"
                                  value={selectedStaffId}
                                />
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                  <label className="block">
                                    <span className={LABEL}>
                                      {t(
                                        "settings.workforce.absences.start",
                                      )}
                                    </span>
                                    <input
                                      type="datetime-local"
                                      name="startsAt"
                                      defaultValue={datetimeInput(
                                        absence.startsAt,
                                      )}
                                      required
                                      className={INPUT}
                                    />
                                  </label>
                                  <label className="block">
                                    <span className={LABEL}>
                                      {t("settings.workforce.absences.end")}
                                    </span>
                                    <input
                                      type="datetime-local"
                                      name="endsAt"
                                      defaultValue={datetimeInput(
                                        absence.endsAt,
                                      )}
                                      required
                                      className={INPUT}
                                    />
                                  </label>
                                  <label className="block">
                                    <span className={LABEL}>
                                      {t("settings.workforce.absences.kind")}
                                    </span>
                                    <select
                                      name="kind"
                                      defaultValue={absence.kind}
                                      className={INPUT}
                                    >
                                      {Object.entries(ABSENCE_KIND_KEYS).map(
                                        ([kind, key]) => (
                                          <option key={kind} value={kind}>
                                            {t(
                                              `settings.workforce.absences.kinds.${key}`,
                                            )}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </label>
                                  <label className="block">
                                    <span className={LABEL}>
                                      {t("settings.workforce.absences.note")}
                                    </span>
                                    <input
                                      name="note"
                                      defaultValue={absence.note ?? ""}
                                      maxLength={500}
                                      className={INPUT}
                                    />
                                  </label>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button type="submit" className={BUTTON}>
                                    <Icon name="check" className="h-4 w-4" />
                                    {t("settings.workforce.absences.save")}
                                  </button>
                                </div>
                              </form>
                              <form action={deleteAbsence} className="mt-2">
                                <input
                                  type="hidden"
                                  name="id"
                                  value={absence.id}
                                />
                                <input
                                  type="hidden"
                                  name="returnStaff"
                                  value={selectedStaffId}
                                />
                                <button type="submit" className={DANGER}>
                                  {t("settings.workforce.absences.delete")}
                                </button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      )}

                      <form
                        action={createAbsence}
                        className="space-y-2 border-t border-[var(--line,#dedcd1)] pt-3"
                      >
                        <input
                          type="hidden"
                          name="userId"
                          value={selectedStaffId}
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.absences.start")}
                            </span>
                            <input
                              type="datetime-local"
                              name="startsAt"
                              required
                              className={INPUT}
                            />
                          </label>
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.absences.end")}
                            </span>
                            <input
                              type="datetime-local"
                              name="endsAt"
                              required
                              className={INPUT}
                            />
                          </label>
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.absences.kind")}
                            </span>
                            <select name="kind" className={INPUT}>
                              {Object.entries(ABSENCE_KIND_KEYS).map(
                                ([kind, key]) => (
                                  <option key={kind} value={kind}>
                                    {t(
                                      `settings.workforce.absences.kinds.${key}`,
                                    )}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <label className="block">
                            <span className={LABEL}>
                              {t("settings.workforce.absences.note")}
                            </span>
                            <input
                              name="note"
                              maxLength={500}
                              className={INPUT}
                            />
                          </label>
                        </div>
                        <button type="submit" className={BUTTON}>
                          <Icon name="plus" className="h-4 w-4" />
                          {t("settings.workforce.absences.create")}
                        </button>
                      </form>
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </section>
      )}

      {canManageDispatch && (
        <section aria-labelledby="workforce-capacity-title" className={CARD}>
          <div>
            <h2
              id="workforce-capacity-title"
              className="flex items-center gap-2 text-base font-black text-[var(--ink,#101310)]"
            >
              <Icon name="clock" className="h-4 w-4" />
              {t("settings.workforce.capacity.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.workforce.capacity.hint")}
            </p>
            <p className={`mt-1 ${HINT}`}>
              {t("settings.workforce.capacity.fallbackHint")}
            </p>
          </div>

          <form
            action="/innstillinger"
            method="get"
            className="grid grid-cols-1 gap-3 border-y border-[var(--line,#dedcd1)] py-3 sm:grid-cols-4"
          >
            <input type="hidden" name="tab" value="kompetanse" />
            {selectedStaffId && (
              <input type="hidden" name="staff" value={selectedStaffId} />
            )}
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.department")}
              </span>
              <select
                name="department"
                defaultValue={capacityDepartmentId}
                className={INPUT}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.from")}
              </span>
              <input
                type="date"
                name="fra"
                defaultValue={capacityFrom}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.to")}
              </span>
              <input
                type="date"
                name="til"
                defaultValue={capacityTo}
                className={INPUT}
              />
            </label>
            <div className="flex items-end">
              <button type="submit" className={`${BUTTON} w-full`}>
                <Icon name="check" className="h-4 w-4" />
                {t("settings.workforce.capacity.filter")}
              </button>
            </div>
          </form>

          {capacityPlans.length === 0 ? (
            <p className="text-sm italic text-[var(--muted,#62685f)]">
              {t("settings.workforce.capacity.empty")}
            </p>
          ) : (
            <ul className="space-y-2">
              {capacityPlans.map((plan) => (
                <li
                  key={plan.id}
                  className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[var(--ink,#101310)]">
                        {plan.date} ·{" "}
                        {plan.technicianName ??
                          t(
                            "settings.workforce.capacity.departmentWide",
                          )}
                      </p>
                      <p className="text-xs text-[var(--muted,#62685f)]">
                        {t("settings.workforce.capacity.current", {
                          minutes: plan.capacityMinutes,
                        })}
                      </p>
                    </div>
                    <form action={deleteCapacityPlan}>
                      <input type="hidden" name="id" value={plan.id} />
                      <input
                        type="hidden"
                        name="department"
                        value={plan.departmentId}
                      />
                      <button type="submit" className={DANGER}>
                        {t("settings.workforce.capacity.delete")}
                      </button>
                    </form>
                  </div>
                  <form
                    action={saveCapacityPlan}
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <input
                      type="hidden"
                      name="departmentId"
                      value={plan.departmentId}
                    />
                    <input type="hidden" name="date" value={plan.date} />
                    <input
                      type="hidden"
                      name="technicianId"
                      value={plan.technicianId ?? ""}
                    />
                    <label className="block">
                      <span className={LABEL}>
                        {t("settings.workforce.capacity.minutes")}
                      </span>
                      <input
                        type="number"
                        name="capacityMinutes"
                        min={0}
                        max={1440}
                        step={1}
                        required
                        defaultValue={plan.capacityMinutes}
                        className={INPUT}
                      />
                    </label>
                    <button type="submit" className={BUTTON}>
                      <Icon name="check" className="h-4 w-4" />
                      {t("settings.workforce.capacity.save")}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form
            action={saveCapacityPlan}
            className="grid grid-cols-1 gap-3 border-t border-[var(--line,#dedcd1)] pt-4 sm:grid-cols-4"
          >
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.department")}
              </span>
              <select
                name="departmentId"
                defaultValue={capacityDepartmentId}
                required
                className={INPUT}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.date")}
              </span>
              <input
                type="date"
                name="date"
                required
                defaultValue={capacityFrom}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.technician")}
              </span>
              <select name="technicianId" className={INPUT}>
                <option value="">
                  {t("settings.workforce.capacity.departmentWide")}
                </option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name ?? person.email ?? person.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.workforce.capacity.minutes")}
              </span>
              <input
                type="number"
                name="capacityMinutes"
                min={0}
                max={1440}
                step={1}
                required
                defaultValue={480}
                className={INPUT}
              />
            </label>
            <div className="sm:col-span-4">
              <button type="submit" className={BUTTON}>
                <Icon name="plus" className="h-4 w-4" />
                {t("settings.workforce.capacity.save")}
              </button>
            </div>
          </form>
        </section>
      )}

      {!canReadSkills && !canManageDispatch && (
        <p className="office-card p-4 text-sm italic text-[var(--muted,#62685f)]">
          {t("settings.workforce.readOnlyHint")}
        </p>
      )}

      {selectedStaffId && !canManageUsers && skillById.size > 0 && (
        <p className={HINT}>
          {t("settings.workforce.userSkills.hidden")}
        </p>
      )}
    </div>
  );
}
