import { TopNav } from '@/components/layout/top-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="pt-14 flex-1">{children}</main>
    </>
  );
}
