/** Shown at once when you open another page, while its data loads. */
export default function Loading() {
  return (
    <div className="page-loading" aria-busy="true" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk sk-row" />
      <div className="sk sk-card" />
      <div className="sk sk-card" />
      <div className="sk sk-card short" />
    </div>
  );
}
