import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-accent-primary rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">H</span>
          </div>
          <span className="text-text-primary font-semibold text-lg">Haia</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Log In
          </Link>
          <Link
            href="/register"
            className="px-4 py-2 text-sm bg-accent-primary text-white rounded-[var(--radius-md)] font-medium hover:bg-accent-hover transition-colors"
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-6 pt-24 pb-32 max-w-7xl mx-auto text-center overflow-hidden">
        {/* Animated gradient orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/3 w-[500px] h-[500px] bg-accent-primary/8 rounded-full blur-[120px] animate-[drift_12s_ease-in-out_infinite]" />
          <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] bg-accent-secondary/6 rounded-full blur-[100px] animate-[drift_15s_ease-in-out_infinite_reverse]" />
        </div>

        <h1 className="relative text-4xl md:text-6xl font-bold text-text-primary leading-tight mb-4">
          Your FX Performance,{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent-primary to-accent-secondary">
            Visualized
          </span>
        </h1>
        <p className="relative text-base md:text-lg text-text-secondary max-w-2xl mx-auto mb-4">
          Connect MetaTrader. Track every trade. Share your results.
        </p>
        <p className="relative text-sm text-text-tertiary max-w-xl mx-auto mb-10">
          Rich analytics, PNL calendars, and shareable flex cards — all in a dark,
          terminal-style interface built for serious traders.
        </p>
        <div className="relative flex items-center justify-center gap-4">
          <Link
            href="/register"
            className="px-6 py-3 bg-accent-primary text-white rounded-[var(--radius-md)] font-medium text-base hover:bg-accent-hover transition-colors"
          >
            Get Started Free
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 border border-border-secondary text-text-secondary rounded-[var(--radius-md)] font-medium text-base hover:bg-bg-hover hover:text-text-primary transition-colors"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* Feature Cards */}
      <section className="px-6 pb-24 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: 'Performance Analytics',
              description:
                'Profit factor, Sharpe ratio, drawdown analysis, win rates, and 20+ metrics calculated from your real trading data.',
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              ),
            },
            {
              title: 'PNL Calendar',
              description:
                'See your daily realized PNL in a color-coded calendar grid. Track win streaks, loss streaks, and monthly performance.',
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              ),
            },
            {
              title: 'Flex Cards',
              description:
                'Generate beautiful, shareable PNL cards for social media. Choose from multiple themes and customize your layout.',
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              ),
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="bg-bg-secondary border border-border-primary rounded-[var(--radius-lg)] p-6 hover:border-border-secondary transition-colors"
            >
              <div className="w-10 h-10 bg-accent-primary/10 border border-accent-primary/20 rounded-[var(--radius-md)] flex items-center justify-center text-accent-primary mb-4">
                {feature.icon}
              </div>
              <h3 className="text-base font-semibold text-text-primary mb-2">{feature.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border-primary px-6 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <p className="text-xs text-text-tertiary">&copy; 2026 Haia. All rights reserved.</p>
          <p className="text-xs text-text-tertiary">Built for traders, by traders.</p>
        </div>
      </footer>
    </div>
  );
}
