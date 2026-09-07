import { useProjectStore } from '@store/projectStore';
import { Field, Section } from '@ui/components/inputs';

export function BusinessSettings() {
  const { project, updateProject } = useProjectStore();
  const business = project.business ?? {};
  const set = (key: keyof typeof business, value: string) => updateProject({ business: { ...business, [key]: value } });
  return <Section title="Your business & client pack" description="These details appear on the pack you give to the customer.">
    <div className="grid-2">{([['name', 'Business name'], ['email', 'Business email'], ['phone', 'Business phone'], ['website', 'Business website']] as const).map(([key, label]) => <Field key={key} label={label}><input type="text" aria-label={label} value={business[key] ?? ''} onChange={(e) => set(key, e.target.value)}/></Field>)}</div>
    <Field label="Business address"><textarea aria-label="Business address" rows={2} value={business.address ?? ''} onChange={(e) => set('address', e.target.value)}/></Field>
    <Field label="Standard client terms" hint="Your wording for payment, access, exclusions and quote validity. Job-specific notes can be added to each estimate."><textarea aria-label="Standard client terms" rows={4} value={business.terms ?? ''} onChange={(e) => set('terms', e.target.value)}/></Field>
  </Section>;
}
