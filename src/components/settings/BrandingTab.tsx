import BrandingLogoUpload from "@/components/BrandingLogoUpload";
import type { SettingsOverviewData } from "@/server/settings";

type BrandingTabProps = {
  branding: SettingsOverviewData["branding"];
  error?: string;
  saveBranding: (formData: FormData) => Promise<void>;
};

export default function BrandingTab({
  branding,
  error,
  saveBranding,
}: BrandingTabProps) {
  return (
    <div className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100">
      <h2 className="text-xl font-bold text-gray-900 mb-6">White-label Innstillinger</h2>
      {error === "logo" && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Logoen må lastes opp gjennom appen. Eksterne logo-URL-er er ikke tillatt.
        </div>
      )}
      <form action={saveBranding} className="space-y-5 max-w-md">
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Firmanavn</label>
          <input type="text" name="companyName" defaultValue={branding?.companyName || ""} placeholder="F.eks. Elektro Experten AS" required className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium" />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Hovedfarge (Hex-kode)</label>
          <div className="flex gap-3 items-center">
            <input type="color" name="primaryColor" defaultValue={branding?.primaryColor || "#2563eb"} className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300" />
            <input type="text" defaultValue={branding?.primaryColor || "#2563eb"} className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium bg-gray-50" readOnly />
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-700 mb-1">Firmalogo (valgfritt)</label>
          <BrandingLogoUpload initialUrl={branding?.logoUrl} />
          <p className="text-xs text-gray-500 mt-1">
            Brukes på rapporter, e-post og dashbord-header. Lastes opp til
            appen, ikke fra en ekstern adresse.
          </p>
        </div>
        <button type="submit" className="bg-[var(--primary-color)] text-white px-6 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
          Lagre endringer
        </button>
      </form>
    </div>
  );
}
