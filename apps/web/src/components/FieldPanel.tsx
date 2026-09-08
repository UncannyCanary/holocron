import type { RefObject } from 'react';
import type { DocumentCheck, DocumentField, FieldTrust } from '../lib/api';
import {
  checkHeadline,
  fieldText,
  isNeutral,
  type Panel,
  type Row,
  rowCurrency,
  type Segment,
} from '../lib/review-layout';
import { Kbd } from './Kbd';

const TRUST_LABELS: Record<FieldTrust, string> = {
  verified: 'Verified',
  unverifiable: 'Unverifiable',
  contradicted: 'Contradicted',
  corrected: 'Corrected',
};

// Worst first, so a reviewer reads the trouble before the rest.
const TRUST_ORDER: FieldTrust[] = ['contradicted', 'unverifiable', 'corrected', 'verified'];

const ROW = 'grid grid-cols-[148px_minmax(0,1fr)_92px] items-start gap-3 px-2 py-[7px]';

// "2 contradicted · 1 unverifiable · 8 verified", counting the values on
// screen and leaving out the states nothing is in. A value the document
// never printed is not counted at all: it shows "Not on the document"
// instead of a badge, so it has no state here to add up.
function countsLine(fields: DocumentField[]): string {
  const counted = fields.filter((each) => !isNeutral(each));
  return TRUST_ORDER.map((trust) => ({
    trust,
    many: counted.filter((each) => each.trust === trust).length,
  }))
    .filter((each) => each.many > 0)
    .map((each) => `${each.many} ${TRUST_LABELS[each.trust].toLowerCase()}`)
    .join(' · ');
}

type Editing = { fieldId: string; value: string } | null;

export type FieldPanelProps = {
  panel: Panel;
  checks: DocumentCheck[];
  selectedId: string | null;
  editing: Editing;
  saving: boolean;
  saveError: string | null;
  onPick: (field: DocumentField) => void;
  onEdit: (field: DocumentField) => void;
  onEditValue: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  // Where each field's row sits, so the keyboard can bring it into view.
  rows: RefObject<Map<string, HTMLElement | null>>;
  footer: string;
};

