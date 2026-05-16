// LocoCode pre-built design system.
// Iniettato in OGNI app generata, prima del build. L'AI ha l'ordine tassativo
// di importare questi componenti invece di reinventarli, cosi' qualunque modello
// (anche il piu' scarso) produce comunque un'app esteticamente premium.
//
// Stile: "Liquid Glass" — gradient soft, glassmorphism, palette indigo/purple/rose,
// font Inter, shadow morbide, microinterazioni, dark-aware.

const BUTTON_JSX = `import React from 'react';

const VARIANTS = {
  primary:
    'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 hover:-translate-y-0.5',
  secondary:
    'bg-white/70 backdrop-blur border border-slate-200 text-slate-700 hover:bg-white shadow-sm',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100',
  danger:
    'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/30 hover:shadow-xl hover:shadow-rose-500/40 hover:-translate-y-0.5',
  success:
    'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:shadow-emerald-500/40 hover:-translate-y-0.5',
};

const SIZES = {
  sm: 'text-xs px-3 py-1.5 rounded-lg gap-1.5',
  md: 'text-sm px-4 py-2.5 rounded-xl gap-2',
  lg: 'text-base px-6 py-3 rounded-xl gap-2.5',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const variantClass = VARIANTS[variant] || VARIANTS.primary;
  const sizeClass = SIZES[size] || SIZES.md;
  const base =
    'inline-flex items-center justify-center font-semibold transition-all duration-200 ' +
    'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-2 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none ' +
    'whitespace-nowrap select-none';
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={[base, variantClass, sizeClass, className].join(' ')}
    >
      {loading ? (
        <span className="inline-block w-4 h-4 border-2 border-current border-r-transparent rounded-full animate-spin" />
      ) : Icon ? (
        <Icon size={size === 'lg' ? 18 : 16} strokeWidth={2.2} />
      ) : null}
      {children}
      {IconRight && !loading ? <IconRight size={size === 'lg' ? 18 : 16} strokeWidth={2.2} /> : null}
    </button>
  );
}

export default Button;
`;

const CARD_JSX = `import React from 'react';

const VARIANTS = {
  glass:
    'bg-white/70 backdrop-blur-xl border border-white/60 shadow-xl ring-1 ring-slate-200/50',
  elevated:
    'bg-white border border-slate-200 shadow-lg',
  plain:
    'bg-white border border-slate-200 shadow-sm',
  dark:
    'bg-slate-900/80 backdrop-blur-xl border border-slate-700/60 shadow-xl text-slate-100',
};

export function Card({
  variant = 'glass',
  padding = 'md',
  hover = false,
  className = '',
  children,
  ...rest
}) {
  const variantClass = VARIANTS[variant] || VARIANTS.glass;
  const padClass = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' }[padding] || 'p-6';
  const hoverClass = hover
    ? 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2xl cursor-pointer'
    : '';
  return (
    <div
      {...rest}
      className={['rounded-2xl', variantClass, padClass, hoverClass, className].join(' ')}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={['flex items-start justify-between mb-4', className].join(' ')}>
      <div className="min-w-0">
        {title ? (
          <h3 className="text-lg font-bold tracking-tight text-slate-900 truncate">{title}</h3>
        ) : null}
        {subtitle ? <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-shrink-0 ml-3">{action}</div> : null}
    </div>
  );
}

export default Card;
`;

