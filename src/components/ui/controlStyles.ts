/**
 * Felles utseende for Input/Select/Textarea. 44 px høyde og 16 px tekst
 * matcher berøringsmålet og hindrer iOS-zoom på mobil.
 */
export const controlBase =
  "w-full rounded-control border border-gray-300 bg-surface px-3 py-2 text-base text-gray-900 shadow-sm transition placeholder:text-gray-600 focus:border-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-danger";

export function controlClassName(className = "", extra = "") {
  return [controlBase, extra, className].filter(Boolean).join(" ");
}
