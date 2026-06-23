'use client';

/**
 * New Listing — single form. Title, type, price, beds, city, address,
 * description, and media. Media uploads route through the media abstraction
 * (api/media.uploadPropertyMedia → Cloudinary), never a direct provider call.
 * (Supporting screen.)
 *
 * Wiring note: onSubmit → properties.createProperty(input); each file →
 * media.uploadPropertyMedia({ propertyId, file, ... }). Status starts
 * pending_review until a platform admin verifies (manual in MVP).
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const PROPERTY_TYPES = ['Apartment', 'House', 'Duplex', 'Terrace', 'Penthouse', 'Land', 'Commercial'];
const LISTING_TYPES = ['Sale', 'Rent', 'Shortlet'];

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const inputCls =
  'w-full rounded-inner border border-glass-border bg-canvas px-3.5 py-2.5 text-sm text-ink outline-none focus:border-accent/40 transition-colors';

export default function NewListingPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<string[]>([]);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const names = Array.from(e.target.files ?? []).map((f) => f.name);
    setFiles((prev) => [...prev, ...names]);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // TODO(go-live): properties.createProperty(input) then upload each file
    // through media.uploadPropertyMedia; redirect to the created listing.
    setTimeout(() => {
      setBusy(false);
      router.push('/listings');
    }, 600);
  };

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-4xl tracking-wider">NEW LISTING</h1>
      <p className="text-ink-muted text-sm mt-2">
        One form. It goes to pending review until a Synapse scout verifies it.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field label="Title">
          <input className={inputCls} placeholder="3-Bed Apartment, Lekki Phase 1" required />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Property type">
            <select className={inputCls} defaultValue="Apartment">
              {PROPERTY_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Listing type">
            <select className={inputCls} defaultValue="Sale">
              {LISTING_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Price (₦)">
            <input className={inputCls} type="number" placeholder="165000000" required />
          </Field>
          <Field label="Bedrooms">
            <input className={inputCls} type="number" placeholder="3" />
          </Field>
          <Field label="Bathrooms">
            <input className={inputCls} type="number" placeholder="3" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="City">
            <input className={inputCls} placeholder="Lagos" required />
          </Field>
          <Field label="Area / address">
            <input className={inputCls} placeholder="Lekki Phase 1" />
          </Field>
        </div>

        <Field label="Description">
          <textarea className={`${inputCls} min-h-28 resize-none`} placeholder="What makes this property worth a buyer's attention…" />
        </Field>

        <Field label="Photos & video">
          <div className="rounded-inner border border-dashed border-glass-border bg-canvas p-5">
            <input type="file" multiple accept="image/*,video/mp4" onChange={onPickFiles} className="text-sm text-ink-muted" />
            {files.length > 0 && (
              <ul className="mt-3 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="text-xs text-ink-dim flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-trust" /> {f}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-ink-dim">
              Uploaded via the media abstraction → Cloudinary. JPG/PNG/WebP up to 15MB, MP4 up to 200MB.
            </p>
          </div>
        </Field>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-accent text-white text-sm font-semibold px-6 py-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Submitting…' : 'Submit for review'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/listings')}
            className="rounded-full border border-glass-border text-ink text-sm font-semibold px-6 py-2.5 hover:bg-canvas transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
