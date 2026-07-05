export function UploadProgressBar({ progress }: { progress: number | null }) {
  if (progress === null) return null;
  return (
    <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="upload-progress-fill" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
    </div>
  );
}
