"use client";

import { useState } from "react";

export default function WorkOrderForm({
  workOrderId,
  template,
  submitAction
}: {
  workOrderId: string;
  template: any;
  submitAction: (formData: FormData) => void;
}) {
  const [includeReport, setIncludeReport] = useState<boolean>(!!template);

  // Parse feltene fra malen trygt
  let fields: any[] = [];
  if (template && template.fieldsJson) {
    try {
      const parsed = JSON.parse(template.fieldsJson);
      if (Array.isArray(parsed)) {
        fields = parsed.map(f => typeof f === 'string' ? { label: f, requirePhoto: false, requireComment: false } : f);
      }
    } catch (e) {
      fields = [];
    }
  }

  return (
    <form action={submitAction} className="bg-white p-5 rounded-2xl shadow-sm border space-y-6">
      <input type="hidden" name="includeReport" value={includeReport ? "true" : "false"} />

      <h2 className="font-bold text-gray-800 text-lg border-b pb-2">Fullfør oppdrag</h2>

      {template && (
        <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl border border-blue-100">
          <div>
            <p className="font-bold text-blue-900 text-sm">Sjekklistemal: {template.title}</p>
            <p className="text-xs text-blue-700">Vil du fylle ut sjekklisten for denne jobben?</p>
          </div>
          <button
            type="button"
            onClick={() => setIncludeReport(!includeReport)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${includeReport ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            {includeReport ? "Sjekkliste aktiv" : "Aktiver sjekkliste"}
          </button>
        </div>
      )}

      {/* Hvis sjekkliste er aktiv og malen har punkter */}
      {includeReport && template && fields.length > 0 && (
        <div className="space-y-4 border-t pt-4">
          <h3 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Sjekkpunkter</h3>
          
          {fields.map((field, idx) => (
            <div key={idx} className="bg-gray-50 p-4 rounded-xl border space-y-3">
              
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-bold text-gray-800 text-sm block">🔹 {field.label}</span>
                  <div className="flex gap-2 mt-1">
                    {field.requirePhoto && <span className="text-[9px] uppercase tracking-wider bg-red-100 text-red-800 px-2 py-0.5 rounded font-bold">📷 Bilde påkrevd</span>}
                    {field.requireComment && <span className="text-[9px] uppercase tracking-wider bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded font-bold">💬 Kommentar påkrevd</span>}
                  </div>
                </div>
                
                {/* Ja/Nei valg */}
                <div className="flex gap-2">
                  <label className="cursor-pointer bg-white border px-3 py-1 rounded-lg text-xs font-bold text-green-700 hover:bg-green-50 flex items-center gap-1 shadow-sm">
                    <input type="radio" name={`field_${idx}`} value="Ja" defaultChecked className="text-green-600" />
                    <span>OK (Ja)</span>
                  </label>
                  <label className="cursor-pointer bg-white border px-3 py-1 rounded-lg text-xs font-bold text-red-700 hover:bg-red-50 flex items-center gap-1 shadow-sm">
                    <input type="radio" name={`field_${idx}`} value="Nei" className="text-red-600" />
                    <span>Avvik (Nei)</span>
                  </label>
                </div>
              </div>

              {/* Kommentarfelt per punkt */}
              <div>
                <input 
                  type="text" 
                  name={`comment_${idx}`} 
                  placeholder="Legg til kommentar eller avviksnotat her..." 
                  className="w-full border p-2 rounded-lg text-xs text-gray-800 bg-white" 
                  required={field.requireComment}
                />
              </div>

              {/* Bildeopplasting per punkt */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Legg ved bilde for dette punktet:
                </label>
                <input 
                  type="file" 
                  name={`photo_${idx}`} 
                  accept="image/*" 
                  capture="environment" // Åpner kameraet direkte på mobil
                  required={field.requirePhoto}
                  className="text-xs text-gray-500 w-full bg-white p-2 rounded border" 
                />
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Generelle kommentarer */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Sluttkommentar / oppsummering</label>
        <textarea name="comments" rows={3} placeholder="Skriv en kort oppsummering av jobben..." className="w-full border p-3 rounded-xl text-sm text-gray-800"></textarea>
      </div>

      {/* Signatur */}
      {includeReport && template && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Kundesignatur (Navn)</label>
          <input type="text" name="signature" placeholder="Skriv kundens fulle navn..." className="w-full border p-3 rounded-xl text-sm text-gray-800" />
        </div>
      )}

      <button type="submit" className="w-full bg-green-600 text-white py-3 rounded-xl font-bold text-base hover:bg-green-700 transition shadow-sm">
        Lagre og fullfør oppdrag
      </button>
    </form>
  );
}