const INPUT_JSX = `import React, { useId } from 'react';

export function Input({
  label,
  icon: Icon,
  error,
  hint,
  className = '',
  id,
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const hasIcon = !!Icon;
  return (
    <div className={['flex flex-col gap-1.5', className].join(' ')}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      <div className="relative group">
        {hasIcon ? (
          <Icon
            size={18}
            strokeWidth={2}
            className={
              'absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ' +
              (error ? 'text-rose-400' : 'text-slate-400 group-focus-within:text-indigo-500')
            }
          />
        ) : null}
        <input
          {...rest}
          id={inputId}
          className={[
            'w-full bg-white/80 backdrop-blur border rounded-xl py-3 transition-all',
            'text-slate-900 placeholder:text-slate-400',
            'focus:outline-none focus:ring-2 focus:bg-white',
            hasIcon ? 'pl-11 pr-4' : 'px-4',
            error
              ? 'border-rose-300 focus:ring-rose-500/40 focus:border-rose-400'
              : 'border-slate-200 focus:ring-indigo-500/40 focus:border-indigo-400',
          ].join(' ')}
        />
      </div>
      {error ? (
        <p className="text-xs text-rose-600 mt-0.5">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      ) : null}
    </div>
  );
}

export function Textarea({ label, error, hint, className = '', id, rows = 4, ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={['flex flex-col gap-1.5', className].join(' ')}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      <textarea
        {...rest}
        id={inputId}
        rows={rows}
        className={[
          'w-full bg-white/80 backdrop-blur border rounded-xl py-3 px-4 transition-all resize-none',
          'text-slate-900 placeholder:text-slate-400',
          'focus:outline-none focus:ring-2 focus:bg-white',
          error
            ? 'border-rose-300 focus:ring-rose-500/40 focus:border-rose-400'
            : 'border-slate-200 focus:ring-indigo-500/40 focus:border-indigo-400',
        ].join(' ')}
      />
      {error ? (
        <p className="text-xs text-rose-600 mt-0.5">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      ) : null}
    </div>
  );
}

export function Select({ label, error, hint, options = [], className = '', id, ...rest }) {
  const autoId = useId();
  const inputId = id || autoId;
  return (
    <div className={['flex flex-col gap-1.5', className].join(' ')}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      <select
        {...rest}
        id={inputId}
        className={[
          'w-full bg-white/80 backdrop-blur border rounded-xl py-3 px-4 transition-all',
          'text-slate-900',
          'focus:outline-none focus:ring-2 focus:bg-white',
          error
            ? 'border-rose-300 focus:ring-rose-500/40 focus:border-rose-400'
            : 'border-slate-200 focus:ring-indigo-500/40 focus:border-indigo-400',
        ].join(' ')}
      >
        {options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>{o}</option>
          ) : (
            <option key={o.value} value={o.value}>{o.label}</option>
          ),
        )}
      </select>
      {error ? <p className="text-xs text-rose-600 mt-0.5">{error}</p> : hint ? <p className="text-xs text-slate-500 mt-0.5">{hint}</p> : null}
    </div>
  );
}

export default Input;
`;

const BADGE_JSX = `import React from 'react';

const TONES = {
  indigo: 'bg-indigo-100 text-indigo-700 ring-indigo-200',
  purple: 'bg-purple-100 text-purple-700 ring-purple-200',
  emerald: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  rose: 'bg-rose-100 text-rose-700 ring-rose-200',
  amber: 'bg-amber-100 text-amber-800 ring-amber-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  sky: 'bg-sky-100 text-sky-700 ring-sky-200',
};

export function Badge({ tone = 'indigo', icon: Icon, className = '', children }) {
  const toneClass = TONES[tone] || TONES.indigo;
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ring-inset',
        toneClass,
        className,
      ].join(' ')}
    >
      {Icon ? <Icon size={12} strokeWidth={2.5} /> : null}
      {children}
    </span>
  );
}

export default Badge;
`;

const EMPTY_JSX = `import React from 'react';
import { Button } from './Button';

export function Empty({
  icon: Icon,
  title = 'Nessun dato',
  description,
  actionLabel,
  onAction,
  className = '',
}) {
  return (
    <div className={['flex flex-col items-center justify-center text-center py-14 px-6', className].join(' ')}>
      <div className="w-16 h-16 mb-5 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center shadow-inner">
        {Icon ? <Icon size={28} strokeWidth={1.8} className="text-indigo-600" /> : null}
      </div>
      <h3 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h3>
      {description ? (
        <p className="text-sm text-slate-500 mt-1.5 max-w-sm">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button onClick={onAction} className="mt-5">{actionLabel}</Button>
      ) : null}
    </div>
  );
}

export default Empty;
`;

