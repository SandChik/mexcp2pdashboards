// Page shell. The dock is NOT here any more (v82): App renders it once, outside
// the routes, so it survives navigation (sliding highlight, steady hover).
// Pages keep wrapping themselves in <Layout> and sizing with `.page-h`.
export default function Layout({ children }) {
  return (
    <div className="min-h-[100dvh]">
      <main className="min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}
