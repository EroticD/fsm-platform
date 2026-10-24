"use client";

export default function Error({ error }: { error: Error }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md w-full">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Noe gikk galt</h2>
        <p className="text-gray-600 mb-4">{error.message || "En feil oppstod"}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 transition"
        >
          Prøv igjen
        </button>
      </div>
    </div>
  );
}
