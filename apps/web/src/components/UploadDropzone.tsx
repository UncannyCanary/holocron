import { type DocumentType, LIMITS } from '@holocron/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type DragEvent, useRef, useState } from 'react';
import { messageOf, uploadDocument } from '../lib/api';
import { useShortcuts } from '../lib/use-shortcuts';
import { Kbd } from './Kbd';

const TYPES: { value: DocumentType; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'contract', label: 'Contract' },
];

const MAX_FILE_MB = LIMITS.maxFileSizeBytes / (1024 * 1024);

// Drag and drop, the U shortcut, or the button. Whichever gets a file here,
// the upload itself goes through the one mutation. The kind of document has
// to be picked first, since the API cannot tell an invoice from a receipt.
export function UploadDropzone() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<DocumentType>('invoice');
  const [dragOver, setDragOver] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => uploadDocument(file, type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });

  function chooseFile() {
    inputRef.current?.click();
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) upload.mutate(file);
  }

  useShortcuts({
    u: (event) => {
      event.preventDefault();
      chooseFile();
    },
  });

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    setDragOver(true);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragOver(false);
    handleFiles(event.dataTransfer.files);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target has no more semantic element; the U shortcut and the button below cover the keyboard.
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-2.5 rounded-lg border-[1.5px] border-dashed p-5 text-center ${
        dragOver ? 'border-ink bg-panel-muted' : 'border-line-drop bg-drop'
      }`}
    >
      <svg
        className="size-[26px] text-ink-quiet"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </svg>
      <div className="text-lede font-medium">
        {upload.isPending ? 'Uploading…' : 'Drop a file here'}
      </div>

      <div className="type-picker" role="radiogroup" aria-label="Document type">
        {TYPES.map((each) => (
          <label key={each.value}>
            <input
              type="radio"
              name="document-type"
              value={each.value}
              checked={type === each.value}
              onChange={() => setType(each.value)}
            />
            <span>{each.label}</span>
          </label>
        ))}
      </div>

      <button type="button" className="btn" onClick={chooseFile} disabled={upload.isPending}>
        Choose a file<Kbd>U</Kbd>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <div className="text-xs leading-relaxed text-ink-quiet">
        PDF, PNG, or JPEG. Up to {MAX_FILE_MB} MB and {LIMITS.maxPagesPerDocument} pages.
      </div>
      {upload.isError && (
        <div role="alert" className="text-xs text-needs-review">
          {messageOf(upload.error, 'That upload did not work. Try again.')}
        </div>
      )}
    </div>
  );
}
