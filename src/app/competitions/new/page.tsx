import { CreateCompetitionForm } from '@/components/competitions/create-form';

export default function NewCompetitionPage() {
  return (
    <div>
      <h1 className="mb-8 text-3xl font-bold">Create Competition</h1>
      <div className="mx-auto max-w-3xl">
        <CreateCompetitionForm />
      </div>
    </div>
  );
}
