"use client";

import { useState } from "react";
import { STATUS_DEFAULT_COMMENT_OPTIONS, STATUS_DEFAULT_OPTIONS } from "@/lib/report-answers";

export type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "CHECKBOX"
  | "SELECT"
  | "STATUS"
  | "NUMBER"
  | "SIGNATURE"
  | "IMAGE"
  | "DATE";

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[]; // For SELECT og STATUS
  /** For STATUS: valgene som krever at montøren skriver en kommentar. */
  commentOptions?: string[];
  // IFTTT (Conditional Logic)
  conditionalFieldId?: string; // Hvilket felt må trigge dette?
  conditionalValue?: string;   // Hvilken verdi må det feltet ha for at dette skal vises?
}

export default function TemplateBuilder({ 
  initialTitle, 
  initialFieldsJson, 
  saveAction,
  templateId,
}: { 
  initialTitle: string; 
  initialFieldsJson: string; 
  saveAction: (formData: FormData) => Promise<void> | void;
  templateId: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  
  const [fields, setFields] = useState<FormField[]>(() => {
    try {
      const parsed = JSON.parse(initialFieldsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const addField = (type: FieldType) => {
    const newField: FormField = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      label: "",
      required: false,
      options:
        type === "SELECT"
          ? ["Alternativ 1", "Alternativ 2"]
          : type === "STATUS"
            ? [...STATUS_DEFAULT_OPTIONS]
            : undefined,
      commentOptions: type === "STATUS" ? [...STATUS_DEFAULT_COMMENT_OPTIONS] : undefined,
    };
    setFields([...fields, newField]);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const moveField = (index: number, direction: "UP" | "DOWN") => {
    if (direction === "UP" && index > 0) {
      const newFields = [...fields];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      setFields(newFields);
    } else if (direction === "DOWN" && index < fields.length - 1) {
      const newFields = [...fields];
      [newFields[index + 1], newFields[index]] = [newFields[index], newFields[index + 1]];
      setFields(newFields);
    }
  };

  const updateOptions = (id: string, optionsString: string) => {
    const options = optionsString.split(",").map(o => o.trim()).filter(Boolean);
    updateField(id, { options });
  };

  return (
    <form action={saveAction} className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border-2 border-gray-200 space-y-8">
      
      <input type="hidden" name="fieldsJson" value={JSON.stringify(fields)} />
      <input type="hidden" name="id" value={templateId} />
      
      <div>
        <label className="block text-sm font-black text-gray-900 mb-1">Navn på sjekkliste</label>
        <input 
          type="text" 
          name="title" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required 
          className="w-full border-2 border-gray-300 p-3 rounded-xl text-lg text-gray-900 font-bold outline-none focus:border-blue-700 bg-white shadow-sm placeholder:text-gray-400" 
        />
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h2 className="text-lg font-black text-gray-900 mb-4">Skjemafelt & Logikk (IFTTT)</h2>
        
        {fields.length === 0 ? (
          <div className="bg-blue-50 border-2 border-blue-200 p-8 rounded-xl text-center">
            <p className="text-blue-900 font-bold mb-1">Denne malen har ingen felt ennå.</p>
            <p className="text-sm text-blue-800 font-medium">Bruk knappene under for å bygge opp skjemaet med ønskede felttyper.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {fields.map((field, index) => (
              <div key={field.id} className="bg-gray-50 border-2 border-gray-200 p-5 rounded-2xl group shadow-sm space-y-4">
                
                <div className="flex gap-4 items-start">
                  {/* Pil opp/ned */}
                  <div className="flex flex-col gap-1 mt-1">
                    <button 
                      type="button" 
                      onClick={() => moveField(index, "UP")} 
                      disabled={index === 0} 
                      className="text-gray-700 hover:text-gray-900 bg-white border border-gray-300 rounded p-1 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-white transition"
                      title="Flytt opp"
                    >
                      ▲
                    </button>
                    <button 
                      type="button" 
                      onClick={() => moveField(index, "DOWN")} 
                      disabled={index === fields.length - 1} 
                      className="text-gray-700 hover:text-gray-900 bg-white border border-gray-300 rounded p-1 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-white transition"
                      title="Flytt ned"
                    >
                      ▼
                    </button>
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="text-xs font-black text-blue-900 bg-blue-100 border border-blue-200 px-3 py-1 rounded-md uppercase tracking-wider">
                        {field.type === "TEXT" && "Kort Tekst"}
                        {field.type === "TEXTAREA" && "Lang Tekst"}
                        {field.type === "CHECKBOX" && "Avkrysningsboks"}
                        {field.type === "SELECT" && "Nedtrekksmeny"}
                        {field.type === "STATUS" && "Tilstand + kommentar"}
                        {field.type === "NUMBER" && "Tallverdi"}
                        {field.type === "SIGNATURE" && "Signatur"}
                        {field.type === "IMAGE" && "Bildeopplasting"}
                        {field.type === "DATE" && "Dato"}
                      </span>
                      
                      <label className="flex items-center gap-2 text-sm font-bold text-gray-900 cursor-pointer hover:bg-gray-200 px-2 py-1 rounded transition">
                        <input 
                          type="checkbox" 
                          checked={field.required} 
                          onChange={(e) => updateField(field.id, { required: e.target.checked })} 
                          className="w-4 h-4 text-blue-700 rounded border-gray-400 focus:ring-blue-600 cursor-pointer" 
                        />
                        Påkrevd felt
                      </label>
                    </div>
                    
                    <input 
                      type="text" 
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                      placeholder="Skriv spørsmål eller feltnavn..." 
                      className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-bold outline-none focus:border-blue-700 bg-white placeholder:text-gray-400 shadow-sm"
                    />

                    {(field.type === "SELECT" || field.type === "STATUS") && (
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">Alternativer (separeres med komma):</label>
                        <input 
                          type="text" 
                          value={field.options?.join(", ") || ""}
                          onChange={(e) => updateOptions(field.id, e.target.value)}
                          placeholder={field.type === "STATUS" ? "F.eks. OK, Avvik, Utbedres, Ikke aktuelt" : "F.eks. God, Middels, Dårlig"}
                          className="w-full border border-gray-300 p-2.5 rounded-lg text-xs font-medium bg-white"
                        />
                      </div>
                    )}

                    {field.type === "STATUS" && (
                      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3">
                        <label className="block text-xs font-black text-amber-900 mb-1">
                          💬 Kommentar kreves ved disse valgene (separeres med komma):
                        </label>
                        <input
                          type="text"
                          value={(field.commentOptions ?? []).join(", ")}
                          onChange={(e) =>
                            updateField(field.id, {
                              commentOptions: e.target.value
                                .split(",")
                                .map((o) => o.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="F.eks. Avvik, Utbedres"
                          className="w-full border border-amber-300 p-2.5 rounded-lg text-xs font-medium bg-white"
                        />
                        <p className="text-[11px] text-amber-800 mt-1">
                          Når montøren velger et av disse, må han skrive en kommentar på den linjen.
                          Tøm feltet for å aldri kreve kommentar.
                        </p>
                      </div>
                    )}
                  </div>

                  <button 
                    type="button" 
                    onClick={() => removeField(field.id)} 
                    className="mt-1 text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 font-bold p-2.5 rounded-lg transition"
                    title="Slett felt"
                  >
                    Slett
                  </button>
                </div>

                {/* IFTTT (Conditional Logic) Inndeling */}
                <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200 flex flex-col md:flex-row gap-3 items-center text-xs">
                  <span className="font-black text-blue-900 whitespace-nowrap">⚡ Betingelse (If This Then That):</span>
                  
                  <select 
                    value={field.conditionalFieldId || ""}
                    onChange={(e) => updateField(field.id, { conditionalFieldId: e.target.value || undefined })}
                    className="border border-blue-300 p-2 rounded-lg bg-white font-bold text-gray-800 flex-1 outline-none"
                  >
                    <option value="">-- Alltid synlig (Ingen betingelse) --</option>
                    {fields.filter(f => f.id !== field.id).map(f => (
                      <option key={f.id} value={f.id}>Vis kun hvis: {f.label || "Uten navn"}</option>
                    ))}
                  </select>

                  {field.conditionalFieldId && (
                    <input 
                      type="text" 
                      value={field.conditionalValue || ""}
                      onChange={(e) => updateField(field.id, { conditionalValue: e.target.value })}
                      placeholder="Krev verdi (f.eks. 'true' eller 'Ja')"
                      className="border border-blue-300 p-2 rounded-lg bg-white font-bold text-gray-800 outline-none w-48"
                    />
                  )}
                </div>

              </div>
            ))}
          </div>
        )}
      </div>

      {/* Velg felttype */}
      <div className="space-y-2 pt-2">
        <p className="text-xs font-black text-gray-500 uppercase tracking-wider">Legg til nytt sjekkpunkt:</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => addField("CHECKBOX")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Sjekkboks
          </button>
          <button type="button" onClick={() => addField("TEXT")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Kort Tekst
          </button>
          <button type="button" onClick={() => addField("TEXTAREA")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Lang Tekst
          </button>
          <button type="button" onClick={() => addField("SELECT")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Nedtrekksmeny
          </button>
          <button type="button" onClick={() => addField("STATUS")} className="bg-white text-gray-900 border-2 border-blue-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-blue-50 transition shadow-sm">
            + Tilstand (OK/Avvik/Utbedres)
          </button>
          <button type="button" onClick={() => addField("NUMBER")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Tallverdi
          </button>
          <button type="button" onClick={() => addField("IMAGE")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Bildeopplasting
          </button>
          <button type="button" onClick={() => addField("DATE")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Dato
          </button>
          <button type="button" onClick={() => addField("SIGNATURE")} className="bg-white text-gray-900 border-2 border-gray-300 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm">
            + Signatur
          </button>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <button type="submit" className="w-full bg-blue-700 text-white py-4 rounded-xl font-black hover:bg-blue-800 transition shadow-md text-lg tracking-wide">
          💾 Lagre Mal med Logikk
        </button>
      </div>
    </form>
  );
}