const STAT_JSX = `import React from 'react';

const TONES = {
  indigo: { grad: 'from-indigo-600 to-purple-600', soft: 'from-indigo-100 to-purple-100', text: 'text-indigo-600' },
  emerald: { grad: 'from-emerald-500 to-teal-600', soft: 'from-emerald-100 to-teal-100', text: 'text-emerald-600' },
  rose: { grad: 'from-rose-500 to-red-600', soft: 'from-rose-100 to-red-100', text: 'text-rose-600' },
  amber: { grad: 'from-amber-500 to-orange-600', soft: 'from-amber-100 to-orange-100', text: 'text-amber-600' },
  sky: { grad: 'from-sky-500 to-blue-600', soft: 'from-sky-100 to-blue-100', text: 'text-sky-600' },
};

export function Stat({ label, value, hint, tone = 'indigo', icon: Icon, delta }) {
  const t = TONES[tone] || TONES.indigo;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/70 backdrop-blur-xl border border-white/60 shadow-xl ring-1 ring-slate-200/50 p-5">
      <div className={'absolute -right-6 -top-6 w-24 h-24 rounded-full bg-gradient-to-br opacity-20 ' + t.soft} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
          <p className={'mt-2 text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r ' + t.grad}>
            {value}
          </p>
          {hint ? <p className="text-xs text-slate-500 mt-1">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className={'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shadow-md ' + t.grad}>
            <Icon size={20} strokeWidth={2.2} />
          </div>
        ) : null}
      </div>
      {delta != null ? (
        <div className={'mt-3 inline-flex items-center text-xs font-semibold ' + (delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
          {delta >= 0 ? '▲ +' : '▼ '}{delta}%
        </div>
      ) : null}
    </div>
  );
}

export default Stat;
`;

const AUTH_LAYOUT_JSX = `import React from 'react';

export function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-300/40 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] rounded-full bg-purple-300/40 blur-3xl pointer-events-none" />
      <div className="absolute top-[30%] right-[20%] w-[20%] h-[20%] rounded-full bg-rose-200/30 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md">
        <div className="bg-white/70 backdrop-blur-2xl rounded-3xl shadow-2xl ring-1 ring-white/60 border border-white/60 p-8">
          <div className="mb-6 text-center">
            {title ? (
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {title}
              </h1>
            ) : null}
            {subtitle ? <p className="text-sm text-slate-500 mt-1.5">{subtitle}</p> : null}
          </div>
          {children}
          {footer ? <div className="mt-6 text-center text-sm text-slate-500">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default AuthLayout;
`;

const PAGE_LAYOUT_JSX = `import React from 'react';

export function PageLayout({ sidebar, header, children, maxWidth = '7xl' }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
      <div className="flex min-h-screen">
        {sidebar ? (
          <aside className="hidden md:flex w-64 flex-shrink-0 flex-col border-r border-slate-200/70 bg-white/60 backdrop-blur-xl">
            {sidebar}
          </aside>
        ) : null}
        <div className="flex-1 flex flex-col min-w-0">
          {header ? (
            <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
              <div className={'mx-auto px-6 py-4 max-w-' + maxWidth}>{header}</div>
            </header>
          ) : null}
          <main className="flex-1">
            <div className={'mx-auto px-6 py-8 max-w-' + maxWidth}>{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

export function SidebarBrand({ name, icon: Icon }) {
  return (
    <div className="px-5 py-5 border-b border-slate-200/60">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/30">
          {Icon ? <Icon size={18} strokeWidth={2.4} /> : <span className="font-bold">{(name||'A')[0]}</span>}
        </div>
        <span className="font-bold text-slate-900 tracking-tight">{name}</span>
      </div>
    </div>
  );
}

export function SidebarItem({ icon: Icon, label, active = false, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all',
        active
          ? 'bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100'
          : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900',
      ].join(' ')}
    >
      {Icon ? <Icon size={18} strokeWidth={2} /> : null}
      <span>{label}</span>
    </button>
  );
}

export function SidebarNav({ children }) {
  return <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{children}</nav>;
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="text-sm text-slate-500 mt-1">{subtitle}</p> : null}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}

export default PageLayout;
`;

const MODAL_JSX = `import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const sizeClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size] || 'max-w-lg';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className={'relative w-full bg-white/90 backdrop-blur-2xl rounded-3xl shadow-2xl ring-1 ring-white/60 border border-white/60 ' + sizeClass}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors"
        >
          <X size={18} />
        </button>
        <div className="p-7">
          {title ? <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2> : null}
          {subtitle ? <p className="text-sm text-slate-500 mt-1">{subtitle}</p> : null}
          <div className={title || subtitle ? 'mt-5' : ''}>{children}</div>
          {footer ? <div className="mt-6 flex items-center justify-end gap-2">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

export default Modal;
`;

