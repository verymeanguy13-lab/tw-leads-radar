import AppNav from "@/components/AppNav";

// New file - app/(app)/ previously had no layout.tsx at all, so pages
// under it (/searches, /searches/new, /searches/[id], /account,
// /admin/*) rendered with zero shared chrome: no way to navigate
// between them, no logout control anywhere. See components/AppNav.tsx.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-full">
      <AppNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
