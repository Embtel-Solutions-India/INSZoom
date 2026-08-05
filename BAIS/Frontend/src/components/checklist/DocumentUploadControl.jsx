import { useRef, useState } from "react";

// Compact drag-drop + file-picker + thumbnail-list control for one document
// slot. Deliberately minimal — no label/required/status chrome here, since
// ChecklistItemRow already renders that as part of the uniform item row.
export default function DocumentUploadControl({ docId, category, accept = ".pdf,.jpg,.jpeg,.png,.docx,.doc", disabled = false, files = [], onUpload, onRemove }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");

  const uploadFiles = async (fileList) => {
    setUploading(true);
    setError("");
    for (const file of fileList) {
      try {
        await onUpload(file, category, docId);
      } catch (uploadError) {
        setError(uploadError.message || "Upload failed. Please try again.");
      }
    }
    setUploading(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDrag(false);
    if (disabled) return;
    uploadFiles(Array.from(event.dataTransfer.files));
  };

  const handleInput = (event) => {
    uploadFiles(Array.from(event.target.files));
    event.target.value = "";
  };

  const removeFile = async (fileId) => {
    setRemovingId(fileId);
    setError("");
    try {
      await onRemove(fileId);
    } catch (removeError) {
      setError(removeError.message || "Unable to remove this file. Please try again.");
    } finally {
      setRemovingId("");
    }
  };

  return (
    <div>
      <div
        onDragOver={(event) => { if (!disabled) { event.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && !uploading && inputRef.current.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(event) => { if (!disabled && (event.key === "Enter" || event.key === " ")) inputRef.current.click(); }}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-4 text-center transition ${
          disabled ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60" : drag ? "cursor-pointer border-blue-400 bg-blue-50" : "cursor-pointer border-slate-300 bg-slate-50 hover:bg-slate-100"
        }`}
      >
        <p className="text-xs font-medium text-slate-500">
          {uploading ? "Uploading…" : disabled ? "Uploads are locked" : (
            <>Drop a file here or <span className="text-blue-600 underline">browse</span></>
          )}
        </p>
        <p className="text-[0.65rem] text-slate-400">{accept.replace(/\./g, "").replace(/,/g, ", ").toUpperCase()}</p>
        <input ref={inputRef} type="file" multiple accept={accept} capture="environment" onChange={handleInput} className="hidden" disabled={disabled} />
      </div>

      {error && <p role="alert" className="mt-1.5 text-xs font-semibold text-rose-600">{error}</p>}

      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {files.map((file) => {
            const isImage = /^image\//.test(file.mimeType || "") && file.url;
            return (
              <li key={file._id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                {isImage ? (
                  <img src={file.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-slate-100 text-slate-400">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-slate-700" title={file.originalName || file.name}>{file.originalName || file.name}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeFile(file._id)}
                    disabled={removingId === file._id}
                    className="shrink-0 font-semibold text-slate-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    {removingId === file._id ? "Removing…" : "Remove"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
