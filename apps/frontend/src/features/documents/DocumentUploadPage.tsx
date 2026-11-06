import {
  MAX_DOCUMENTS_PER_SUBMISSION,
  type AnimalDocumentType,
} from '@anico/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, FileUp, Trash2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { animalKey, animalQuery } from '@/features/animals/api';
import type { ResultState } from '@/features/animals/ResultMessage';
import { sessionGeneration, useCurrentSession } from '@/features/auth';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { controlClassName } from '@/shared/ui/field';
import { PageHeader } from '@/shared/ui/page-header';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_TYPE_LABEL,
  DOCUMENT_TYPES,
  documentErrorText,
  fileProblem,
  submitDocuments,
} from './api';

type Row = {
  key: number;
  file: File;
  documentType: AnimalDocumentType | '';
  problem: string | null;
};

const countText = (count: number) =>
  count === 1
    ? '1 doklad byl odeslán'
    : count >= 2 && count <= 4
      ? `${count} doklady byly odeslány`
      : `${count} dokladů bylo odesláno`;

/**
 * WF 02/03: výběr jednoho či více souborů, ke každému povinný typ. Nepodporovaný formát
 * zůstane v seznamu označený a odeslání zablokuje; vše se odešle jedním požadavkem.
 */
export function DocumentUploadPage() {
  const { animalId = '' } = useParams();
  const animal = useQuery(animalQuery(animalId));
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const nextKey = useRef(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [limitProblem, setLimitProblem] = useState<string>();
  const detail = `/zvirata/${animalId}`;

  const mutation = useMutation({
    mutationFn: async (
      items: { file: File; documentType: AnimalDocumentType }[],
    ) => {
      const generation = sessionGeneration(client);
      const saved = await submitDocuments(animalId, items, session.csrfToken);
      return { generation, count: saved.documents.length };
    },
    onSuccess: async ({ generation, count }) => {
      // Odpověď z relace jiného účtu nesmí měnit cache ani přesměrovat.
      const current = () => generation === sessionGeneration(client);
      if (!current()) return;
      await client.invalidateQueries({ queryKey: animalKey });
      if (!current()) return;
      void navigate(detail, {
        state: {
          result: `${countText(count)} k posouzení. Výsledek uvidíte u dokladů.`,
        } satisfies ResultState,
      });
    },
  });

  function addFiles(selected: File[]) {
    const free = MAX_DOCUMENTS_PER_SUBMISSION - rows.length;
    const accepted = selected.slice(0, Math.max(0, free));
    setLimitProblem(
      accepted.length < selected.length
        ? `Jedno podání může mít nejvýše ${MAX_DOCUMENTS_PER_SUBMISSION} dokladů. Další soubory nebyly přidány.`
        : undefined,
    );
    setRows((current) => [
      ...current,
      ...accepted.map((file) => ({
        key: nextKey.current++,
        file,
        documentType: '' as const,
        problem: fileProblem(file),
      })),
    ]);
  }

  const setType = (key: number, documentType: AnimalDocumentType | '') =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, documentType } : row)),
    );

  const removeRow = (key: number) => {
    setRows((current) => current.filter((row) => row.key !== key));
    setLimitProblem(undefined);
  };

  const missingFiles = rows.length === 0;
  const invalidFiles = rows.filter((row) => row.problem).length;
  const missingTypes = rows.filter((row) => !row.documentType).length;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (missingFiles || invalidFiles || missingTypes) return;
    mutation.mutate(
      rows.map(({ file, documentType }) => ({
        file,
        documentType: documentType as AnimalDocumentType,
      })),
    );
  }

  const formProblems = submitted
    ? [
        missingFiles && 'Vyberte alespoň jeden soubor.',
        invalidFiles > 0 &&
          'Odeberte soubory, které nelze nahrát (označené červeně).',
        missingTypes > 0 && 'Ke každému souboru vyberte typ dokladu.',
      ].filter((problem): problem is string => Boolean(problem))
    : [];

  return (
    <section className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <Link
          to={detail}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Zpět na detail
        </Link>
        <PageHeader
          eyebrow="Doklady zvířete"
          title="Nahrát doklady"
          description={
            animal.data
              ? `Zvíře ${animal.data.name}. Každý soubor je samostatný doklad a posoudí se zvlášť.`
              : 'Každý soubor je samostatný doklad a posoudí se zvlášť.'
          }
        />
      </div>
      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset disabled={mutation.isPending} className="space-y-6">
          <legend className="sr-only">Nahrání dokladů</legend>
          <Card className="space-y-5 rounded-2xl p-6">
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input bg-muted/50 px-4 py-8 text-center text-sm transition hover:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
                submitted && missingFiles && 'border-destructive',
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <FileUp className="size-6 text-muted-foreground" aria-hidden />
              <span className="font-medium">Vybrat soubory</span>
              <span className="text-xs text-muted-foreground">
                PDF, JPEG nebo PNG, nejvýše 10 MiB na soubor a{' '}
                {MAX_DOCUMENTS_PER_SUBMISSION} dokladů najednou ({rows.length}/
                {MAX_DOCUMENTS_PER_SUBMISSION})
              </span>
              <input
                type="file"
                multiple
                accept={DOCUMENT_ACCEPT}
                className="sr-only"
                aria-label="Soubory dokladů"
                onChange={(event) => {
                  addFiles(Array.from(event.target.files ?? []));
                  event.target.value = '';
                }}
              />
            </label>
            {limitProblem && (
              <Alert
                variant="error"
                onDismiss={() => setLimitProblem(undefined)}
              >
                {limitProblem}
              </Alert>
            )}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Zatím nejsou vybrané žádné soubory.
              </p>
            ) : (
              <ul className="space-y-3" aria-label="Vybrané soubory">
                {rows.map((row) => {
                  const selectId = `document-type-${row.key}`;
                  const typeError =
                    submitted && !row.documentType && !row.problem
                      ? 'Vyberte typ dokladu.'
                      : undefined;
                  return (
                    <li
                      key={row.key}
                      aria-label={row.file.name}
                      className={cn(
                        'flex flex-wrap items-start gap-3 rounded-xl border p-3',
                        row.problem
                          ? 'border-destructive/40 bg-destructive-soft'
                          : 'border-border',
                      )}
                    >
                      <FileText
                        className={cn(
                          'mt-2 size-5 shrink-0',
                          row.problem
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-sm font-medium break-all">
                          {row.file.name}
                        </p>
                        {row.problem ? (
                          <p className="text-xs font-medium text-destructive">
                            {row.problem}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            <label
                              htmlFor={selectId}
                              className="block text-xs font-medium"
                            >
                              Typ dokladu{' '}
                              <span className="sr-only">
                                pro {row.file.name}
                              </span>
                              <span className="text-destructive" aria-hidden>
                                {' '}
                                *
                              </span>
                            </label>
                            <select
                              id={selectId}
                              aria-required
                              aria-invalid={typeError ? true : undefined}
                              aria-describedby={
                                typeError ? `${selectId}-error` : undefined
                              }
                              className={controlClassName}
                              value={row.documentType}
                              onChange={(event) =>
                                setType(
                                  row.key,
                                  event.target.value as AnimalDocumentType | '',
                                )
                              }
                            >
                              <option value="">Vyberte typ</option>
                              {DOCUMENT_TYPES.map((type) => (
                                <option key={type} value={type}>
                                  {DOCUMENT_TYPE_LABEL[type]}
                                </option>
                              ))}
                            </select>
                            {typeError && (
                              <p
                                id={`${selectId}-error`}
                                className="text-xs font-medium text-destructive"
                              >
                                {typeError}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Odebrat ${row.file.name}`}
                        onClick={() => removeRow(row.key)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {formProblems.length > 0 && (
            <Alert variant="error" onDismiss={() => setSubmitted(false)}>
              <ul className="space-y-1">
                {formProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          )}
          {mutation.isError && (
            <Alert variant="error" onDismiss={() => mutation.reset()}>
              {documentErrorText(mutation.error)}
            </Alert>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => void navigate(detail)}>
              Zrušit
            </Button>
            <Button type="submit">
              {mutation.isPending ? 'Odesílám…' : 'Odeslat k posouzení'}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
