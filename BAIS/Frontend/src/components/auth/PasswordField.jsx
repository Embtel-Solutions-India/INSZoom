import { useState } from "react";

const EyeIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EyeOffIcon = () => (
  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);

export default function PasswordField({
  icon,
  name,
  placeholder = "Password",
  value,
  onChange,
  autoComplete,
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="relative flex items-center w-full mb-4">
      {icon && (
        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center z-10">
          {icon}
        </span>
      )}
      <input
        type={showPassword ? "text" : "password"}
        id={name}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        className="bais-password-input w-full pl-10 pr-12 py-3 text-sm text-slate-800 placeholder-slate-400
          border border-slate-200 rounded-xl bg-white outline-none box-border
          hover:border-slate-300
          focus:border-[#1D9E75] focus:ring-2 focus:ring-[#1D9E75]/15
          transition-all duration-150"
      />
      <button
        type="button"
        aria-label={showPassword ? "Hide password" : "Show password"}
        aria-pressed={showPassword}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setShowPassword((current) => !current)}
        className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center
          rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100
          focus:outline-none focus:ring-2 focus:ring-[#1D9E75]/20 transition-all cursor-pointer"
      >
        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
      </button>
      <style>{`
        .bais-password-input::-ms-reveal,
        .bais-password-input::-ms-clear {
          display: none;
        }
      `}</style>
    </div>
  );
}
