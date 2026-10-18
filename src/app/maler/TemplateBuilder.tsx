"use client";

import { useState } from "react";

export default function TemplateBuilder({ saveAction }: { saveAction: (formData: FormData) => void }) {
  const [fields, setFields] = useState<string[]>(["Visuell inspeksjon utført", ""]);

  // Funksjoner for å håndtere feltene
  const updateField = (index: number, value: string) => {
    const newFields = [...fields];
    newFields[index] = value;
    setFields(newFields);
  };

  const addField = () => setFields([...fields, ""]);
  
  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  return (
    <form action={saveAction} className="bg-white p-6 rounded-xl shadow-sm border mb-8">
      <h2 className="text-xl font-semibold mb-4 text-gray-800">Lag ny sjekkliste-mal</h2>
      
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-1">Navn på mal (f.eks. «Årlig Service»)</label>
        <input type="text" name="title" required className="w-full border p-2 rounded text-gray-800" placeholder="Skriv inn tittel..." />
      </div>

      <div className="mb-6 space-y-3">
        <label className="block text-sm font-semibold text-gray-700">Sjekkliste-punkter (Ja/Nei-spørsmål)</label>
        {fields.map((field, index) => (
          <div key={index} className="flex gap-2">
            <input 
              type="text" 
              value={field}
              onChange={(e) => updateField(index, e.target.value)}
              className="flex-1 border p-2 rounded text-gray-800"
              placeholder={`Spørsmål ${index + 1}...`}
            />
            <button 
              type="button" 
              onClick={() => removeField(index)}
              className="bg-red-50 text-red-600 px-3 py-2 rounded hover:bg-red-100 font-bold"
            >
              X
            </button>
          </div>
        ))}
        <button 
          type="button" 
          onClick={addField}
          className="text-blue-600 text-sm font-bold hover:underline mt-2"
        >
          + Legg til nytt punkt
        </button>
      </div>

      {/* Vi lagrer feltene som en JSON-streng i bakgrunnen */}
      <input type="hidden" name="fieldsJson" value={JSON.stringify(fields.filter(f => f.trim() !== ""))} />

      <button type="submit" className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 font-bold">
        Lagre mal
      </button>
    </form>
  );
}
