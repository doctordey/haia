'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { AccountSelector } from './account-selector';
import { UserMenu } from './user-menu';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/history', label: 'History' },
  { href: '/flex', label: 'Flex Cards' },
];

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-40 h-14 bg-bg-primary border-b border-border-primary flex items-center px-4">
      <Link href="/dashboard" className="flex items-center gap-2 mr-8">
        <div className="w-7 h-7 bg-accent-primary rounded-md flex items-center justify-center">
          <span className="text-white font-bold text-sm">H</span>
        </div>
        <span className="text-text-primary font-semibold text-lg">Haia</span>
      </Link>

      <div className="flex items-center gap-1">
        {navLinks.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'px-3 py-1.5 text-sm rounded-[var(--radius-md)] transition-colors',
                isActive
                  ? 'text-text-primary bg-bg-hover'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <AccountSelector />
        <UserMenu />
      </div>
    </nav>
  );
}
