import { useState } from "react";
import EntryFileList from "./EntryFileList";

// Multi-entry upload control for one legacy document-baseline slot (backed by
// Document records grouped by documentType). Deliberately minimal - no
// label/required/status chrome, since ChecklistItemRow already renders that.
// Entry list / "Add entry" / 10-file + 50 MB limits live in EntryFileList.
// `accept` is intentionally no longer applied: any file type is allowed
// (the server blocks executables).
export default function DocumentUploadControl({ docId, category, disabled = false, files = [], onUpload, onRemove }) {
  const [uploading, setUploading] = useState(false);

  const entries = files.map((file) => ({
    id: file._id,
    name: file.originalName || file.name || "Document",
    size: file.size || file.fileSize,
    mimeType: file.mimeType,
    url: file.url || file.documentUrl,
  }));

  const addFiles = async (fileList) => {
    setUploading(true);
    let firstError = null;
    for (const file of fileList) {
      try {
        await onUpload(file, category, docId);
      } catch (uploadError) {
        firstError = firstError || uploadError;
      }
    }
    setUploading(false);
    if (firstError) throw firstError;
  };

  return (
    <EntryFileList
      inputId={`upload-${docId}`}
      entries={entries}
      disabled={disabled}
      busy={uploading}
      onAdd={addFiles}
      onRemove={(entry) => onRemove(entry.id)}
    />
  );
}
