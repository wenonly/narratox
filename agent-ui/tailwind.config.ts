import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        // ===== Functional colors (rgb()+channels so bg-*/NN opacity modifiers work in TW v3) =====
        destructive: 'rgb(var(--destructive) / <alpha-value>)',

        // accent — Wave 0 nested namespace (Token Spec §1.1 主色调). The legacy
        // flat `accent.DEFAULT` (#27272A) was removed in Wave 3 — bg-accent is no
        // longer a valid class; use bg-bg-card / bg-overlay-* instead.
        accent: {
          primary: 'var(--accent-primary)',
          primarySoft: 'var(--accent-primary-soft)',
          indigoLight: 'var(--accent-indigo-light)',
          indigoPale: 'var(--accent-indigo-pale)',
          violet: 'var(--accent-violet)',
          violetLight: 'var(--accent-violet-light)',
          violetPale: 'var(--accent-violet-pale)',
          violetMid: 'var(--accent-violet-mid)',
          violetSoft: 'var(--accent-violet-soft)'
        },

        // role — 角色语义色(PROTAGONIST 复用 accent.primary / ANTAGONIST rose / SUPPORTING 复用 accent.violet)
        role: {
          ant: 'var(--role-ant)',
          antSoft: 'var(--role-ant-soft)'
        },

        // ===== NEW design-token namespace (Wave 0) — Token Spec §1 =====
        bg: {
          base: 'var(--bg-base)',
          darkest: 'var(--bg-darkest)',
          dark: 'var(--bg-dark)',
          card: 'var(--bg-card)',
          cardElevated: 'var(--bg-card-elevated)',
          raised: 'var(--bg-raised)'
        },
        overlay: {
          5: 'var(--overlay-5)',
          6: 'var(--overlay-6)',
          10: 'var(--overlay-10)',
          15: 'var(--overlay-15)'
        },
        text: {
          primary: 'var(--text-primary)',
          bright: 'var(--text-bright)',
          body: 'var(--text-body)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          label: 'var(--text-label)',
          muted: 'var(--text-muted)',
          dim: 'var(--text-dim)',
          accent: 'var(--text-accent)',
          accentLink: 'var(--text-accent-link)'
        },
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        warningText: 'var(--warning-text)',
        info: 'rgb(var(--info) / <alpha-value>)'
      },
      fontFamily: {
        inter: 'var(--font-inter)',
        // Token Spec §1.10 mandates Inter as the single body font. Tailwind
        // Preflight applies fontFamily.sans to <html>, so unclassed text resolves
        // to Inter. The legacy geist/dmmono keys were removed in Wave 3.
        sans: 'var(--font-inter)'
      },
      borderRadius: {
        // keep existing
        xl: '10px', // kept at 10px (pre-existing, 18 usages); Token Spec §1.4 says 12px — reconcile in Wave 3
        // Token Spec §1.4 radius scale
        micro: '3px',
        sm: '4px', // overrides TW default rounded-sm (2px→4px): 8 shadcn surfaces (dialog/dropdown/tooltip/code/video) shift subtly — intentional, aligns with new scale (Token Spec §1.4)
        md: '6px',
        lg: '8px',
        input: '10px',
        dialog: '14px',
        '2xl': '16px',
        special: '20px',
        pill: '100px'
      }
    }
  },
  plugins: [tailwindcssAnimate]
} satisfies Config
