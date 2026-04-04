'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full bg-accent-primary/20 border border-accent-primary/30 flex items-center justify-center text-accent-primary text-xs font-medium hover:bg-accent-primary/30 transition-colors cursor-pointer"
      >
        U
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-bg-tertiary border border-border-secondary rounded-[var(--radius-md)] py-1 z-50">
          <Link
            href="/settings"
            className="block px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <Link
            href="/connect"
            className="block px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            onClick={() => setOpen(false)}
          >
            Connect Account
          </Link>
          <hr className="my-1 border-border-primary" />
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-left px-3 py-2 text-sm text-loss-primary hover:bg-bg-hover transition-colors cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
