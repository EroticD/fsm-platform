"use client";

import {
  useId,
  useRef,
  useState,
  type FormHTMLAttributes,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

type FormIssue = {
  fieldId: string;
  name: string;
  label: string;
  message: string;
};

type Control =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

function isControl(element: Element): element is Control {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function controlLabel(control: Control): string {
  const aria = control.getAttribute("aria-label");
  if (aria) return aria;

  if (control.id) {
    const explicit = document.querySelector<HTMLLabelElement>(
      `label[for="${CSS.escape(control.id)}"]`,
    );
    if (explicit?.textContent?.trim()) {
      return explicit.textContent.replace(/\s*\*\s*$/, "").trim();
    }
  }

  const wrapping = control.closest("label");
  if (wrapping?.textContent?.trim()) {
    return wrapping.textContent.replace(/\s*\*\s*$/, "").trim();
  }

  return control.name || control.id || "Felt";
}

function safeId(name: string, fallback: string): string {
  const normalized = name
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `field-${normalized || fallback}`;
}

/**
 * Felles skjemavalidering med feltspesifikke meldinger.
 *
 * Nettleserens egne valideringsmeldinger er ofte korte og på nettleserens
 * språk. Denne komponenten bruker de samme begrensningene (`required`, `type`,
 * `min`, `max`, `minLength`, `maxLength`, `pattern`), men viser en samlet
 * oppsummering på appens språk, lenker til hvert felt, fokuserer første feil
 * og setter en tydelig melding rett under feltet.
 *
 * Serveren validerer fortsatt alt på nytt. Komponenten er bare et raskere og
 * tydeligere første hinder.
 */
export default function ValidatedForm({
  children,
  labels,
  className = "",
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  labels?: Record<string, string>;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const formRef = useRef<HTMLFormElement>(null);
  const prefix = useId().replace(/[^a-zA-Z0-9_-]+/g, "");
  const [issues, setIssues] = useState<FormIssue[]>([]);

  function messageFor(control: Control, label: string): string {
    const validity = control.validity;
    if (validity.valueMissing) {
      return t("components.formErrors.required", { field: label });
    }
    if (validity.typeMismatch) {
      return control.type === "email"
        ? t("components.formErrors.email", { field: label })
        : t("components.formErrors.invalid", { field: label });
    }
    if (validity.badInput) {
      return control.type === "date"
        ? t("components.formErrors.date", { field: label })
        : t("components.formErrors.invalid", { field: label });
    }
    if (validity.rangeUnderflow) {
      return t("components.formErrors.min", {
        field: label,
        min: control.getAttribute("min") ?? "",
      });
    }
    if (validity.rangeOverflow) {
      return t("components.formErrors.max", {
        field: label,
        max: control.getAttribute("max") ?? "",
      });
    }
    if (validity.tooShort) {
      return t("components.formErrors.minLength", {
        field: label,
        min: control.getAttribute("minlength") ?? "",
      });
    }
    if (validity.tooLong) {
      return t("components.formErrors.maxLength", {
        field: label,
        max: control.getAttribute("maxlength") ?? "",
      });
    }
    if (validity.patternMismatch) {
      return t("components.formErrors.pattern", { field: label });
    }
    return t("components.formErrors.invalid", { field: label });
  }

  function clearInlineError(control: Control) {
    const describedBy = control
      .getAttribute("aria-describedby")
      ?.split(/\s+/)
      .filter(Boolean) ?? [];
    const kept = describedBy.filter((token) => {
      if (!token.startsWith(`${prefix}-`)) return true;
      document.getElementById(token)?.remove();
      return false;
    });
    if (kept.length > 0) {
      control.setAttribute("aria-describedby", kept.join(" "));
    } else {
      control.removeAttribute("aria-describedby");
    }
    control.removeAttribute("aria-invalid");
  }

  function showInlineError(control: Control, issue: FormIssue) {
    clearInlineError(control);
    const paragraph = document.createElement("p");
    paragraph.id = `${prefix}-${issue.fieldId}-error`;
    paragraph.className =
      "type-meta mt-1 font-bold text-[var(--risk-text,#b42318)]";
    paragraph.setAttribute("role", "alert");
    paragraph.textContent = issue.message;
    control.insertAdjacentElement("afterend", paragraph);
    const existing = control
      .getAttribute("aria-describedby")
      ?.split(/\s+/)
      .filter(Boolean) ?? [];
    control.setAttribute("aria-invalid", "true");
    control.setAttribute(
      "aria-describedby",
      [...existing, paragraph.id].join(" "),
    );
  }

  function validate(form: HTMLFormElement): FormIssue[] {
    const found: FormIssue[] = [];
    const seen = new Set<string>();

    for (const element of Array.from(form.elements)) {
      if (!isControl(element)) continue;
      if (element.disabled || element.type === "hidden") continue;
      if (!element.willValidate) continue;

      const name = element.name || element.id;
      if (!name) continue;

      if (!element.checkValidity()) {
        const label = labels?.[element.name] ?? controlLabel(element);
        const fieldId =
          element.id || safeId(name, `${seen.size + 1}`);
        element.id = fieldId;
        const issue: FormIssue = {
          fieldId,
          name,
          label,
          message: messageFor(element, label),
        };
        found.push(issue);
        seen.add(fieldId);
        showInlineError(element, issue);
      } else {
        clearInlineError(element);
      }
    }

    return found;
  }

  return (
    <form
      {...props}
      ref={formRef}
      className={className}
      noValidate
      onSubmit={(event) => {
        const form = event.currentTarget;
        const found = validate(form);
        setIssues(found);
        if (found.length > 0) {
          event.preventDefault();
          const first = form.querySelector<HTMLElement>(
            `#${CSS.escape(found[0].fieldId)}`,
          );
          first?.focus();
          first?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        props.onSubmit?.(event);
      }}
    >
      {issues.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-2xl border-2 border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-4 py-3 text-sm text-[var(--risk-text,#b42318)]"
        >
          <p className="font-bold">
            {t("components.formErrors.summary", { count: issues.length })}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {issues.map((issue) => (
              <li key={issue.fieldId}>
                <a
                  href={`#${issue.fieldId}`}
                  className="font-bold underline decoration-2 underline-offset-2"
                  onClick={(event) => {
                    event.preventDefault();
                    const target = formRef.current?.querySelector<HTMLElement>(
                      `#${CSS.escape(issue.fieldId)}`,
                    );
                    target?.focus();
                    target?.scrollIntoView({
                      block: "center",
                      behavior: "smooth",
                    });
                  }}
                >
                  {issue.label}
                </a>
                {": "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </form>
  );
}
