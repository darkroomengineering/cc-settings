#!/usr/bin/env bash
set -euo pipefail
git init -q
git config user.email "test@example.com"
git config user.name "Test"
mkdir -p components
cat > components/upload-button.tsx <<'EOT'
"use client";

import { type ChangeEvent, useState } from "react";

export function UploadButton() {
  const [isUploading, setIsUploading] = useState(false);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    await fetch("/api/avatar", { method: "POST", body: file });
    setIsUploading(false);
  }

  return (
    <label>
      Upload avatar
      <input type="file" accept="image/*" disabled={isUploading} onChange={onChange} />
    </label>
  );
}
EOT
git add components/upload-button.tsx
git commit -q -m "feat: avatar upload button"
cat > components/upload-button.tsx <<'EOT'
"use client";

import { type ChangeEvent, useState } from "react";

export function UploadButton() {
  const [isUploading, setIsUploading] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const response = await fetch("/api/avatar", { method: "POST", body: file });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      const body: { url: string } = await response.json();
      setUrl(body.url);
      setIsUploading(false);
    } catch (error) {
      setIsError(true);
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    }
  }

  return (
    <div>
      <label>
        Upload avatar
        <input type="file" accept="image/*" disabled={isUploading} onChange={onChange} />
      </label>
      {isUploading && <p>Uploading…</p>}
      {isError && <p role="alert">{errorMessage}</p>}
      {url && <a href={url}>View avatar</a>}
    </div>
  );
}
EOT
