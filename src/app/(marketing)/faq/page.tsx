export const metadata = {
  title: "FAQ — Tabular Data Management",
  description: "Common questions about the trial, your data, and permissions.",
};

const FAQS = [
  {
    q: "What happens when my 30-day trial ends?",
    a: "Your data becomes read-only: you and your team can still view and export everything, but new rows, edits and imports are blocked until a plan is set up. Nothing is deleted.",
  },
  {
    q: "Can I export my data at any time?",
    a: "Yes. Anyone with view access to a table can export it as CSV, XLSX or JSON, including during a read-only trial. Your data is never locked in.",
  },
  {
    q: "How do employee permissions work?",
    a: "Your company admin grants each employee view, create, edit, delete, import and export access on a per-table basis. An employee with no grants on a table cannot see it at all.",
  },
  {
    q: "Who can see my company's data?",
    a: "Only the members you invite to your company, with the access you grant them. Platform administrators manage billing and company status but do not have standing access to your tables' data.",
  },
  {
    q: "What file formats can I import?",
    a: "CSV, XLSX and JSON. You will see a preview of what will be imported, including any rows that have errors, before anything is saved.",
  },
  {
    q: "What happens if my company is suspended?",
    a: "A suspended company's data becomes completely inaccessible to its members until it is reactivated. This is different from a lapsed trial, which stays readable.",
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Frequently asked questions</h1>
      <dl className="mt-8 flex flex-col gap-6">
        {FAQS.map((item) => (
          <div key={item.q}>
            <dt className="font-medium">{item.q}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{item.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
