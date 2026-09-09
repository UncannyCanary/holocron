import { type ReactNode, useState } from 'react';
import type { DocumentField, DocumentPage, FieldTrust } from '../lib/api';

// How wide a page is drawn before anyone touches the zoom. The stored image
// is much bigger than this, since it is rendered at 150 dots per inch for the
// model to read.
const FIT_WIDTH = 680;
const ZOOM_STEP = 0.1;
const ZOOM_RANGE = { least: 0.4, most: 3 };

// An unverifiable value was not found on the page, so it never gets a mark.
const MARK_CLASS: Record<FieldTrust, string> = {
  verified: 'mark-verified',
  contradicted: 'mark-contradicted',
  corrected: 'mark-corrected',
  unverifiable: '',
};

// The page image with a mark on every value that was found on it. The marks
// are drawn from the stored box, which runs from 0 to 1, so they sit in the
// same place at any zoom.
export function PageView({
  pages,
  fields,
  pageNumber,
  onPageNumber,
  selectedId,
  flashAt,
  labelOf,
  onPick,
  note,
}: {
  pages: DocumentPage[];
  fields: DocumentField[];
  pageNumber: number;
  // A short line beside the page count, such as where the rest of a file went.
  note?: ReactNode;
  onPageNumber: (number: number) => void;
  selectedId: string | null;
  // Changes every time a field is picked, which replays the flash.
  flashAt: number;
  labelOf: Map<string, string>;
  onPick: (field: DocumentField) => void;
}) {
  const [zoom, setZoom] = useState(1);

  const page = pages.find((each) => each.number === pageNumber) ?? pages[0];
  const scale = (FIT_WIDTH / page.widthPx) * zoom;
  const marks = fields.filter((each) => each.box !== null && each.page === page.number);

  return (
    <div className="flex min-h-0 flex-col bg-panel-muted">
      <div className="flex h-10 flex-none items-center justify-between px-4 text-xs text-ink-soft">
        <div className="flex items-center gap-2">
          <span>
            Page {page.number} of {pages.length}
          </span>
          {pages.length > 1 && (
            <>
              <button
                type="button"
                className="btn h-[26px] px-2"
                disabled={page.number <= 1}
                onClick={() => onPageNumber(page.number - 1)}
              >
                Back
              </button>
              <button
                type="button"
                className="btn h-[26px] px-2"
                disabled={page.number >= pages.length}
                onClick={() => onPageNumber(page.number + 1)}
              >
                Next
              </button>
            </>
          )}
          {note && <span className="text-ink-quiet">{note}</span>}
        </div>
        <div className="flex items-center gap-2.5">
          <span className="font-mono tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="btn h-[26px] px-2"
            aria-label="Smaller"
            onClick={() => setZoom(Math.max(ZOOM_RANGE.least, zoom - ZOOM_STEP))}
          >
            −
          </button>
          <button
            type="button"
            className="btn h-[26px] px-2"
            aria-label="Bigger"
            onClick={() => setZoom(Math.min(ZOOM_RANGE.most, zoom + ZOOM_STEP))}
          >
            +
          </button>
          <button type="button" className="btn h-[26px] px-2" onClick={() => setZoom(1)}>
            Fit
          </button>
        </div>
      </div>

      <div className="flex flex-1 justify-start overflow-auto px-6 pt-1 pb-6 lg:justify-center">
        {/* The only measurements the design system cannot hold: the page is
            drawn at whatever size the zoom asks for, and each mark sits where
            its stored box says, as a share of the page. */}
        <div
          className="relative h-fit w-fit flex-none shadow-[0_1px_2px_rgba(28,25,23,0.08),0_12px_32px_rgba(28,25,23,0.10)]"
          style={{ width: Math.round(page.widthPx * scale) }}
        >
          <img
            src={page.imageUrl}
            alt={`Page ${page.number} of the document`}
            width={page.widthPx}
            height={page.heightPx}
            className="block h-auto w-full bg-card-raised"
          />
          {marks.map((field) => {
            const box = field.box as NonNullable<DocumentField['box']>;
            const picked = field.id === selectedId;
            return (
              <button
                // The flash is a fresh element with the same look, so the
                // animation runs again every time the field is picked.
                key={picked ? `${field.id}-${flashAt}` : field.id}
                type="button"
                className={`mark ${MARK_CLASS[field.trust]} ${picked ? 'mark-picked animate-flash' : ''}`}
                style={{
                  left: `${box.x0 * 100}%`,
                  top: `${box.y0 * 100}%`,
                  width: `${(box.x1 - box.x0) * 100}%`,
                  height: `${(box.y1 - box.y0) * 100}%`,
                }}
                onClick={() => onPick(field)}
                aria-label={labelOf.get(field.id) ?? field.name}
              />
            );
          })}
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-x-3.5 gap-y-1 px-4 pb-3.5 text-[11px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="dot dot-verified" />
          Verified
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="dot dot-contradicted" />
          Contradicted
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="dot dot-corrected" />
          Corrected
        </span>
        <span>
          No mark means the value was not found on the page, so there is nothing to point at.
        </span>
      </div>
    </div>
  );
}