export function FieldPanel(props: FieldPanelProps) {
  const { panel, checks } = props;
  const failed = checks.filter((each) => !each.passed);
  const sorted = [...checks].sort((left, right) => Number(left.passed) - Number(right.passed));

  return (
    <div className="flex min-h-0 flex-col border-l border-line bg-panel">
      <div className="flex-1 overflow-auto px-4 pt-4.5">
        <div className="mb-2.5 flex items-baseline justify-between gap-3 px-2">
          <span className="font-serif text-[21px]">What the document says</span>
          <span className="text-xs text-ink-quiet">{countsLine(panel.order)}</span>
        </div>

        {failed.map((check) => (
          <FailedCheck key={check.id} check={check} {...props} />
        ))}

        {panel.groups.map((group) => (
          <div key={group.title}>
            <div className="caps mt-4 mb-0.5 px-2">{group.title}</div>
            {group.rows.map((row) => (
              <FieldRow key={row.key} row={row} {...props} />
            ))}
          </div>
        ))}

        <div className="caps mt-4 mb-1.5 px-2">Checks</div>
        <div className="flex flex-col gap-1.5 px-2 pb-6 text-note">
          {sorted.length === 0 && (
            <span className="text-ink-soft">
              This document has nothing to check against itself.
            </span>
          )}
          {sorted.map((check) => (
            <div key={check.id} className="flex items-start gap-2">
              <span
                className={`dot mt-1.5 ${check.passed ? 'dot-verified' : 'dot-contradicted'}`}
              />
              <span className={check.passed ? '' : 'text-needs-review'}>{check.message}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex h-10 flex-none items-center border-t border-line px-6 text-xs text-ink-quiet">
        {props.footer}
      </div>
    </div>
  );
}

// A check that did not pass, at the top where it is read first: what kind of
// problem it is, the numbers behind it, and the values it touches.
function FailedCheck({ check, panel, onPick }: FieldPanelProps & { check: DocumentCheck }) {
  const byId = new Map(panel.order.map((each) => [each.id, each]));
  const chips = [
    ...check.blamedFieldIds.map((id) => ({ id, blamed: true })),
    ...check.flaggedFieldIds.map((id) => ({ id, blamed: false })),
  ].filter((chip) => byId.has(chip.id));

  return (
    <div className="mb-3.5 rounded-md border border-needs-review-line bg-needs-review-bg/60 px-3.5 py-3">
      <div className="flex items-center gap-2 text-note font-semibold text-needs-review">
        <svg
          className="size-[15px] flex-none"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2.5 14 13H2z" />
          <path d="M8 6.5v3M8 11.5v.1" />
        </svg>
        {checkHeadline(check.name)}
      </div>
      <div className="mt-1.5 text-note leading-relaxed text-needs-review-ink">{check.message}</div>
      {chips.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onPick(byId.get(chip.id) as DocumentField)}
              className={`cursor-pointer rounded border px-[7px] py-[3px] text-xs ${
                chip.blamed
                  ? 'border-needs-review-line bg-card-raised text-needs-review'
                  : 'border-mostly-verified-bg bg-mostly-verified-bg text-mostly-verified'
              }`}
            >
              {panel.labelOf.get(chip.id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ row, ...props }: FieldPanelProps & { row: Row }) {
  const { rows, selectedId, editing } = props;
  const fieldsHere = [
    ...(row.labelField === null ? [] : [row.labelField]),
    ...row.segments.map((segment) => segment.field),
  ];
  const holdsSelection = fieldsHere.some((each) => each.id === selectedId);
  const beingEdited = editing !== null && fieldsHere.some((each) => each.id === editing.fieldId);
  const currency = rowCurrency(row);
  // Every value in the row is one the document never printed: a quiet line
  // instead of a badge, since there is nothing here to trust or distrust.
  const allNeutral = fieldsHere.every((each) => isNeutral(each));

  return (
    <div
      ref={(element) => {
        for (const field of fieldsHere) {
          rows.current.set(field.id, element);
        }
      }}
      className={`border-b border-line-row ${
        holdsSelection ? 'rounded-md bg-card-raised shadow-[inset_3px_0_0_var(--color-ink)]' : ''
      }`}
    >
      <div className={ROW}>
        <span className="text-note text-ink-soft">
          {row.labelField === null ? (
            row.label
          ) : (
            <FieldValue {...props} field={row.labelField} text={row.label} />
          )}
        </span>

        <span className="flex flex-wrap items-baseline gap-2 font-mono text-sm">
          {row.segments.map((segment) => (
            <SegmentValue key={segment.field.id} segment={segment} {...props} />
          ))}
          {/* While a value is being typed the input takes the room the
              currency would sit in, so it steps aside until the change is
              saved or dropped. */}
          {currency !== null && !beingEdited && <span className="text-ink-quiet">{currency}</span>}
        </span>

        {allNeutral ? (
          <span className="justify-self-end text-xs text-ink-quiet">Not on the document</span>
        ) : (
          <span className={`badge badge-${row.trust} justify-self-end`}>
            {TRUST_LABELS[row.trust]}
          </span>
        )}
      </div>

      {beingEdited && <EditControls {...props} />}
    </div>
  );
}

function SegmentValue({ segment, ...props }: FieldPanelProps & { segment: Segment }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      {segment.before !== '' && <span className="text-ink-quiet">{segment.before.trim()}</span>}
      <FieldValue {...props} field={segment.field} text={fieldText(segment.field)} />
    </span>
  );
}

// One value: click to pick it, E or a second click to change it. A value the
// document does not have shows a dash and can still be filled in.
function FieldValue({
  field,
  text,
  selectedId,
  editing,
  saving,
  onPick,
  onEdit,
  onEditValue,
  onSave,
  onCancel,
}: FieldPanelProps & { field: DocumentField; text: string }) {
  if (editing !== null && editing.fieldId === field.id) {
    return (
      <input
        // Focused on mount, so E goes straight into typing.
        // biome-ignore lint/a11y/noAutofocus: the shortcut that opens this input has to land the cursor in it.
        autoFocus
        value={editing.value}
        disabled={saving}
        aria-label={`New value for ${text}`}
        // An amount needs room for a few digits; a name needs room for a name.
        className={`${field.currency === null ? 'w-[220px]' : 'w-[104px]'} rounded border-[1.5px] border-link bg-card-raised px-2 py-[3px] font-mono text-sm text-ink outline-none ring-3 ring-link/15`}
        onChange={(event) => onEditValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSave();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    );
  }

  const picked = field.id === selectedId;
  return (
    <button
      type="button"
      onClick={() => (picked ? onEdit(field) : onPick(field))}
      className={`cursor-pointer rounded-[3px] text-left ${
        picked ? 'outline-2 outline-offset-2 outline-ink' : ''
      } ${field.value === null ? 'text-ink-faint' : ''}`}
    >
      {text}
    </button>
  );
}

function EditControls({ editing, saving, saveError, onSave, onCancel }: FieldPanelProps) {
  const empty = editing === null || editing.value.trim() === '';
  return (
    <div className="flex flex-wrap items-center gap-2 px-2 pb-2.5">
      <button
        type="button"
        className="btn btn-primary h-[30px]"
        disabled={saving || empty}
        onClick={onSave}
      >
        {saving ? 'Saving…' : 'Save'}
        <Kbd dark>⏎</Kbd>
      </button>
      <button type="button" className="btn h-[30px]" disabled={saving} onClick={onCancel}>
        Cancel<Kbd>Esc</Kbd>
      </button>
      <span className="text-xs text-ink-quiet">
        Your value replaces the model's. Every check runs again.
      </span>
      {saveError !== null && (
        <span role="alert" className="text-xs text-needs-review">
          {saveError}
        </span>
      )}
    </div>
  );
}