const INDEX_JSX = `export { Button } from './Button';
export { Card, CardHeader } from './Card';
export { Input, Textarea, Select } from './Input';
export { Badge } from './Badge';
export { Empty } from './Empty';
export { Stat } from './Stat';
export { AuthLayout } from './AuthLayout';
export { PageLayout, SidebarBrand, SidebarItem, SidebarNav, PageHeader } from './PageLayout';
export { Modal } from './Modal';
`;

const THEME_CSS = `/* LocoCode Design System base styles. NON modificare a mano.
   Iniettato in OGNI app generata per garantire estetica premium. */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  --lc-brand-from: #4f46e5;
  --lc-brand-to: #9333ea;
  --lc-surface: rgba(255, 255, 255, 0.7);
  --lc-border: rgba(226, 232, 240, 0.7);
}

html, body, #root {
  min-height: 100vh;
  width: 100%;
  margin: 0;
  padding: 0;
}
html, body {
  overflow-x: hidden;
}

body {
  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "cv01", "cv03", "cv04", "cv11", "ss03";
  letter-spacing: -0.005em;
  color: #e7e9f2;
  background-color: #0a0e1a;
  background-image:
    radial-gradient(ellipse 1100px 600px at 85% -10%, rgba(168, 85, 247, 0.20) 0%, transparent 60%),
    radial-gradient(ellipse 900px 500px at -10% 20%, rgba(91, 62, 232, 0.22) 0%, transparent 60%),
    radial-gradient(ellipse 800px 500px at 50% 110%, rgba(56, 189, 248, 0.10) 0%, transparent 55%),
    linear-gradient(160deg, #0a0e1a 0%, #0d1126 50%, #0a0f22 100%);
  background-attachment: fixed;
  min-height: 100vh;
  position: relative;
  overflow-x: hidden;
}
/* Dot pattern overlay sottile per dare textura */
body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 28px 28px;
  background-position: -1px -1px;
  z-index: 0;
  opacity: 0.6;
  mask-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.7) 0%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.7) 0%, transparent 75%);
}
/* Aurora animata */
body::after {
  content: "";
  position: fixed;
  inset: -20%;
  pointer-events: none;
  background:
    radial-gradient(circle at 25% 35%, rgba(168, 85, 247, 0.14) 0%, transparent 35%),
    radial-gradient(circle at 75% 65%, rgba(56, 189, 248, 0.10) 0%, transparent 35%);
  filter: blur(80px);
  animation: lc-aurora 26s ease-in-out infinite alternate;
  opacity: 0.7;
  z-index: 0;
}
@keyframes lc-aurora {
  0%   { transform: translate(0, 0) rotate(0deg); }
  50%  { transform: translate(6%, -3%) rotate(6deg); }
  100% { transform: translate(-4%, 5%) rotate(-5deg); }
}
/* I contenuti React stanno SOPRA aurora/pattern */
#root { position: relative; z-index: 1; }

h1, h2, h3, h4 {
  letter-spacing: -0.02em;
  font-weight: 700;
}

/* Scrollbar piu' elegante */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.25);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.45); background-clip: padding-box; }

/* Fade in subtle per i contenuti */
@keyframes lc-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.lc-fade-in { animation: lc-fade-in 0.32s ease-out both; }

/* Spinner */
@keyframes lc-spin { to { transform: rotate(360deg); } }
.lc-spin { animation: lc-spin 0.8s linear infinite; }

/* Selezione testo brand */
::selection {
  background-color: rgba(99, 102, 241, 0.18);
  color: #4338ca;
}

/* ─── DEFENSIVE INPUT CONTRAST ─────────────────────────────────
   L'AI sbaglia spesso mettendo testi chiari su sfondi chiari dentro
   gli <input>/<textarea>/<select>. Forziamo SEMPRE testi scuri
   leggibili su sfondo bianco dentro le caselle, indipendentemente
   dalle classi Tailwind che l'AI ha applicato. Cosi' anche se mette
   className="text-white bg-white/10" sul container, dentro l'input
   il testo digitato dall'utente resta leggibile.
   color-scheme:light forza anche i picker (date/file) chiari. */
input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="range"]):not([type="color"]),
textarea,
select {
  color-scheme: light;
  color: #0f172a !important;
  background-color: #ffffff !important;
  caret-color: #4f46e5;
}
input::placeholder,
textarea::placeholder {
  color: #94a3b8 !important;
  opacity: 1;
}
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
textarea:-webkit-autofill {
  -webkit-text-fill-color: #0f172a !important;
  -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
  box-shadow: 0 0 0 1000px #ffffff inset !important;
}

/* ─── DEFENSIVE TEXT CONTRAST ──────────────────────────────────
   L'AI mette spesso classi text-{color}-300/400 (pensate per sfondo
   scuro) dentro card glassmorphism che pero' appaiono CHIARE, e il
   testo svanisce. Remappiamo questi colori "troppo chiari" a tonalita'
   medio-scure (-600/-700) che restano leggibili in ENTRAMBI i contesti:
   - su sfondo scuro: leggermente meno vivace ma sempre leggibile
   - su sfondo chiaro: ora ha contrasto reale
   Manteniamo invariate le shade -500 in giu' (gia' scure) e le shade
   -100/-200 (pensate per pillole/badge con bg dello stesso colore). */
/* Versione "medium" (-500) leggibile su QUALSIASI bg (chiaro o scuro). */
.text-gray-300, .text-slate-300, .text-zinc-300, .text-neutral-300, .text-stone-300 { color: #94a3b8 !important; }
.text-gray-400, .text-slate-400, .text-zinc-400, .text-neutral-400, .text-stone-400 { color: #94a3b8 !important; }
.text-green-300, .text-emerald-300, .text-lime-300, .text-teal-300 { color: #10b981 !important; }
.text-green-400, .text-emerald-400, .text-lime-400, .text-teal-400 { color: #10b981 !important; }
.text-yellow-300, .text-amber-300, .text-orange-300 { color: #f59e0b !important; }
.text-yellow-400, .text-amber-400, .text-orange-400 { color: #f59e0b !important; }
.text-red-300, .text-rose-300, .text-pink-300 { color: #fb7185 !important; }
.text-red-400, .text-rose-400, .text-pink-400 { color: #fb7185 !important; }
.text-blue-300, .text-sky-300, .text-cyan-300 { color: #38bdf8 !important; }
.text-blue-400, .text-sky-400, .text-cyan-400 { color: #38bdf8 !important; }
.text-indigo-300, .text-violet-300, .text-purple-300, .text-fuchsia-300 { color: #a78bfa !important; }
.text-indigo-400, .text-violet-400, .text-purple-400, .text-fuchsia-400 { color: #a78bfa !important; }

/* Eccezione: dentro un pulsante con bg colorato pieno il testo chiaro DEVE
   restare bianco. Lo riportiamo a bianco quando il button ha una bg- esplicita. */
button[class*="bg-"][class*="-500"] .text-white,
button[class*="bg-"][class*="-600"] .text-white,
button[class*="bg-"][class*="-700"] .text-white,
button[class*="bg-gradient"] .text-white,
[class*="bg-indigo-500"] *, [class*="bg-indigo-600"] *, [class*="bg-indigo-700"] *,
[class*="bg-purple-500"] *, [class*="bg-purple-600"] *, [class*="bg-purple-700"] *,
[class*="bg-emerald-500"] *, [class*="bg-emerald-600"] *,
[class*="bg-rose-500"] *, [class*="bg-rose-600"] *,
[class*="bg-red-500"] *, [class*="bg-red-600"] * {
  /* dentro container con bg pieno scuro/colorato, NON sovrascrivere
     i text-white o variants chiari */
}

/* ─── DEFENSIVE GLASS CARDS ─────────────────────────────────────
   Pattern AI ricorrente:
     <div class="bg-white/10 backdrop-blur ..."> ...<p class="text-white/60">testo</p>... </div>
   Quando la pagina ha sfondo SCURO (gradient indigo/purple/slate-900):
     bg-white/10 sopra dark diventa una tinta CHIARA del page bg
     -> text-white/60 sopra diventa quasi invisibile
   FIX: forziamo le low-opacity white card a sfondo SOLIDO scuro (niente
   trasparenza). Cosi' qualunque sfondo del page passi attraverso,
   le card sono SEMPRE leggibili e i text-white/N risaltano. */
.bg-white\\/5,
.bg-white\\/10,
.bg-white\\/15,
.bg-white\\/20,
.bg-white\\/25,
.bg-white\\/30 {
  background-color: #1a1f33 !important;  /* solido dark navy/purple */
  background-image: linear-gradient(135deg, rgba(124,90,240,0.08) 0%, rgba(255,255,255,0.02) 100%) !important;
}
/* Bordo: rafforziamo i border-white/N a opacita' maggiore per definirsi sul dark */
.border-white\\/5  { border-color: rgba(255, 255, 255, 0.12) !important; }
.border-white\\/10 { border-color: rgba(255, 255, 255, 0.16) !important; }
.border-white\\/15 { border-color: rgba(255, 255, 255, 0.20) !important; }
.border-white\\/20 { border-color: rgba(255, 255, 255, 0.22) !important; }
.border-white\\/30 { border-color: rgba(255, 255, 255, 0.28) !important; }

/* Quando l'AI usa text-white pieno o text-white/X dentro un container,
   garantiamo che resti chiaro (non sovrascritto da nessun'altra regola). */
.text-white { color: #ffffff !important; }
.text-white\\/90 { color: rgba(255, 255, 255, 0.92) !important; }
.text-white\\/80 { color: rgba(255, 255, 255, 0.86) !important; }
.text-white\\/70 { color: rgba(255, 255, 255, 0.80) !important; }
.text-white\\/60 { color: rgba(255, 255, 255, 0.75) !important; }
.text-white\\/50 { color: rgba(255, 255, 255, 0.70) !important; }
.text-white\\/40 { color: rgba(255, 255, 255, 0.65) !important; }
.placeholder-white\\/50::placeholder { color: rgba(255, 255, 255, 0.65) !important; }
.placeholder-white\\/40::placeholder { color: rgba(255, 255, 255, 0.60) !important; }
`;

