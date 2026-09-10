import { useOverview } from "../api/hooks";

export default function Overview() {
  const { data, isLoading, isError } = useOverview();

  return (
    <div>
      <h1 className="mb-2 text-lg font-semibold text-text">Overview</h1>
      <p className="text-sm text-text-dim">Coming soon.</p>
      {isLoading && <p className="mt-2 text-xs text-text-dim">Memuat ringkasan...</p>}
      {isError && (
        <p className="mt-2 text-xs text-danger">Gagal memuat data overview.</p>
      )}
      {data && (
        <pre className="mt-2 font-mono text-xs text-text-secondary">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
