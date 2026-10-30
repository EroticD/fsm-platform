/** Felles fane-innpakning med tittel og beskrivelse. */
export default function CustomerTabPanel({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4">
      <div>
        <h2 className="font-black text-gray-900 border-b pb-2 text-base">{title}</h2>
        {description ? <p className="text-xs text-gray-500 mt-2">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