const TAILWIND_CONFIG = (absHtml, absSrc) => `/** @type {import('tailwindcss').Config} */
export default {
  content: [${absHtml}, ${absSrc}],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #4f46e5 0%, #9333ea 100%)',
        'aurora': 'radial-gradient(ellipse at top, rgba(99,102,241,0.25), transparent 60%), radial-gradient(ellipse at bottom right, rgba(168,85,247,0.20), transparent 60%)',
      },
      boxShadow: {
        'glow-brand': '0 10px 30px -10px rgba(99, 102, 241, 0.45)',
        'glow-rose':  '0 10px 30px -10px rgba(244, 63, 94, 0.45)',
        'glow-emerald': '0 10px 30px -10px rgba(16, 185, 129, 0.45)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'fade-in': 'lc-fade-in 0.32s ease-out both',
      },
    },
  },
  plugins: [],
};
`;

const USAGE_README = `# LocoCode UI

Componenti pronti all'uso. **DEVI** importare da qui invece di reinventare:

\`\`\`jsx
import {
  Button, Card, CardHeader,
  Input, Textarea, Select,
  Badge, Empty, Stat, Modal,
  AuthLayout, PageLayout, SidebarBrand, SidebarItem, SidebarNav, PageHeader,
} from './components/ui';
\`\`\`

## Quick reference

- \`<Button variant="primary|secondary|ghost|danger|success" size="sm|md|lg" icon={Icon} loading>...</Button>\`
- \`<Card variant="glass|elevated|plain|dark" padding="sm|md|lg" hover>...</Card>\`
- \`<Input label="Email" icon={Mail} error="..." />\`
- \`<Textarea label="Note" rows={4} />\`
- \`<Select label="Categoria" options={[{value, label}]} />\`
- \`<Badge tone="indigo|emerald|rose|amber|slate|sky|purple" icon={Icon}>Attivo</Badge>\`
- \`<Empty icon={Inbox} title="..." description="..." actionLabel="..." onAction={...} />\`
- \`<Stat label="Ricavi" value="€12.450" tone="emerald" delta={12} icon={TrendingUp} />\`
- \`<AuthLayout title="Accedi" subtitle="..." footer={...}>{form}</AuthLayout>\`
- \`<PageLayout sidebar={...} header={<PageHeader title=".." action={<Button>...</Button>} />}>{content}</PageLayout>\`
- \`<Modal open={open} onClose={fn} title="..." footer={<>...</>}>{body}</Modal>\`
`;

