import { TopNav } from '@/components/layout/top-nav';
import { ToastContainer } from '@/components/ui/toast';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="pt-14 flex-1">{children}</main>
      <ToastContainer />
    </>
  );
}