export function getDesignSystemFiles(frontendDirPath, pathModule) {
  const absHtml = JSON.stringify(pathModule.join(frontendDirPath, "index.html"));
  const absSrc = JSON.stringify(pathModule.join(frontendDirPath, "src/**/*.{js,jsx,ts,tsx}"));
  return {
    "src/components/ui/Button.jsx": BUTTON_JSX,
    "src/components/ui/Card.jsx": CARD_JSX,
    "src/components/ui/Input.jsx": INPUT_JSX,
    "src/components/ui/Badge.jsx": BADGE_JSX,
    "src/components/ui/Empty.jsx": EMPTY_JSX,
    "src/components/ui/Stat.jsx": STAT_JSX,
    "src/components/ui/AuthLayout.jsx": AUTH_LAYOUT_JSX,
    "src/components/ui/PageLayout.jsx": PAGE_LAYOUT_JSX,
    "src/components/ui/Modal.jsx": MODAL_JSX,
    "src/components/ui/index.js": INDEX_JSX,
    "src/components/ui/README.md": USAGE_README,
    "src/lc-theme.css": THEME_CSS,
    "tailwind.config.js": TAILWIND_CONFIG(absHtml, absSrc),
  };
}

// Prompt-side: cosa raccontare all'AI sui componenti disponibili.
// Tenuto qui per evitare drift tra codice e prompt.
export const DESIGN_SYSTEM_PROMPT_SECTION = [
  "DESIGN SYSTEM PREINSTALLATO — REGOLA INDEROGABILE",
  "LocoCode inietta automaticamente in OGNI app generata un set di componenti UI 'Liquid Glass' belli e pronti.",
  "Tu NON DEVI ricreare Button/Card/Input/Modal/Layout/Badge da zero con div+className. Usa direttamente questi componenti.",
  "I file vengono scritti automaticamente prima del build, NON serve che tu li crei o li includa nei tuoi blocchi file.",
  "",
  "Import obbligatorio in OGNI pagina/componente che usa UI:",
  "  import { Button, Card, CardHeader, Input, Textarea, Select, Badge, Empty, Stat, Modal, AuthLayout, PageLayout, SidebarBrand, SidebarItem, SidebarNav, PageHeader } from './components/ui';",
  "(il path puo' diventare '../components/ui' o '../../components/ui' a seconda della profondita' della cartella, ma il punto di ingresso e' sempre 'components/ui')",
  "",
  "DEVI inoltre importare in src/main.jsx (DOPO ./index.css) anche:",
  "  import './lc-theme.css';",
  "(viene iniettato da LocoCode con tipografia Inter, scrollbar custom, animazioni — senza questo import l'app perde l'estetica).",
  "",
  "API DEI COMPONENTI (impara queste, sono tutte le opzioni disponibili):",
  "- Button: variant='primary'|'secondary'|'ghost'|'danger'|'success', size='sm'|'md'|'lg', icon={IconLucide}, iconRight={IconLucide}, loading={bool}. Primario = gradient indigo->purple. NON aggiungere mai className che sovrascriva colori/padding: usa SOLO le variant.",
  "- Card: variant='glass'(default)|'elevated'|'plain'|'dark', padding='sm'|'md'|'lg'|'none', hover={bool}. Wrappa SEMPRE in <Card> ogni blocco di contenuto (lista, form, riepilogo). NON usare <div className='bg-white...'>.",
  "- CardHeader: props title, subtitle, action. Usalo dentro <Card> per il titolo.",
  "- Input/Textarea/Select: props label, icon (solo Input), error, hint. Niente input HTML grezzi nelle form.",
  "- Badge: tone='indigo'|'emerald'|'rose'|'amber'|'slate'|'sky'|'purple', icon={IconLucide}.",
  "- Empty: stato vuoto premium, props icon (lucide), title, description, actionLabel, onAction. USA SEMPRE Empty per liste vuote.",
  "- Stat: KPI card con gradient sui numeri, props label, value, hint, tone, icon, delta. Per dashboard usa grid di <Stat>.",
  "- Modal: dialog glassmorphism, props open, onClose, title, subtitle, footer.",
  "- AuthLayout: layout login/register/onboarding. Usalo come root della LoginPage/RegisterPage. Props title, subtitle, footer.",
  "- PageLayout + SidebarBrand + SidebarNav + SidebarItem + PageHeader: layout standard dashboard. Sidebar a sinistra, contenuto a destra, header sticky.",
  "",
  "ESEMPIO LOGIN (riusa cosi', adatta solo il fetch):",
  "```jsx",
  "import { useState } from 'react';",
  "import { Mail, Lock, LogIn } from 'lucide-react';",
  "import { AuthLayout, Input, Button } from './components/ui';",
  "const API_URL = import.meta.env.VITE_API_URL || '';",
  "export default function LoginPage({ onLogin }) {",
  "  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');",
  "  const [err, setErr] = useState(''); const [loading, setLoading] = useState(false);",
  "  async function submit(e) {",
  "    e.preventDefault(); setLoading(true); setErr('');",
  "    try {",
  "      const r = await fetch(API_URL + '/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password: pw }) });",
  "      const ct = (r.headers.get('content-type')||'').toLowerCase();",
  "      if (!ct.includes('application/json')) throw new Error('Servizio temporaneamente non disponibile.');",
  "      const d = await r.json();",
  "      if (!r.ok) throw new Error(d.detail || 'Credenziali non valide');",
  "      onLogin(d);",
  "    } catch (e) { setErr(e.message); } finally { setLoading(false); }",
  "  }",
  "  return (",
  "    <AuthLayout title='Bentornato' subtitle='Accedi al tuo account' footer={<span>Non hai un account? <a className='text-indigo-600 font-semibold' href='#'>Registrati</a></span>}>",
  "      <form onSubmit={submit} className='space-y-4'>",
  "        <Input label='Email' icon={Mail} type='email' value={email} onChange={e=>setEmail(e.target.value)} placeholder='nome@esempio.it' required />",
  "        <Input label='Password' icon={Lock} type='password' value={pw} onChange={e=>setPw(e.target.value)} required error={err} />",
  "        <Button type='submit' icon={LogIn} loading={loading} className='w-full'>Accedi</Button>",
  "      </form>",
  "    </AuthLayout>",
  "  );",
  "}",
  "```",
  "",
  "ESEMPIO DASHBOARD:",
  "```jsx",
  "import { LayoutDashboard, Users, Package, TrendingUp, Plus } from 'lucide-react';",
  "import { PageLayout, SidebarBrand, SidebarNav, SidebarItem, PageHeader, Button, Stat, Card, CardHeader } from './components/ui';",
  "export default function Dashboard() {",
  "  return (",
  "    <PageLayout",
  "      sidebar={<><SidebarBrand name='LaMiaApp' icon={LayoutDashboard} /><SidebarNav><SidebarItem icon={LayoutDashboard} label='Panoramica' active /><SidebarItem icon={Users} label='Clienti' /><SidebarItem icon={Package} label='Prodotti' /></SidebarNav></>}",
  "      header={<PageHeader title='Panoramica' subtitle='Tutto cio che succede oggi' action={<Button icon={Plus}>Nuovo</Button>} />}",
  "    >",
  "      <div className='grid grid-cols-2 md:grid-cols-4 gap-4 mb-6'>",
  "        <Stat label='Ricavi' value='€12.450' tone='emerald' delta={12} icon={TrendingUp} />",
  "        <Stat label='Clienti' value='148' tone='indigo' delta={4} icon={Users} />",
  "        <Stat label='Ordini' value='32' tone='amber' delta={-3} icon={Package} />",
  "        <Stat label='Conversione' value='3.4%' tone='rose' delta={1} icon={TrendingUp} />",
  "      </div>",
  "      <Card><CardHeader title='Ultimi clienti' subtitle='Aggiunti questa settimana' action={<Button variant='ghost' size='sm'>Vedi tutti</Button>} />{/* lista qui */}</Card>",
  "    </PageLayout>",
  "  );",
  "}",
  "```",
  "",
  "REGOLE:",
  "1. NIENTE <button className='bg-blue-500...'>. Solo <Button variant=...>.",
  "2. NIENTE <input className='border...'>. Solo <Input label=... />.",
  "3. NIENTE <div className='rounded-lg shadow bg-white...'>. Solo <Card>.",
  "4. NIENTE pagine senza wrapper: usa AuthLayout per auth, PageLayout per il resto.",
  "5. Lista vuota? <Empty icon={...} title=... description=... />.",
  "6. KPI? <Stat .../> mai numero grezzo.",
  "7. Dialog? <Modal .../> mai overlay fatto a mano.",
  "8. Devi importare in main.jsx anche './lc-theme.css' (subito dopo './index.css').",
  "Se segui queste regole, l'app SARA' bellissima. Se le ignori e fai div+className tutto piatto, fallisci il task.",
].join("\n");
